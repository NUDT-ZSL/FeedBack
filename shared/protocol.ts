export const PROTOCOL_VERSION = '1.0.0';

export type OpType = 'insert' | 'delete' | 'replace';

export interface TextOperation {
  id: string;
  type: OpType;
  position: number;
  length?: number;
  text?: string;
  timestamp: number;
  userId: string;
  baseVersion: number;
}

export interface VersionVector {
  [userId: string]: number;
}

export interface ChangeMessage {
  type: 'change';
  documentId: string;
  operation: TextOperation;
  currentVersion: number;
  vector: VersionVector;
}

export interface ChangeAckMessage {
  type: 'change-ack';
  documentId: string;
  operationId: string;
  newVersion: number;
  applied: boolean;
}

export interface CursorMessage {
  type: 'cursor';
  documentId: string;
  userId: string;
  userName: string;
  color: string;
  cursor: { line: number; column: number };
  selection: { start: number; end: number } | null;
  timestamp: number;
}

export interface JoinMessage {
  type: 'join';
  documentId: string;
  userId: string;
  userName: string;
  color: string;
  currentVersion?: number;
}

export interface LeaveMessage {
  type: 'leave';
  documentId: string;
  userId: string;
}

export interface UserListMessage {
  type: 'user-list';
  documentId: string;
  users: Array<{ userId: string; userName: string; color: string; cursor?: { line: number; column: number } }>;
}

export interface SyncMessage {
  type: 'sync';
  documentId: string;
  content: string;
  version: number;
  vector: VersionVector;
  reason: 'init' | 'reset' | 'save';
}

export interface ErrorMessage {
  type: 'error';
  code: number;
  message: string;
  operationId?: string;
}

export type WSMessage =
  | ChangeMessage
  | ChangeAckMessage
  | CursorMessage
  | JoinMessage
  | LeaveMessage
  | UserListMessage
  | SyncMessage
  | ErrorMessage;

export function generateOpId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export type VersionRelation = 'equal' | 'ahead' | 'behind' | 'concurrent';

/**
 * 四态版本向量比较：相等 / a 严格领先 / a 严格落后 / 并发（互有领先分量）。
 * 并发与相等必须区分开：并发意味着双方存在对方未见的操作，不能直接合并。
 */
export function compareVersionVectors(a: VersionVector, b: VersionVector): VersionRelation {
  let aGreater = false;
  let bGreater = false;
  const allUsers = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const user of allUsers) {
    const av = a[user] || 0;
    const bv = b[user] || 0;
    if (av > bv) aGreater = true;
    if (av < bv) bGreater = true;
  }
  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 'ahead';
  if (bGreater) return 'behind';
  return 'equal';
}

/**
 * 数值形式的三态比较（向后兼容）：领先返回 1，落后返回 -1，相等或并发返回 0。
 * 注意 0 同时覆盖「相等」与「并发」，需要区分时请使用 compareVersionVectors。
 */
export function compareVersions(a: VersionVector, b: VersionVector): number {
  const relation = compareVersionVectors(a, b);
  if (relation === 'ahead') return 1;
  if (relation === 'behind') return -1;
  return 0;
}

/**
 * 操作优先级：用于并发插入同一位置时的确定性决胜。
 * 双向变换必须使用同一全序，否则两端无法收敛。
 */
function compareOpPriority(a: TextOperation, b: TextOperation): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * 插入位置相对删除区间 [delPos, delPos+delLen) 的变换。
 * 返回 null 表示插入点落在删除区间内（含起点），该插入被删除吸收，应变为空操作；
 * 只有「删除吸收区间内并发插入」这一规则能保证双向变换收敛。
 */
function transformInsertPosAgainstDelete(
  pos: number,
  delPos: number,
  delLen: number,
): number | null {
  const delEnd = delPos + delLen;
  if (pos < delPos) return pos;
  if (pos >= delEnd) return pos - delLen;
  return null;
}

/**
 * 删除区间 [pos, pos+len) 相对另一删除区间的变换，返回 [newPos, newLen]。
 * 重叠部分已被对方删除，新区间只保留双方删除范围的差集。
 */
function transformRangeAgainstDelete(
  pos: number,
  len: number,
  delPos: number,
  delLen: number,
): [number, number] {
  const end = pos + len;
  const delEnd = delPos + delLen;
  if (end <= delPos) return [pos, len];
  if (pos >= delEnd) return [pos - delLen, len];
  const overlap = Math.min(end, delEnd) - Math.max(pos, delPos);
  return [Math.min(pos, delPos), len - overlap];
}

/**
 * 将 op 相对已应用的 appliedOp 做操作变换（OT）。
 * 收敛性规则：
 * - replace 视为「先删除区间、再在原位插入文本」的复合操作参与变换；
 * - 落在并发删除区间内（含起点）的插入被删除吸收，变为空插入；
 * - 删除/替换区间会吸收其原始范围内（含起点）的并发插入，长度相应扩展；
 * - 同位置并发插入按 (timestamp, userId, id) 全序决胜，优先级低者位置不变。
 * 已知限制：并发 replace 与 delete/replace 区间互相重叠（一方包含另一方）时，
 * 单个复合操作无法表达拆分后的删除范围，需依赖全量同步（sync/reset）兜底。
 */
export function transformOperation(
  op: TextOperation,
  appliedOp: TextOperation,
): TextOperation | null {
  if (op.id === appliedOp.id) return null;

  // 将 appliedOp 分解为「删除区间 + 可选插入」。
  const aDelPos = appliedOp.position;
  const aDelLen = appliedOp.type === 'insert' ? 0 : (appliedOp.length ?? 0);
  const aInsText = appliedOp.type === 'delete' ? '' : (appliedOp.text ?? '');
  const aInsPos = appliedOp.position;

  if (op.type === 'insert') {
    let pos = op.position;
    if (aDelLen > 0) {
      const shifted = transformInsertPosAgainstDelete(pos, aDelPos, aDelLen);
      if (shifted === null) {
        // 插入点被并发删除吸收，退化为空操作（保持位置合法即可）。
        return { ...op, position: aDelPos, text: '' };
      }
      pos = shifted;
    }
    if (aInsText.length > 0) {
      if (pos > aInsPos || (pos === aInsPos && compareOpPriority(op, appliedOp) > 0)) {
        pos += aInsText.length;
      }
    }
    return { ...op, position: pos };
  }

  // delete / replace：先变换删除区间，replace 的插入文本跟随变换后的区间起点。
  const origPos = op.position;
  const origEnd = origPos + (op.length ?? 0);
  let pos = origPos;
  let len = op.length ?? 0;
  if (aDelLen > 0) {
    [pos, len] = transformRangeAgainstDelete(pos, len, aDelPos, aDelLen);
  }
  if (aInsText.length > 0) {
    if (aInsPos < origPos) {
      pos += aInsText.length;
    } else if (aInsPos < origEnd) {
      // 并发插入落在本操作原始删除范围内（含起点），删除吸收该插入。
      len += aInsText.length;
    }
  }
  return { ...op, position: pos, length: len };
}

/** 操作应用/校验失败时抛出的错误，message 中指明失败原因。 */
export class OperationApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationApplyError';
  }
}

/**
 * 校验操作能否安全应用到给定内容上，失败时抛出 OperationApplyError。
 * 覆盖：非法位置、越界位置、删除/替换范围超出内容长度。
 */
export function validateOperation(content: string, op: TextOperation): void {
  const { type, position, length = 0 } = op;
  if (!Number.isInteger(position) || position < 0) {
    throw new OperationApplyError(
      `操作 ${op.id} 位置非法: position=${position}（必须是非负整数）`,
    );
  }
  if (type === 'insert') {
    if (position > content.length) {
      throw new OperationApplyError(
        `操作 ${op.id} 插入位置越界: position=${position} 超出当前内容长度 ${content.length}`,
      );
    }
    return;
  }
  if (type === 'delete' || type === 'replace') {
    if (!Number.isInteger(length) || length < 0) {
      throw new OperationApplyError(
        `操作 ${op.id} 长度非法: length=${length}（必须是非负整数）`,
      );
    }
    if (position + length > content.length) {
      throw new OperationApplyError(
        `操作 ${op.id} ${type} 范围越界: [${position}, ${position + length}) 超出当前内容长度 ${content.length}`,
      );
    }
  }
}

export function applyOperation(content: string, op: TextOperation): string {
  validateOperation(content, op);
  const { type, position, length = 0, text = '' } = op;

  if (type === 'insert') {
    return content.slice(0, position) + text + content.slice(position);
  } else if (type === 'delete') {
    return content.slice(0, position) + content.slice(position + length);
  } else if (type === 'replace') {
    return content.slice(0, position) + text + content.slice(position + length);
  }

  return content;
}

export interface ApplyVersionContext {
  /** 本地当前版本号，op.baseVersion 必须与之相等 */
  localVersion: number;
  /** 本地版本向量 */
  localVector?: VersionVector;
  /** 操作随消息携带的版本向量（须与本地向量相等，否则视为矛盾） */
  operationVector?: VersionVector;
}

/**
 * 带版本一致性校验的操作应用：
 * - baseVersion 与本地版本不一致 → 抛出「版本不匹配」；
 * - 操作携带的版本向量与本地向量矛盾（领先/落后/并发）→ 抛出「版本向量矛盾」；
 * - 位置或范围越界 → 抛出越界错误。
 * 任一校验失败都会明确抛错，而不是静默产生错误内容。
 */
export function applyOperationStrict(
  content: string,
  op: TextOperation,
  context?: ApplyVersionContext,
): string {
  if (context) {
    if (op.baseVersion !== context.localVersion) {
      throw new OperationApplyError(
        `版本不匹配: 操作 ${op.id} 基于版本 ${op.baseVersion}，本地版本为 ${context.localVersion}`,
      );
    }
    if (context.localVector && context.operationVector) {
      const relation = compareVersionVectors(context.operationVector, context.localVector);
      if (relation !== 'equal') {
        throw new OperationApplyError(
          `操作 ${op.id} 携带的版本向量与本地状态矛盾（关系: ${relation}）`,
        );
      }
    }
  }
  return applyOperation(content, op);
}

export function operationFromDiff(
  oldContent: string,
  newContent: string,
  userId: string,
  baseVersion: number,
): TextOperation | null {
  let start = 0;
  const maxStart = Math.min(oldContent.length, newContent.length);

  while (start < maxStart && oldContent[start] === newContent[start]) {
    start++;
  }

  let oldEnd = oldContent.length;
  let newEnd = newContent.length;

  while (oldEnd > start && newEnd > start && oldContent[oldEnd - 1] === newContent[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const oldText = oldContent.slice(start, oldEnd);
  const newText = newContent.slice(start, newEnd);

  if (oldText.length === 0 && newText.length === 0) {
    return null;
  }

  let type: OpType;
  if (oldText.length === 0) {
    type = 'insert';
  } else if (newText.length === 0) {
    type = 'delete';
  } else {
    type = 'replace';
  }

  return {
    id: generateOpId(),
    type,
    position: start,
    length: oldText.length,
    text: newText,
    timestamp: Date.now(),
    userId,
    baseVersion,
  };
}
