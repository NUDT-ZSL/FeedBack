import type { NebulaParams } from './params.ts';
import { cloneParams } from './params.ts';

export type ParamCommitHandler = (params: NebulaParams) => void;
export type ScheduleFn = (callback: () => void) => void;

export interface ParamScheduler {
  push(params: NebulaParams): void;
  flush(): void;
}

const defaultSchedule: ScheduleFn = (callback) => {
  requestAnimationFrame(() => callback());
};

export function createParamScheduler(
  onCommit: ParamCommitHandler,
  schedule: ScheduleFn = defaultSchedule
): ParamScheduler {
  let pending: NebulaParams | null = null;
  let scheduled = false;

  const commit = (): void => {
    const params = pending;
    pending = null;
    if (params !== null) {
      onCommit(params);
    }
  };

  return {
    push(params: NebulaParams): void {
      pending = cloneParams(params);
      if (!scheduled) {
        scheduled = true;
        schedule(() => {
          scheduled = false;
          commit();
        });
      }
    },
    flush(): void {
      commit();
    }
  };
}
