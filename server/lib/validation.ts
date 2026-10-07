import { Catalog, Filling, Mold } from './types';

export const MAX_FILLINGS_PER_ORDER = 3;
export const MAX_RECIPIENT_NAME_LENGTH = 20;
export const MAX_BLESSING_LENGTH = 50;

export interface OrderPayload {
  fillings: Filling[];
  mold: Mold;
  drawingData: string;
  recipientName: string;
  blessing: string;
}

export class OrderValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OrderValidationError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new OrderValidationError(code, message);
}

export function validateOrderPayload(body: unknown, catalog: Catalog): OrderPayload {
  if (body === null || typeof body !== 'object') {
    fail('INVALID_BODY', '请求体格式不正确');
  }
  const { fillings, mold, drawingData, recipientName, blessing } = body as Record<string, unknown>;

  if (typeof recipientName !== 'string' || recipientName.trim().length === 0) {
    fail('MISSING_RECIPIENT', '缺少收件人姓名');
  }
  if (recipientName.trim().length > MAX_RECIPIENT_NAME_LENGTH) {
    fail('RECIPIENT_TOO_LONG', `收件人姓名不能超过${MAX_RECIPIENT_NAME_LENGTH}个字符`);
  }
  if (typeof blessing !== 'string' || blessing.trim().length === 0) {
    fail('MISSING_BLESSING', '缺少祝福语');
  }
  if (blessing.trim().length > MAX_BLESSING_LENGTH) {
    fail('BLESSING_TOO_LONG', `祝福语不能超过${MAX_BLESSING_LENGTH}个字符`);
  }

  if (!Array.isArray(fillings) || fillings.length === 0) {
    fail('NO_FILLINGS', '请至少选择1种馅料');
  }
  if (fillings.length > MAX_FILLINGS_PER_ORDER) {
    fail('TOO_MANY_FILLINGS', `馅料最多选择${MAX_FILLINGS_PER_ORDER}种，当前选择了${fillings.length}种`);
  }
  const seenFillingIds = new Set<string>();
  const resolvedFillings: Filling[] = [];
  for (const item of fillings) {
    const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : '';
    const known = catalog.fillings.find(f => f.id === id);
    if (!known) {
      fail('UNKNOWN_FILLING', `馅料「${id || '未知'}」不存在，请重新选择`);
    }
    if (seenFillingIds.has(known.id)) {
      fail('DUPLICATE_FILLING', `馅料「${known.name}」被重复选择`);
    }
    seenFillingIds.add(known.id);
    resolvedFillings.push({ ...known });
  }

  const moldId = mold && typeof mold === 'object' ? String((mold as { id?: unknown }).id ?? '') : '';
  const resolvedMold = catalog.molds.find(m => m.id === moldId);
  if (!resolvedMold) {
    fail('UNKNOWN_MOLD', moldId ? `模具「${moldId}」不存在，请重新选择` : '请先选择模具');
  }
  if (resolvedFillings.length > resolvedMold.capacity) {
    fail(
      'FILLINGS_EXCEED_MOLD_CAPACITY',
      `模具「${resolvedMold.name}」最多容纳${resolvedMold.capacity}种馅料，当前选择了${resolvedFillings.length}种`
    );
  }

  if (typeof drawingData !== 'string' || drawingData.length === 0) {
    fail('EMPTY_DRAWING', '绘制数据为空，请完成糕点绘制并烘焙后再提交');
  }
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(drawingData)) {
    fail('INVALID_DRAWING', '绘制数据不完整或格式不正确，请重新绘制');
  }

  return {
    fillings: resolvedFillings,
    mold: { ...resolvedMold },
    drawingData,
    recipientName: recipientName.trim(),
    blessing: blessing.trim(),
  };
}
