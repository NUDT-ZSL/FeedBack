import { MAX_RECORDS } from './constants';
import { derive } from './derive';
import type { DipStatus, DyeRecord, DyeingParams, EngineState } from './types';

export function createEngineState(): EngineState {
  return { dipCount: 0, records: [], appliedOpIds: [], lockedUntil: 0 };
}

export interface DipOutcome {
  state: EngineState;
  status: DipStatus;
  record?: DyeRecord;
}

/**
 * 应用一次浸染操作（幂等）：
 * - 相同 opId 重复提交 → 'duplicate'，状态原样返回，浸染次数不重复累加；
 * - 氧化锁定期间（连续快速点击）→ 'locked'，状态原样返回；
 * - 正常受理 → 浸染次数 +1，追加记录，并按晾晒时长进入氧化锁定。
 */
export function applyDip(
  state: EngineState,
  opId: string,
  now: number,
  params: DyeingParams,
): DipOutcome {
  if (state.appliedOpIds.includes(opId)) {
    return { state, status: 'duplicate' };
  }
  if (now < state.lockedUntil) {
    return { state, status: 'locked' };
  }
  const derivation = derive({ ...params, dipCount: state.dipCount + 1 });
  const record: DyeRecord = {
    id: opId,
    round: derivation.params.dipCount,
    timestamp: new Date(now).toISOString(),
    oxidationSeconds: derivation.params.airDrySec,
    colorHex: derivation.result.colorHex,
  };
  return {
    state: {
      dipCount: derivation.params.dipCount,
      records: [...state.records, record].slice(-MAX_RECORDS),
      appliedOpIds: [...state.appliedOpIds, opId],
      lockedUntil: now + derivation.params.airDrySec * 1000,
    },
    status: 'applied',
    record,
  };
}

/** 回退到指定轮次：截断记录、重置浸染次数并解除氧化锁定。 */
export function revertTo(state: EngineState, round: number): EngineState {
  const target = Math.max(0, Math.min(state.dipCount, Math.floor(round)));
  return {
    ...state,
    dipCount: target,
    records: state.records.filter((record) => record.round <= target),
    lockedUntil: 0,
  };
}

/** 距离氧化锁定解除还剩多少毫秒（<=0 表示可以浸染）。 */
export function remainingLockMs(state: EngineState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}
