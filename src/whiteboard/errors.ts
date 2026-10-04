import type { Op } from './ops.ts';

export type RejectCode =
  | 'ADD_DUPLICATE_ID'
  | 'ADD_MISSING_PARENT'
  | 'ADD_BAD_INDEX'
  | 'UPDATE_MISSING'
  | 'UPDATE_NO_FIELDS'
  | 'REMOVE_MISSING'
  | 'REORDER_MISSING'
  | 'REORDER_BAD_INDEX'
  | 'MOVE_MISSING'
  | 'MOVE_MISSING_PARENT'
  | 'MOVE_INTO_SUBTREE'
  | 'MOVE_BAD_INDEX'
  | 'GROUP_EMPTY'
  | 'GROUP_ID_TAKEN'
  | 'GROUP_MISSING_ELEMENT'
  | 'GROUP_MIXED_PARENTS'
  | 'UNGROUP_MISSING'
  | 'UNGROUP_NOT_GROUP'
  | 'RESTORE_DUPLICATE_ID'
  | 'RESTORE_MISSING_PARENT'
  | 'RESTORE_MISSING_ELEMENT';

export class OpRejection extends Error {
  readonly code: RejectCode;
  readonly op: Op;

  constructor(code: RejectCode, message: string, op: Op) {
    super(`${code}: ${message}`);
    this.name = 'OpRejection';
    this.code = code;
    this.op = op;
  }
}
