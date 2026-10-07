/**
 * 排产与工时推演内核（唯一事实来源）。
 *
 * 确定性规则（同输入必同输出，与触发入口无关）：
 *  1. 拓扑序：Kahn 算法，就绪集合中始终先取 stepId 字典序最小者；
 *  2. 织机候选：按 工序类型 匹配能力，裁决键为 (priority 升序, 最早空档开工, loomId 字典序)；
 *  3. 开工时刻：max(订单投料, 各前置完工) 之后在所选织机上寻找第一段不重叠空档；
 *  4. 顺延依据：开工晚于就绪时刻时，记录占用织机的具体工序与时刻。
 */
import type {
  Adjudication,
  Capability,
  Finding,
  LoomSummary,
  OrderSummary,
  ScheduledStep,
  SchedulingInput,
  ScheduleResult,
} from './types.ts';
import { hasErrors, validateInput } from './validate.ts';

interface Interval {
  start: number;
  end: number;
  stepId: string;
}

/** 锚点：增量重推时保持不动的工序结论与裁决 */
export interface ScheduleAnchors {
  entries: ReadonlyMap<string, ScheduledStep>;
  adjudications: ReadonlyMap<string, Adjudication>;
}

export function runSchedule(input: SchedulingInput, anchors?: ScheduleAnchors): ScheduleResult {
  const findings: Finding[] = validateInput(input);
  if (hasErrors(findings)) {
    return {
      ok: false,
      findings,
      entries: [],
      adjudications: [],
      loomSummaries: [],
      orderSummaries: [],
    };
  }

  const stepById = new Map(input.steps.map((s) => [s.id, s]));
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const capsByType = new Map<string, Capability[]>();
  for (const cap of input.capabilities) {
    const list = capsByType.get(cap.processType) ?? [];
    list.push(cap);
    capsByType.set(cap.processType, list);
  }

  const order = topologicalOrder(input);
  const placed = new Map<string, ScheduledStep>();
  const intervals = new Map<string, Interval[]>();
  for (const loom of input.looms) intervals.set(loom.id, []);
  const adjudications: Adjudication[] = [];

  for (const stepId of order) {
    const anchored = anchors?.entries.get(stepId);
    if (anchored && anchors) {
      placed.set(stepId, anchored);
      insertInterval(intervals.get(anchored.loomId)!, {
        start: anchored.startMinute,
        end: anchored.endMinute,
        stepId,
      });
      const anchoredAdj = anchors.adjudications.get(stepId);
      if (anchoredAdj) adjudications.push(anchoredAdj);
      continue;
    }
    const step = stepById.get(stepId)!;
    const orderEntity = orderById.get(step.orderId)!;
    const depEnds = step.dependsOn.map((d) => placed.get(d)!.endMinute);
    const readyMinute = Math.max(orderEntity.releaseMinute, ...depEnds);

    const candidates = (capsByType.get(step.processType) ?? [])
      .slice()
      .sort((a, b) => a.priority - b.priority || a.loomId.localeCompare(b.loomId));

    const scored = candidates.map((cap) => ({
      cap,
      start: earliestGap(intervals.get(cap.loomId)!, readyMinute, step.standardMinutes),
    }));
    scored.sort(
      (a, b) =>
        a.cap.priority - b.cap.priority ||
        a.start - b.start ||
        a.cap.loomId.localeCompare(b.cap.loomId),
    );
    const winner = scored[0];
    const endMinute = winner.start + step.standardMinutes;

    insertInterval(intervals.get(winner.cap.loomId)!, {
      start: winner.start,
      end: endMinute,
      stepId,
    });

    const delayMinutes = winner.start - readyMinute;
    let delayReason = '';
    if (delayMinutes > 0) {
      const blocker = findBlocker(intervals.get(winner.cap.loomId)!, winner.start, stepId);
      delayReason = blocker
        ? `织机 ${winner.cap.loomId} 在 ${readyMinute} 前被工序 ${blocker.stepId} 占用至 ${blocker.end}，档期顺延至 ${winner.start}`
        : `织机 ${winner.cap.loomId} 空档约束，档期顺延至 ${winner.start}`;
    }

    placed.set(stepId, {
      stepId,
      orderId: step.orderId,
      processType: step.processType,
      loomId: winner.cap.loomId,
      startMinute: winner.start,
      endMinute,
      workMinutes: step.standardMinutes,
      delay: {
        readyMinute,
        startMinute: winner.start,
        delayMinutes,
        reason: delayReason,
      },
    });

    adjudications.push({
      stepId,
      processType: step.processType,
      selectedLoomId: winner.cap.loomId,
      reason: `裁决键 (优先级=${winner.cap.priority}, 最早空档=${winner.start}, 织机id=${winner.cap.loomId}) 最优`,
      candidates: scored.map((s) => {
        const isWinner = s === winner;
        return {
          loomId: s.cap.loomId,
          priority: s.cap.priority,
          outcome: isWinner ? ('selected' as const) : ('rejected' as const),
          reason: isWinner
            ? `被选中：最早可于 ${s.start} 开工`
            : rejectionReason(s, winner),
        };
      }),
    });
  }

  const entries = [...placed.values()].sort(
    (a, b) => a.startMinute - b.startMinute || a.stepId.localeCompare(b.stepId),
  );
  const loomSummaries = buildLoomSummaries(input, intervals);
  const orderSummaries = buildOrderSummaries(input, placed);

  return {
    ok: true,
    findings,
    entries,
    adjudications: adjudications.sort((a, b) => a.stepId.localeCompare(b.stepId)),
    loomSummaries,
    orderSummaries,
  };
}

type ScoredCandidate = { cap: Capability; start: number };

function rejectionReason(s: ScoredCandidate, winner: ScoredCandidate): string {
  if (s.cap.priority !== winner.cap.priority) {
    return `未选中：优先级 ${s.cap.priority} 劣于 ${winner.cap.loomId} 的优先级 ${winner.cap.priority}`;
  }
  if (s.start !== winner.start) {
    return `未选中：同优先级下最早空档 ${s.start} 晚于 ${winner.cap.loomId} 的 ${winner.start}`;
  }
  return `未选中：同优先级同空档时织机 id 字典序靠后，裁给 ${winner.cap.loomId}`;
}

/** Kahn 拓扑序，每一步在就绪集合中取 stepId 最小者，保证确定性 */
function topologicalOrder(input: SchedulingInput): string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of input.steps) {
    indegree.set(step.id, 0);
    dependents.set(step.id, []);
  }
  for (const step of input.steps) {
    indegree.set(step.id, step.dependsOn.length);
    for (const dep of step.dependsOn) {
      dependents.get(dep)!.push(step.id);
    }
  }
  const ready = input.steps.map((s) => s.id).filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const current = ready.shift()!;
    order.push(current);
    for (const child of dependents.get(current)!) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) ready.push(child);
    }
  }
  return order;
}

/** 在已排序的占用区间序列中，找 >= ready 的最早可容纳 dur 分钟的空档起点 */
function earliestGap(list: Interval[], ready: number, dur: number): number {
  const sorted = list.slice().sort((a, b) => a.start - b.start);
  let cursor = ready;
  for (const iv of sorted) {
    if (cursor + dur <= iv.start) return cursor;
    if (cursor < iv.end) cursor = iv.end;
  }
  return cursor;
}

function insertInterval(list: Interval[], iv: Interval): void {
  list.push(iv);
  list.sort((a, b) => a.start - b.start);
}

function findBlocker(list: Interval[], start: number, selfStepId: string): Interval | null {
  return (
    list
      .filter((iv) => iv.stepId !== selfStepId && iv.end <= start)
      .sort((a, b) => b.end - a.end)[0] ?? null
  );
}

function buildLoomSummaries(
  input: SchedulingInput,
  intervals: Map<string, Interval[]>,
): LoomSummary[] {
  const horizon = Math.max(
    0,
    ...input.looms.map((l) => {
      const list = intervals.get(l.id)!;
      return list.length === 0 ? 0 : Math.max(...list.map((iv) => iv.end));
    }),
  );
  return input.looms
    .map((loom) => {
      const list = intervals.get(loom.id)!;
      const busyMinutes = list.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
      const idleMinutes = horizon === 0 ? 0 : Math.max(0, horizon - busyMinutes);
      return {
        loomId: loom.id,
        busyMinutes,
        idleMinutes,
        utilization: horizon === 0 ? 0 : Number((busyMinutes / horizon).toFixed(4)),
      };
    })
    .sort((a, b) => a.loomId.localeCompare(b.loomId));
}

function buildOrderSummaries(
  input: SchedulingInput,
  placed: Map<string, ScheduledStep>,
): OrderSummary[] {
  return input.orders
    .map((order) => {
      const ofOrder = input.steps.filter((s) => s.orderId === order.id);
      const scheduled = ofOrder.map((s) => placed.get(s.id)!);
      const workMinutes = scheduled.reduce((sum, e) => sum + e.workMinutes, 0);
      const makespanEnd = scheduled.length === 0 ? 0 : Math.max(...scheduled.map((e) => e.endMinute));
      return {
        orderId: order.id,
        workMinutes,
        makespanEnd,
        dueMinute: order.dueMinute,
        lateMinutes: Math.max(0, makespanEnd - order.dueMinute),
      };
    })
    .sort((a, b) => a.orderId.localeCompare(b.orderId));
}
