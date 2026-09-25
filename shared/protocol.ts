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

export type VectorRelation = 'equal' | 'ahead' | 'behind' | 'concurrent';

/**
 * Compare two version vectors and report their causal relation.
 * 'concurrent' is explicitly distinct from 'equal': concurrent vectors
 * each contain entries the other side has not seen.
 */
export function compareVersionVectors(a: VersionVector, b: VersionVector): VectorRelation {
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
 * Numeric comparator kept for existing callers: 1 when a is strictly
 * ahead, -1 when strictly behind, 0 when equal OR concurrent. Use
 * compareVersionVectors when concurrent must be told apart from equal.
 */
export function compareVersions(a: VersionVector, b: VersionVector): number {
  const relation = compareVersionVectors(a, b);
  if (relation === 'ahead') return 1;
  if (relation === 'behind') return -1;
  return 0;
}

/**
 * Deterministic tie-break for two operations targeting the same position.
 * Must be a total order so that transform(A, B) and transform(B, A) agree.
 */
function opSortsAfter(op: TextOperation, other: TextOperation): boolean {
  if (op.timestamp !== other.timestamp) return op.timestamp > other.timestamp;
  return op.id > other.id;
}

/**
 * Transform the position of an insert against an already-applied op.
 * Returns null when the insert falls strictly inside a range removed by
 * the applied op: the insert is absorbed (the removal wins) so that both
 * replicas converge.
 */
function transformInsertPosition(
  position: number,
  op: TextOperation,
  appliedOp: TextOperation,
): number | null {
  const appPos = appliedOp.position;
  const appLen = appliedOp.length ?? 0;
  const appTextLen = (appliedOp.text ?? '').length;

  if (appliedOp.type === 'insert') {
    if (position > appPos || (position === appPos && opSortsAfter(op, appliedOp))) {
      return position + appTextLen;
    }
    return position;
  }

  // appliedOp removes [appPos, appPos + appLen) and inserts appText at appPos.
  const appEnd = appPos + appLen;
  if (position <= appPos) return position;
  if (position >= appEnd) return position - appLen + appTextLen;
  return null;
}

/**
 * Transform a deletion range [position, position + length) against an
 * already-applied op. Returns null when the range is fully consumed.
 * An insert strictly inside the range is absorbed (the range expands),
 * which keeps a single contiguous op convergent on both replicas.
 */
function transformDeleteRange(
  position: number,
  length: number,
  appliedOp: TextOperation,
): { position: number; length: number } | null {
  let pos = position;
  let len = length;

  if (appliedOp.type === 'insert') {
    const appPos = appliedOp.position;
    const appTextLen = (appliedOp.text ?? '').length;
    if (appTextLen > 0) {
      if (appPos <= pos) {
        pos += appTextLen;
      } else if (appPos < pos + len) {
        len += appTextLen;
      }
    }
  } else {
    // delete or replace: first subtract the removed range.
    const appPos = appliedOp.position;
    const appLen = appliedOp.length ?? 0;
    const appEnd = appPos + appLen;
    const opEnd = pos + len;
    if (opEnd > appPos && pos < appEnd) {
      const overlap = Math.min(opEnd, appEnd) - Math.max(pos, appPos);
      pos = Math.min(pos, appPos);
      len -= overlap;
    } else if (pos >= appEnd) {
      pos -= appLen;
    }
    if (len <= 0) return null;
    if (appliedOp.type === 'replace') {
      // Then account for the replacement text inserted at appPos.
      const appTextLen = (appliedOp.text ?? '').length;
      if (appTextLen > 0) {
        if (appPos <= pos) {
          pos += appTextLen;
        } else if (appPos < pos + len) {
          len += appTextLen;
        }
      }
    }
  }

  if (len <= 0) return null;
  return { position: pos, length: len };
}

/**
 * Transform `op` so it can be applied after `appliedOp`, given both were
 * created against the same base content. Returns null when the op becomes
 * a no-op (duplicate, or fully absorbed by a concurrent removal).
 *
 * Convergence (TP1) holds for insert/delete combinations:
 *   apply(apply(base, A), transform(B, A)) === apply(apply(base, B), transform(A, B))
 */
export function transformOperation(
  op: TextOperation,
  appliedOp: TextOperation,
): TextOperation | null {
  if (op.id === appliedOp.id) return null;

  if (op.type === 'insert') {
    const position = transformInsertPosition(op.position, op, appliedOp);
    if (position === null) return null;
    return { ...op, position };
  }

  const range = transformDeleteRange(op.position, op.length ?? 0, appliedOp);

  if (op.type === 'delete') {
    if (range === null) return null;
    return { ...op, position: range.position, length: range.length };
  }

  // replace: the inserted text follows the surviving range start. If the
  // range vanished, degrade to a pure insert at the transformed insert
  // position (or nothing when the insert itself was absorbed).
  const text = op.text ?? '';
  if (range !== null) {
    return { ...op, position: range.position, length: range.length, text };
  }
  const insertPos = transformInsertPosition(op.position, op, appliedOp);
  if (insertPos === null || text.length === 0) return null;
  return { ...op, type: 'insert', position: insertPos, length: 0, text };
}

export type OperationApplyErrorCode =
  | 'INVALID_OPERATION'
  | 'INVALID_POSITION'
  | 'VERSION_MISMATCH'
  | 'VECTOR_CONFLICT';

export class OperationApplyError extends Error {
  readonly code: OperationApplyErrorCode;

  constructor(code: OperationApplyErrorCode, message: string) {
    super(message);
    this.name = 'OperationApplyError';
    this.code = code;
  }
}

/**
 * Apply an operation to content. Invalid operations fail explicitly by
 * throwing OperationApplyError instead of silently corrupting content.
 */
export function applyOperation(content: string, op: TextOperation): string {
  const { type, position, length = 0, text = '' } = op;

  if (type !== 'insert' && type !== 'delete' && type !== 'replace') {
    throw new OperationApplyError(
      'INVALID_OPERATION',
      `Unknown operation type: ${String(type)}`,
    );
  }
  if (!Number.isInteger(position) || position < 0) {
    throw new OperationApplyError(
      'INVALID_POSITION',
      `Operation position ${position} is not a valid offset`,
    );
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new OperationApplyError(
      'INVALID_OPERATION',
      `Operation length ${length} is not a valid length`,
    );
  }

  if (type === 'insert') {
    if (position > content.length) {
      throw new OperationApplyError(
        'INVALID_POSITION',
        `Insert position ${position} exceeds content length ${content.length}`,
      );
    }
    return content.slice(0, position) + text + content.slice(position);
  }

  if (position + length > content.length) {
    throw new OperationApplyError(
      'INVALID_POSITION',
      `out-of-range ${type} [${position}, ${position + length}) for content length ${content.length}`,
    );
  }
  if (type === 'delete') {
    return content.slice(0, position) + content.slice(position + length);
  }
  return content.slice(0, position) + text + content.slice(position + length);
}

export interface LocalVersionState {
  version: number;
  vector: VersionVector;
}

/**
 * Apply an operation only when it is consistent with the local version
 * state. Throws OperationApplyError when the operation's baseVersion does
 * not match the local version, or when the operation's version vector is
 * strictly ahead of the local vector (i.e. it assumes operations this
 * replica has never seen).
 */
export function applyOperationAtState(
  content: string,
  op: TextOperation,
  state: LocalVersionState,
  opVector?: VersionVector,
): string {
  if (op.baseVersion !== state.version) {
    throw new OperationApplyError(
      'VERSION_MISMATCH',
      `Operation baseVersion ${op.baseVersion} does not match local version ${state.version}`,
    );
  }
  if (opVector !== undefined) {
    const relation = compareVersionVectors(opVector, state.vector);
    if (relation === 'ahead') {
      throw new OperationApplyError(
        'VECTOR_CONFLICT',
        'Operation vector is ahead of the local vector: missing intermediate operations',
      );
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
