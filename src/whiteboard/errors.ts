import type { BoardOp } from './ops.ts';

export type OpErrorCode =
  | 'UNKNOWN_ELEMENT'
  | 'DUPLICATE_ID'
  | 'NOT_A_GROUP'
  | 'CYCLE'
  | 'BAD_INDEX'
  | 'UNKNOWN_FIELD'
  | 'IMMUTABLE_FIELD'
  | 'EMPTY_PATCH'
  | 'ROOT_OPERATION';

export class OpError extends Error {
  readonly code: OpErrorCode;
  readonly op: BoardOp;

  constructor(code: OpErrorCode, message: string, op: BoardOp) {
    super(message);
    this.name = 'OpError';
    this.code = code;
    this.op = op;
  }
}
