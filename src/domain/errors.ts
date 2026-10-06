export type WorkshopErrorCode =
  | 'STEP_FAILED'
  | 'INSUFFICIENT_STOCK'
  | 'EMPTY_MATERIALS'
  | 'INVALID_MATERIAL_AMOUNT'
  | 'ORDER_NOT_FOUND'
  | 'INVALID_ORDER_TRANSITION'
  | 'NOTHING_TO_UNDO'
  | 'UNKNOWN_METAL';

export class WorkshopError extends Error {
  readonly code: WorkshopErrorCode;
  readonly step?: string;

  constructor(code: WorkshopErrorCode, message: string, step?: string) {
    super(message);
    this.name = 'WorkshopError';
    this.code = code;
    if (step !== undefined) {
      this.step = step;
    }
  }
}
