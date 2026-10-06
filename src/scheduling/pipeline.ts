/**
 * 调用收敛层：界面入口与服务端入口都只经由这里调用引擎，
 * 保证同一份输入无论从哪个入口进入都得到同一份结果。
 */
import { runSchedule } from './engine';
import { applyRevision, recomputeAffected } from './incremental';
import type {
  IncrementalResult,
  ScheduleInput,
  ScheduleResult,
  ScheduleRevision,
} from './types';

/** 界面入口：组件/页面直接调用。 */
export function runScheduleViaUi(input: ScheduleInput): ScheduleResult {
  return runSchedule(input, { mode: 'full' });
}

/** 直接调用入口：离线脚本、HTTP 服务等非界面路径调用。 */
export function runScheduleViaService(input: ScheduleInput): ScheduleResult {
  return runSchedule(input, { mode: 'full' });
}

export function recomputeViaUi(
  input: ScheduleInput,
  revision: ScheduleRevision,
  previous: ScheduleResult,
): IncrementalResult {
  return recomputeAffected(input, revision, previous);
}

export function recomputeViaService(
  input: ScheduleInput,
  revision: ScheduleRevision,
  previous: ScheduleResult,
): IncrementalResult {
  return recomputeAffected(input, revision, previous);
}

export { applyRevision };

/** 比对两份排产的可观察结果（占用顺序、完成时刻、冲突裁决）。 */
export function resultsMatch(a: ScheduleResult, b: ScheduleResult): boolean {
  return a.meta.resultDigest === b.meta.resultDigest;
}
