/**
 * 排产与工时推演核心引擎（纯函数，可离线调用）。
 *
 * 确定性保证：
 *  - 输入先按 id 规范化排序，所有遍历顺序与调用方传入的数组顺序无关；
 *  - 竞争裁决统一走 adjudicate.ts 的比较器，规则留痕；
 *  - 时间换算只依赖 UTC 纪元分钟与固定时区偏移。
 */
import {
  ADJUDICATION_RULES,
  chooseLoom,
  compareOperations,
  type AdjudicationContext,
} from './adjudicate';
import { addWorkMinutes, isoToMinute, minuteToIso, roundMinute, snapToWork } from './calendar';
import { contentHash } from './hash';
import type {
  ConflictRecord,
  DecisionTrace,
  Loom,
  Operation,
  Order,
  OrderCompletion,
  ScheduleInput,
  ScheduleResult,
  ScheduledSegment,
} from './types';

export const ENGINE_VERSION = '1.0.0';

export interface EngineOptions {
  mode?: 'full' | 'incremental';
  /** 冻结保留的既有占用（局部重算时传入）。 */
  pinned?: ScheduledSegment[];
}

interface EngineState {
  loomsById: Map<string, Loom>;
  ordersById: Map<string, Order>;
  operationsById: Map<string, Operation>;
  loomFreeAt: Map<string, number>;
  operationEnd: Map<string, number>;
  segments: ScheduledSegment[];
  traces: DecisionTrace[];
  conflicts: ConflictRecord[];
  conflictSeq: number;
}

function nextConflictId(state: EngineState): string {
  state.conflictSeq += 1;
  return `C-${String(state.conflictSeq).padStart(3, '0')}`;
}

function makeSegment(
  operation: Operation,
  loomId: string,
  startMinute: number,
  endMinute: number,
  pinned: boolean,
): ScheduledSegment {
  return {
    operationId: operation.id,
    orderId: operation.orderId,
    loomId,
    startMinute: roundMinute(startMinute),
    endMinute: roundMinute(endMinute),
    startAt: minuteToIso(startMinute),
    endAt: minuteToIso(endMinute),
    pinned,
  };
}

/** 找出两条工序之间第一条分出胜负的裁决规则，用于留痕。 */
function decidingRule(a: Operation, b: Operation, ctx: AdjudicationContext): string {
  const orderA = ctx.ordersById.get(a.orderId);
  const orderB = ctx.ordersById.get(b.orderId);
  if (orderA && orderB) {
    if (orderA.priority !== orderB.priority) return ADJUDICATION_RULES[0];
    if (Date.parse(orderA.dueAt) !== Date.parse(orderB.dueAt)) return ADJUDICATION_RULES[1];
    const remainA = ctx.remainingWorkByOrder.get(a.orderId) ?? 0;
    const remainB = ctx.remainingWorkByOrder.get(b.orderId) ?? 0;
    if (remainA !== remainB) return ADJUDICATION_RULES[2];
  }
  return ADJUDICATION_RULES[3];
}

/** 登记冻结段：检测钉单重叠等硬冲突，保留双方并留证。 */
function absorbPinned(state: EngineState, pinned: ScheduledSegment[]): Set<string> {
  const pinnedOps = new Set<string>();
  const byLoom = new Map<string, ScheduledSegment[]>();
  for (const segment of pinned) {
    pinnedOps.add(segment.operationId);
    const list = byLoom.get(segment.loomId) ?? [];
    list.push(segment);
    byLoom.set(segment.loomId, list);
  }
  for (const [loomId, list] of [...byLoom.entries()].sort()) {
    const sorted = [...list].sort((a, b) =>
      a.startMinute - b.startMinute || (a.operationId < b.operationId ? -1 : 1),
    );
    let freeAt = -Infinity;
    for (const segment of sorted) {
      if (segment.startMinute < freeAt - 1e-9) {
        // 钉单之间互相重叠：无法裁决，双方保留，留证。
        const overlapStart = segment.startMinute;
        const overlapEnd = Math.min(freeAt, segment.endMinute);
        const others = sorted
          .filter(
            (s) =>
              s.operationId !== segment.operationId &&
              s.startMinute < overlapEnd &&
              s.endMinute > overlapStart,
          )
          .map((s) => s.operationId)
          .sort();
        state.conflicts.push({
          id: nextConflictId(state),
          loomId,
          operationIds: [...others, segment.operationId].sort(),
          interval: { startMinute: roundMinute(overlapStart), endMinute: roundMinute(overlapEnd) },
          reason: 'pinned-overlap',
          adjudication: '无法裁决：冻结/钉单占用互相重叠，双方均保留在时间轴上',
          evidence: {
            retainedOperationIds: [...others, segment.operationId].sort(),
            overlapInterval: [roundMinute(overlapStart), roundMinute(overlapEnd)],
            segments: sorted
              .filter((s) => s.startMinute < overlapEnd && s.endMinute > overlapStart)
              .map((s) => ({ operationId: s.operationId, start: s.startAt, end: s.endAt })),
          },
        });
        state.traces.push({
          kind: 'conflict',
          atMinute: roundMinute(overlapStart),
          loomId,
          operationId: segment.operationId,
          rule: '保留双方',
          detail: `钉单重叠 [${minuteToIso(overlapStart)} ~ ${minuteToIso(overlapEnd)}]，与 ${others.join('、')} 同时保留`,
          contenders: others,
        });
      }
      freeAt = Math.max(freeAt, segment.endMinute);
      const operation = state.operationsById.get(segment.operationId);
      if (!operation) {
        state.conflicts.push({
          id: nextConflictId(state),
          loomId,
          operationIds: [segment.operationId],
          interval: { startMinute: segment.startMinute, endMinute: segment.endMinute },
          reason: 'pinned-stale',
          adjudication: '无法裁决：钉单引用的工序已不存在，占用原样保留',
          evidence: { retainedOperationIds: [segment.operationId], segment },
        });
      } else {
        state.operationEnd.set(segment.operationId, segment.endMinute);
      }
    }
    state.loomFreeAt.set(loomId, freeAt === -Infinity ? 0 : freeAt);
    state.segments.push(...sorted);
  }
  return pinnedOps;
}

export function runSchedule(input: ScheduleInput, options: EngineOptions = {}): ScheduleResult {
  const mode = options.mode ?? 'full';
  const horizonMinute = isoToMinute(input.horizonStart);

  // 规范化排序：消除调用方数组顺序对结果的影响。
  const looms = [...input.looms].sort((a, b) => (a.id < b.id ? -1 : 1));
  const orders = [...input.orders].sort((a, b) => (a.id < b.id ? -1 : 1));
  const operations = [...input.operations].sort((a, b) => (a.id < b.id ? -1 : 1));

  const state: EngineState = {
    loomsById: new Map(looms.map((loom) => [loom.id, loom])),
    ordersById: new Map(orders.map((order) => [order.id, order])),
    operationsById: new Map(operations.map((operation) => [operation.id, operation])),
    loomFreeAt: new Map(looms.map((loom) => [loom.id, horizonMinute])),
    operationEnd: new Map(),
    segments: [],
    traces: [],
    conflicts: [],
    conflictSeq: 0,
  };

  for (const loom of looms) {
    if (!(loom.efficiency > 0)) {
      throw new Error(`织机 ${loom.id} 效率系数必须为正数，当前为 ${loom.efficiency}`);
    }
  }

  const pinnedOps = absorbPinned(state, options.pinned ?? []);

  const unscheduled = new Map(
    operations.filter((operation) => !pinnedOps.has(operation.id)).map((o) => [o.id, o]),
  );
  const remainingWorkByOrder = new Map<string, number>();
  for (const operation of unscheduled.values()) {
    remainingWorkByOrder.set(
      operation.orderId,
      (remainingWorkByOrder.get(operation.orderId) ?? 0) + operation.workMinutes,
    );
  }
  const ctx: AdjudicationContext = {
    ordersById: state.ordersById,
    operationsById: state.operationsById,
    remainingWorkByOrder,
  };

  const readyMinuteOf = (operation: Operation): number => {
    const order = state.ordersById.get(operation.orderId);
    let ready = order ? Math.max(horizonMinute, isoToMinute(order.releaseAt)) : horizonMinute;
    for (const dependency of operation.dependsOn) {
      const end = state.operationEnd.get(dependency);
      if (end !== undefined && end > ready) {
        ready = end;
      }
    }
    return roundMinute(ready);
  };

  const dependenciesDone = (operation: Operation): boolean =>
    operation.dependsOn.every(
      (dependency) =>
        state.operationEnd.has(dependency) || !state.operationsById.has(dependency),
    );

  for (let guard = 0; guard < 100000 && unscheduled.size > 0; guard += 1) {
    const ready = [...unscheduled.values()].filter(dependenciesDone);
    if (ready.length === 0) {
      // 前置依赖成环或引用缺失：无法裁决，全部保留为未排并留证。
      const stuck = [...unscheduled.keys()].sort();
      state.conflicts.push({
        id: nextConflictId(state),
        loomId: '',
        operationIds: stuck,
        interval: { startMinute: horizonMinute, endMinute: horizonMinute },
        reason: 'dependency-deadlock',
        adjudication: '无法裁决：工序前置依赖无法全部满足，相关工序保留为未排产',
        evidence: { retainedOperationIds: stuck },
      });
      break;
    }
    const t = Math.min(...ready.map(readyMinuteOf));
    const batch = ready
      .filter((operation) => readyMinuteOf(operation) <= t + 1e-9)
      .sort((a, b) => compareOperations(a, b, ctx));

    // 同批竞争同一织机时的让位记录：deferred[loomId] = {winner, losers}
    const loomContention = new Map<string, { winner: Operation; losers: Operation[] }>();

    for (const operation of batch) {
      const readyMinute = readyMinuteOf(operation);
      const choice = chooseLoom(
        operation,
        readyMinute,
        state.loomsById,
        state.loomFreeAt,
        (loom, minute) => snapToWork(loom.calendar, minute),
      );
      if (!choice) {
        state.conflicts.push({
          id: nextConflictId(state),
          loomId: '',
          operationIds: [operation.id],
          interval: { startMinute: readyMinute, endMinute: readyMinute },
          reason: 'no-candidate-loom',
          adjudication: '无法裁决：工序没有可用候选织机，保留为未排产',
          evidence: { retainedOperationIds: [operation.id], loomIds: operation.loomIds },
        });
        unscheduled.delete(operation.id);
        continue;
      }
      const { loom, startMinute } = choice;
      const workMinutes = operation.workMinutes / loom.efficiency;
      const endMinute = addWorkMinutes(loom.calendar, startMinute, workMinutes);
      state.segments.push(makeSegment(operation, loom.id, startMinute, endMinute, false));
      state.loomFreeAt.set(loom.id, endMinute);
      state.operationEnd.set(operation.id, endMinute);
      unscheduled.delete(operation.id);
      remainingWorkByOrder.set(
        operation.orderId,
        (remainingWorkByOrder.get(operation.orderId) ?? 0) - operation.workMinutes,
      );
      state.traces.push({
        kind: 'assign',
        atMinute: roundMinute(startMinute),
        loomId: loom.id,
        operationId: operation.id,
        rule: 'L1/L2 织机选择',
        detail: `工序 ${operation.id} 于 ${minuteToIso(startMinute)} 上机 ${loom.id}，折合作业 ${roundMinute(workMinutes)} 分钟`,
        contenders: [],
      });

      if (batch.length > 1) {
        const contention = loomContention.get(loom.id);
        if (!contention) {
          loomContention.set(loom.id, { winner: operation, losers: [] });
        } else if (startMinute > t + 1e-9) {
          contention.losers.push(operation);
        }
      }
    }

    for (const [loomId, { winner, losers }] of [...loomContention.entries()].sort()) {
      if (losers.length === 0) continue;
      const rule = decidingRule(winner, losers[0], ctx);
      state.traces.push({
        kind: 'adjudicate',
        atMinute: roundMinute(t),
        loomId,
        operationId: winner.id,
        rule,
        detail: `织机 ${loomId} 在 ${minuteToIso(t)} 发生竞争，${winner.id} 依「${rule}」先排，${losers
          .map((loser) => loser.id)
          .join('、')} 顺延`,
        contenders: losers.map((loser) => loser.id).sort(),
      });
    }
  }

  const segments = [...state.segments].sort(
    (a, b) =>
      (a.loomId < b.loomId ? -1 : a.loomId > b.loomId ? 1 : 0) ||
      a.startMinute - b.startMinute ||
      (a.operationId < b.operationId ? -1 : 1),
  );

  const orderCompletions: OrderCompletion[] = orders.map((order) => {
    const ends = operations
      .filter((operation) => operation.orderId === order.id)
      .map((operation) => state.operationEnd.get(operation.id));
    const complete = ends.every((end) => end !== undefined);
    const completionMinute = complete && ends.length > 0 ? Math.max(...(ends as number[])) : null;
    return {
      orderId: order.id,
      completionMinute: completionMinute === null ? null : roundMinute(completionMinute),
      completionAt: completionMinute === null ? null : minuteToIso(completionMinute),
    };
  });

  const conflicts = [...state.conflicts].sort((a, b) => (a.id < b.id ? -1 : 1));
  // 摘要只刻画可观察排产结果：占用顺序、起止时刻、完成时刻与冲突裁决，
  // 不含 pinned 标记等来源信息，因此局部重算与整体重算的摘要可直接比对。
  const stripPinned = (segment: ScheduledSegment): Omit<ScheduledSegment, 'pinned'> => {
    const copy = { ...segment };
    delete copy.pinned;
    return copy;
  };
  const digest = contentHash({
    segments: segments.map(stripPinned),
    orderCompletions,
    conflicts,
  });

  return {
    segments,
    orderCompletions,
    conflicts,
    traces: state.traces,
    meta: {
      engineVersion: ENGINE_VERSION,
      mode,
      inputHash: contentHash({ looms, orders, operations, horizonStart: input.horizonStart }),
      resultDigest: digest,
    },
  };
}
