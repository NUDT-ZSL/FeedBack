export interface DeleteQueueOptions {
  animationDuration?: number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timerId: unknown) => void;
  onDelete?: (id: string) => void;
}

export interface DeleteQueue {
  requestDelete: (id: string) => void;
  cancel: (id: string) => boolean;
  getPendingIds: () => string[];
  getVersion: () => number;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}

export function createDeleteQueue(options?: DeleteQueueOptions): DeleteQueue;
