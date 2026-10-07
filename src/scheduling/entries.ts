import { rescheduleAffected } from './incremental.ts';
import type { ChangeSet } from './incremental.ts';
import { scheduleAll } from './scheduler.ts';
import type {
  Adjudication,
  ScheduleFailure,
  ScheduleResult,
  ScheduledOp,
  SchedulingInput,
} from './types.ts';

export interface EntryView {
  ok: boolean;
  byOrder: Record<string, ScheduledOp[]>;
  byLoom: Record<string, ScheduledOp[]>;
  failures: ScheduleFailure[];
  adjudications: Adjudication[];
}

function project(result: ScheduleResult): EntryView {
  const byOrder: Record<string, ScheduledOp[]> = {};
  const byLoom: Record<string, ScheduledOp[]> = {};
  for (const s of result.scheduled) {
    (byOrder[s.orderId] ??= []).push(s);
    (byLoom[s.loomId] ??= []).push(s);
  }
  return {
    ok: result.ok,
    byOrder,
    byLoom,
    failures: result.failures,
    adjudications: result.adjudications,
  };
}

export function triggerFromOrders(input: SchedulingInput): EntryView {
  return project(scheduleAll(input));
}

export function triggerFromLoomBoard(input: SchedulingInput): EntryView {
  return project(scheduleAll(input));
}

export interface OperationEditView extends EntryView {
  impacted: { opId: string; reasons: string[] }[];
}

export function triggerAfterOperationEdit(
  prevInput: SchedulingInput,
  changes: ChangeSet,
  prevResult: ScheduleResult,
): OperationEditView {
  const { result, impacted } = rescheduleAffected(prevInput, changes, prevResult);
  return { ...project(result), impacted };
}
