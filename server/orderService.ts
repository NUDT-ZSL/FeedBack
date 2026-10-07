import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { FillingDef, MoldDef, findFillingById, findMoldById } from './catalog';
import { OrderStore, StoredOrder } from './orderStore';

export interface OrderSnapshot {
  fillings: FillingDef[];
  mold: MoldDef;
  drawingData: string;
  recipientName: string;
  blessing: string;
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface OrderPayload {
  fillings?: unknown;
  mold?: unknown;
  drawingData?: unknown;
  recipientName?: unknown;
  blessing?: unknown;
  clientRequestId?: unknown;
}

export type CreateOrderResult =
  | { status: 200; orderId: string; duplicated: boolean }
  | { status: 400; errors: ValidationError[] };

export type GetOrderResult =
  | { status: 200; orderId: string; createdAt: string; snapshot: OrderSnapshot }
  | { status: 404; code: 'ORDER_NOT_FOUND'; error: string }
  | { status: 500; code: 'SNAPSHOT_CORRUPTED'; error: string };

const MAX_FILLINGS = 3;
const MAX_RECIPIENT_NAME_LENGTH = 20;
const MAX_BLESSING_LENGTH = 50;
const DATA_URL_PREFIX = 'data:image/';

function snapshotHash(snapshot: OrderSnapshot): string {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot), 'utf-8').digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateOrderPayload(
  payload: OrderPayload
): { ok: true; snapshot: OrderSnapshot } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const resolvedFillings: FillingDef[] = [];
  let resolvedMold: MoldDef | undefined;

  const { fillings, mold, drawingData, recipientName, blessing } = payload;

  if (!Array.isArray(fillings) || fillings.length === 0) {
    errors.push({
      field: 'fillings',
      code: 'FILLINGS_REQUIRED',
      message: '请至少选择1种馅料',
    });
  } else {
    if (fillings.length > MAX_FILLINGS) {
      errors.push({
        field: 'fillings',
        code: 'FILLINGS_TOO_MANY',
        message: `馅料最多选择${MAX_FILLINGS}种，当前选择了${fillings.length}种`,
      });
    }
    const seenIds = new Set<string>();
    fillings.forEach((item, index) => {
      const id = isPlainObject(item) && typeof item.id === 'string' ? item.id : undefined;
      if (!id) {
        errors.push({
          field: 'fillings',
          code: 'FILLING_INVALID',
          message: `第${index + 1}种馅料数据无效`,
        });
        return;
      }
      if (seenIds.has(id)) {
        errors.push({
          field: 'fillings',
          code: 'FILLING_DUPLICATED',
          message: '馅料选择存在重复项',
        });
        return;
      }
      seenIds.add(id);
      const def = findFillingById(id);
      if (!def) {
        errors.push({
          field: 'fillings',
          code: 'FILLING_NOT_FOUND',
          message: `馅料（ID: ${id}）不存在，请重新选择`,
        });
        return;
      }
      resolvedFillings.push({ ...def });
    });
  }

  if (!isPlainObject(mold) || typeof mold.id !== 'string') {
    errors.push({
      field: 'mold',
      code: 'MOLD_REQUIRED',
      message: '请选择糕点模具',
    });
  } else {
    resolvedMold = findMoldById(mold.id);
    if (!resolvedMold) {
      errors.push({
        field: 'mold',
        code: 'MOLD_NOT_FOUND',
        message: `模具（ID: ${mold.id}）不存在，请重新选择`,
      });
    }
  }

  if (resolvedMold && resolvedFillings.length > 0) {
    if (resolvedFillings.length > resolvedMold.maxFillings) {
      errors.push({
        field: 'fillings',
        code: 'FILLING_MOLD_MISMATCH',
        message: `模具「${resolvedMold.name}」最多容纳${resolvedMold.maxFillings}种馅料，当前选择了${resolvedFillings.length}种，请调整馅料或更换模具`,
      });
    }
  }

  if (typeof drawingData !== 'string' || drawingData.trim() === '') {
    errors.push({
      field: 'drawingData',
      code: 'DRAWING_EMPTY',
      message: '糕点绘制数据为空，请返回设计页完成绘制',
    });
  } else if (!drawingData.startsWith(DATA_URL_PREFIX)) {
    errors.push({
      field: 'drawingData',
      code: 'DRAWING_INVALID',
      message: '糕点绘制数据格式无效，请返回设计页重新绘制',
    });
  }

  const trimmedName = typeof recipientName === 'string' ? recipientName.trim() : '';
  if (!trimmedName) {
    errors.push({
      field: 'recipientName',
      code: 'RECIPIENT_REQUIRED',
      message: '请输入收件人姓名',
    });
  } else if (trimmedName.length > MAX_RECIPIENT_NAME_LENGTH) {
    errors.push({
      field: 'recipientName',
      code: 'RECIPIENT_TOO_LONG',
      message: `收件人姓名不能超过${MAX_RECIPIENT_NAME_LENGTH}个字符`,
    });
  }

  const trimmedBlessing = typeof blessing === 'string' ? blessing.trim() : '';
  if (!trimmedBlessing) {
    errors.push({
      field: 'blessing',
      code: 'BLESSING_REQUIRED',
      message: '请输入祝福语',
    });
  } else if (trimmedBlessing.length > MAX_BLESSING_LENGTH) {
    errors.push({
      field: 'blessing',
      code: 'BLESSING_TOO_LONG',
      message: `祝福语不能超过${MAX_BLESSING_LENGTH}个字符`,
    });
  }

  if (errors.length > 0 || !resolvedMold) {
    return { ok: false, errors };
  }

  const snapshot: OrderSnapshot = {
    fillings: resolvedFillings,
    mold: { ...resolvedMold },
    drawingData: drawingData as string,
    recipientName: trimmedName,
    blessing: trimmedBlessing,
  };
  return { ok: true, snapshot };
}

function generateOrderId(store: OrderStore): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const random = Math.floor(1000 + Math.random() * 9000);
    const candidate = `DS${year}${month}${day}${random}`;
    if (!store.findByOrderId(candidate)) {
      return candidate;
    }
  }
  throw new Error('订单号生成失败');
}

export function createOrder(store: OrderStore, payload: OrderPayload): CreateOrderResult {
  const clientRequestId =
    typeof payload.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
  if (!clientRequestId) {
    return {
      status: 400,
      errors: [
        {
          field: 'clientRequestId',
          code: 'CLIENT_REQUEST_ID_REQUIRED',
          message: '缺少请求标识，请刷新页面后重试',
        },
      ],
    };
  }

  const existing = store.findByIdempotencyKey(clientRequestId);
  if (existing) {
    return { status: 200, orderId: existing.orderId, duplicated: true };
  }

  const validation = validateOrderPayload(payload);
  if (!validation.ok) {
    return { status: 400, errors: validation.errors };
  }

  const snapshotJson = JSON.stringify(validation.snapshot);
  const order: StoredOrder = {
    id: uuidv4(),
    orderId: generateOrderId(store),
    idempotencyKey: clientRequestId,
    snapshot: snapshotJson,
    snapshotHash: snapshotHash(validation.snapshot),
    createdAt: new Date().toISOString(),
  };
  store.insert(order);

  return { status: 200, orderId: order.orderId, duplicated: false };
}

export function getOrder(store: OrderStore, orderId: string): GetOrderResult {
  const order = store.findByOrderId(orderId);
  if (!order) {
    return { status: 404, code: 'ORDER_NOT_FOUND', error: '订单不存在' };
  }

  let snapshot: OrderSnapshot;
  try {
    snapshot = JSON.parse(order.snapshot) as OrderSnapshot;
  } catch {
    return { status: 500, code: 'SNAPSHOT_CORRUPTED', error: '订单快照损坏，无法读取' };
  }

  if (
    !snapshot ||
    !Array.isArray(snapshot.fillings) ||
    !snapshot.mold ||
    typeof order.snapshotHash !== 'string' ||
    snapshotHash(snapshot) !== order.snapshotHash
  ) {
    return { status: 500, code: 'SNAPSHOT_CORRUPTED', error: '订单快照损坏，无法读取' };
  }

  return { status: 200, orderId: order.orderId, createdAt: order.createdAt, snapshot };
}
