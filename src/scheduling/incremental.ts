/**
 * 局部重算：参数修正后只重算受影响的订单与时间段。
 *
 * 思路：
 *  1. 依据被修正字段圈定直接受影响的工序；
 *  2. 求重算时间界 frontier —— 在此之前的任何排产决定都不可能被本次修正改变；
 *  3. 冻结 frontier 之前的既有占用，作为钉单送入引擎，之后的工序整体重排；
 *  4. 与"用修正后的输入整体重算"使用同一引擎、同一规则，结果必然一致。
 */
import { isoToMinute, minuteToIso, roundMinute } from './calendar';
import { runSchedule } from './engine';
import type {
  AffectedScope,
  IncrementalResult,
  ScheduleInput,
  ScheduleResult,
  ScheduleRevision,
  ScheduledSegment,
} from './types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 应用修正，得到一份新的规范化输入（不改动原对象）。 */
export function applyRevision(input: ScheduleInput, revision: ScheduleRevision): ScheduleInput {
  const next = deepClone(input);
  if (revision.loomEfficiency) {
    for (const [loomId, efficiency] of Object.entries(revision.loomEfficiency)) {
      const loom = next.looms.find((item) => item.id === loomId);
      if (loom) loom.efficiency = efficiency;
    }
  }
  if (revision.loomCalendar) {
    for (const [loomId, calendar] of Object.entries(revision.loomCalendar)) {
      const loom = next.looms.find((item) => item.id === loomId);
      if (loom) loom.calendar = deepClone(calendar);
    }
  }
  if (revision.operationWorkMinutes) {
    for (const [operationId, workMinutes] of Object.entries(revision.operationWorkMinutes)) {
      const operation = next.operations.find((item) => item.id === operationId);
      if (operation) operation.workMinutes = workMinutes;
    }
  }
  if (revision.operationLoomIds) {
    for (const [operationId, loomIds] of Object.entries(revision.operationLoomIds)) {
      const operation = next.operations.find((item) => item.id === operationId);
      if (operation) operation.loomIds = deepClone(loomIds);
    }
  }
  if (revision.orderPriority) {
    for (const [orderId, priority] of Object.entries(revision.orderPriority)) {
      const order = next.orders.find((item) => item.id === orderId);
      if (order) order.priority = priority;
    }
  }
  if (revision.orderDueAt) {
    for (const [orderId, dueAt] of Object.entries(revision.orderDueAt)) {
      const order = next.orders.find((item) => item.id === orderId);
      if (order) order.dueAt = dueAt;
    }
  }
  return next;
}

function segmentEndsByOp(previous: ScheduleResult): Map<string, number> {
  const ends = new Map<string, number>();
  for (const segment of previous.segments) {
    const end = ends.get(segment.operationId);
    if (end === undefined || segment.endMinute > end) {
      ends.set(segment.operationId, segment.endMinute);
    }
  }
  return ends;
}

function segmentStartsByOp(previous: ScheduleResult): Map<string, number> {
  const starts = new Map<string, number>();
  for (const segment of previous.segments) {
    const start = starts.get(segment.operationId);
    if (start === undefined || segment.startMinute < start) {
      starts.set(segment.operationId, segment.startMinute);
    }
  }
  return starts;
}

/**
 * 计算重算时间界与受影响工序集合。
 */
export function computeFrontier(
  input: ScheduleInput,
  revision: ScheduleRevision,
  previous: ScheduleResult,
): { frontierMinute: number; affectedOperationIds: Set<string> } {
  const horizonMinute = isoToMinute(input.horizonStart);
  const changedWorkOps = new Set(Object.keys(revision.operationWorkMinutes ?? {}));
  const changedLoomOps = new Set(Object.keys(revision.operationLoomIds ?? {}));
  const changedOrders = new Set([
    ...Object.keys(revision.orderPriority ?? {}),
    ...Object.keys(revision.orderDueAt ?? {}),
  ]);

  const revised = revision.operationLoomIds ?? {};
  const previousEnds = segmentEndsByOp(previous);
  const previousStarts = segmentStartsByOp(previous);
  const efficiencyLooms = new Set(Object.keys(revision.loomEfficiency ?? {}));
  const calendarLooms = new Set(Object.keys(revision.loomCalendar ?? {}));
  const ordersById = new Map(input.orders.map((order) => [order.id, order]));
  const operationsById = new Map(input.operations.map((operation) => [operation.id, operation]));

  const readyTimeInPrevious = (operationId: string): number => {
    const operation = operationsById.get(operationId);
    if (!operation) return horizonMinute;
    const order = ordersById.get(operation.orderId);
    let ready = order ? Math.max(horizonMinute, isoToMinute(order.releaseAt)) : horizonMinute;
    for (const dependency of operation.dependsOn) {
      const end = previousEnds.get(dependency);
      if (end !== undefined) ready = Math.max(ready, end);
    }
    return roundMinute(ready);
  };

  const affected = new Set<string>();
  let frontier = Infinity;
  const consider = (operationId: string, bound: number) => {
    affected.add(operationId);
    frontier = Math.min(frontier, bound);
  };

  // 效率修正：机台选择只看可开工时刻，与效率无关；被改织机在其首段占用之前的
  // 可用性不变，因此重算界即该织机第一段既有占用的起点。
  for (const loomId of efficiencyLooms) {
    for (const segment of previous.segments) {
      if (segment.loomId === loomId) {
        consider(segment.operationId, segment.startMinute);
      }
    }
  }

  // 工作历修正：织机可用性全程都可能改变，所有把它列为候选（修正前后）的工序
  // 都可能重新决策，重算界取这些工序的最早就绪时刻。
  if (calendarLooms.size > 0) {
    for (const operation of input.operations) {
      const loomIdsAfter = revised[operation.id] ?? operation.loomIds;
      const touches =
        operation.loomIds.some((id) => calendarLooms.has(id)) ||
        loomIdsAfter.some((id) => calendarLooms.has(id));
      if (touches) {
        consider(operation.id, readyTimeInPrevious(operation.id));
      }
    }
  }

  for (const operation of input.operations) {
    if (changedLoomOps.has(operation.id)) {
      // 候选织机变化可能让本工序更早开工，下界取其就绪时刻。
      consider(operation.id, readyTimeInPrevious(operation.id));
      continue;
    }
    if (changedOrders.has(operation.orderId)) {
      // 优先级/交期变化改变裁决结果，本订单工序可能赢得更早的竞争，
      // 下界取其就绪时刻（不早于订单可开工时间）。
      consider(operation.id, readyTimeInPrevious(operation.id));
      continue;
    }
    if (changedWorkOps.has(operation.id)) {
      // 工时变化不改变本工序的开工时刻（就绪时间与此前占用均不变），
      // 只影响其完成时刻及后续，下界取其既有开工时刻。
      const previousStart = previousStarts.get(operation.id);
      consider(operation.id, previousStart ?? readyTimeInPrevious(operation.id));
    }
  }

  if (!Number.isFinite(frontier)) {
    frontier = horizonMinute;
  }
  return { frontierMinute: roundMinute(Math.max(horizonMinute, frontier)), affectedOperationIds: affected };
}

/**
 * 局部重算入口：返回新的排产结果（冻结段 pinned=true）与受影响范围。
 */
export function recomputeAffected(
  input: ScheduleInput,
  revision: ScheduleRevision,
  previous: ScheduleResult,
): IncrementalResult {
  const revised = applyRevision(input, revision);
  const { frontierMinute } = computeFrontier(input, revision, previous);

  // 冻结：在 frontier 之前结束的既有占用原样保留。
  const frozen: ScheduledSegment[] = previous.segments.filter(
    (segment) => segment.endMinute <= frontierMinute + 1e-9,
  );

  const result = runSchedule(revised, { mode: 'incremental', pinned: frozen });

  const frozenOpIds = new Set(frozen.map((segment) => segment.operationId));
  const affectedOperationIds = revised.operations
    .filter((operation) => !frozenOpIds.has(operation.id))
    .map((operation) => operation.id)
    .sort();
  const orderIds = [...new Set(affectedOperationIds.map((id) => {
    const operation = revised.operations.find((item) => item.id === id);
    return operation?.orderId ?? '';
  }))]
    .filter(Boolean)
    .sort();

  const affected: AffectedScope = {
    fromMinute: frontierMinute,
    fromAt: minuteToIso(frontierMinute),
    orderIds,
    operationIds: affectedOperationIds,
  };
  return { result, affected };
}
