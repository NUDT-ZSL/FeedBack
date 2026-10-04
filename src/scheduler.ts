import { copyParams, paramsEqual, type NebulaParams } from './params.ts';

export type ScheduleFrame = (callback: () => void) => void;
export type ApplySnapshot = (params: NebulaParams) => void;

export interface UpdateScheduler {
  push(params: NebulaParams): void;
  flush(): void;
  pending(): boolean;
}

export function createUpdateScheduler(
  scheduleFrame: ScheduleFrame,
  applySnapshot: ApplySnapshot
): UpdateScheduler {
  let latest: NebulaParams | null = null;
  let lastApplied: NebulaParams | null = null;
  let scheduled = false;

  function flush(): void {
    scheduled = false;

    if (latest === null) {
      return;
    }

    const snapshot = latest;
    latest = null;

    if (lastApplied !== null && paramsEqual(snapshot, lastApplied)) {
      return;
    }

    lastApplied = copyParams(snapshot);
    applySnapshot(snapshot);
  }

  return {
    push(params: NebulaParams): void {
      latest = copyParams(params);

      if (!scheduled) {
        scheduled = true;
        scheduleFrame(flush);
      }
    },

    flush,

    pending(): boolean {
      return scheduled || latest !== null;
    }
  };
}
