/**
 * 排产触发入口（模拟界面上的多个触发点：手动排产、订单变更联动、织机看板重排）。
 * 所有入口共享同一推演内核 runSchedule，仅入参装配方式不同，
 * 因此同一批数据从任何入口触发，结论必然一致（由验证器交叉断言）。
 */
import { runSchedule } from './engine.ts';
import { rescheduleIncremental } from './incremental.ts';
import type {
  IncrementalResult,
  SchedulingChange,
  SchedulingInput,
  ScheduleResult,
} from './types.ts';

/** 入口一：手动全量排产（“排产工作台-立即排产”按钮） */
export function entryManualSchedule(input: SchedulingInput): ScheduleResult {
  return runSchedule(input);
}

/** 入口二：订单变更联动（订单/工序编辑保存后自动触发） */
export function entryOrderChangeCascade(input: SchedulingInput): ScheduleResult {
  return runSchedule(input);
}

/** 入口三：织机看板重排（织机能力调整后从看板触发） */
export function entryLoomBoardReplan(input: SchedulingInput): ScheduleResult {
  return runSchedule(input);
}

/** 入口四：局部调整后的增量重推（只重推受影响排布） */
export function entryIncrementalReplan(
  input: SchedulingInput,
  baseline: ScheduleResult,
  change: SchedulingChange,
): IncrementalResult {
  return rescheduleIncremental(input, baseline, change);
}

export const FULL_ENTRIES = [
  { name: '手动排产', fn: entryManualSchedule },
  { name: '订单变更联动', fn: entryOrderChangeCascade },
  { name: '织机看板重排', fn: entryLoomBoardReplan },
] as const;
