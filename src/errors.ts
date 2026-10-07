export type WorkshopErrorCode =
  | 'INVALID_PHASE'
  | 'VALIDATION_FAILED'
  | 'EMPTY_CANVAS';

export class WorkshopError extends Error {
  readonly code: WorkshopErrorCode;
  readonly details?: unknown;

  constructor(code: WorkshopErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkshopError';
    this.code = code;
    this.details = details;
  }
}
