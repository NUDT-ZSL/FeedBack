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

export function compareVersions(a: VersionVector, b: VersionVector): number {
  let aGreater = false;
  let bGreater = false;
  const allUsers = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const user of allUsers) {
    const av = a[user] || 0;
    const bv = b[user] || 0;
    if (av > bv) aGreater = true;
    if (av < bv) bGreater = true;
  }
  if (aGreater && !bGreater) return 1;
  if (bGreater && !aGreater) return -1;
  return 0;
}

export function transformOperation(
  op: TextOperation,
  appliedOp: TextOperation,
): TextOperation | null {
  if (op.id === appliedOp.id) return null;

  const { position: opPos, length: opLen = 0, type: opType } = op;
  const { position: appPos, length: appLen = 0, text: appText = '' } = appliedOp;
  const appDelta = appText.length - appLen;

  let newPos = opPos;
  let newLen = opLen;

  if (opType === 'insert') {
    if (opPos > appPos) {
      newPos = opPos + appDelta;
    } else if (opPos === appPos && op.timestamp > appliedOp.timestamp) {
      newPos = opPos + appDelta;
    }
  } else if (opType === 'delete' || opType === 'replace') {
    const opEnd = opPos + opLen;
    const appEnd = appPos + appLen;

    if (opEnd <= appPos) {
    } else if (opPos >= appEnd) {
      newPos = opPos + appDelta;
    } else {
      if (opPos <= appPos && opEnd >= appEnd) {
        newLen = opLen + appDelta;
      } else if (opPos <= appPos && opEnd < appEnd) {
        const overlap = opEnd - appPos;
        newLen = Math.max(0, opLen - overlap);
      } else if (opPos > appPos && opEnd >= appEnd) {
        const overlap = appEnd - opPos;
        newPos = appPos;
        newLen = Math.max(0, opLen - overlap) + appDelta;
      } else {
        const overlapBefore = opPos - appPos;
        const overlapAfter = appEnd - opEnd;
        newPos = appPos;
        newLen = Math.max(0, appText.length - overlapBefore - overlapAfter);
        return {
          ...op,
          position: newPos,
          length: 0,
          text: '',
          type: 'insert',
        };
      }
    }
  }

  return {
    ...op,
    position: Math.max(0, newPos),
    length: Math.max(0, newLen),
  };
}

export function applyOperation(content: string, op: TextOperation): string {
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
