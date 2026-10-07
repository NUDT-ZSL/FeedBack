import { DEFAULT_POLICY } from './types.ts';
import type {
  Adjudication,
  Loom,
  Operation,
  Order,
  Policy,
  ScheduleBasis,
  ScheduleFailure,
  ScheduleResult,
  ScheduledOp,
  SchedulingInput,
} from './types.ts';

export interface Interval {
  start: number;
  end: number;
  opId: string;
}

export interface PlanContext {
  policy: Policy;
  loomById: Map<string, Loom>;
  opById: Map<string, Operation>;
  orderById: Map<string, Order>;
  adjudicationByOp: Map<string, Adjudication>;
  adjudications: Adjudication[];
}

export interface ContextBuild {
  ctx: PlanContext;
  failures: ScheduleFailure[];
}

function findCyclePath(
  startId: string,
  members: Set<string>,
  opById: Map<string, Operation>,
): string[] {
  const path: string[] = [startId];
  const seen = new Set<string>([startId]);
  let current = startId;
  for (;;) {
    const op = opById.get(current);
    if (!op) return path;
    const next = [...op.dependsOn].sort().find((d) => members.has(d));
    if (next === undefined) return path;
    if (seen.has(next)) {
      path.push(next);
      return path;
    }
    seen.add(next);
    path.push(next);
    current = next;
  }
}

function detectCycles(opById: Map<string, Operation>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const strongConnect = (rootId: string): void => {
    interface Frame {
      id: string;
      deps: string[];
      depIndex: number;
    }
    const frames: Frame[] = [];
    const push = (id: string): void => {
      index.set(id, counter);
      lowlink.set(id, counter);
      counter += 1;
      stack.push(id);
      onStack.add(id);
      const op = opById.get(id);
      const deps = op ? op.dependsOn.filter((d) => opById.has(d)) : [];
      frames.push({ id, deps, depIndex: 0 });
    };
    push(rootId);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.depIndex < frame.deps.length) {
        const dep = frame.deps[frame.depIndex];
        frame.depIndex += 1;
        if (!index.has(dep)) {
          push(dep);
        } else if (onStack.has(dep)) {
          lowlink.set(frame.id, Math.min(lowlink.get(frame.id)!, index.get(dep)!));
        }
      } else {
        frames.pop();
        if (frames.length > 0) {
          const parent = frames[frames.length - 1];
          lowlink.set(
            parent.id,
            Math.min(lowlink.get(parent.id)!, lowlink.get(frame.id)!),
          );
        }
        if (lowlink.get(frame.id) === index.get(frame.id)) {
          const members: string[] = [];
          for (;;) {
            const top = stack.pop()!;
            onStack.delete(top);
            members.push(top);
            if (top === frame.id) break;
          }
          const isCycle =
            members.length > 1 ||
            (members.length === 1 &&
              (opById.get(members[0])?.dependsOn.includes(members[0]) ?? false));
          if (isCycle) {
            const memberSet = new Set(members);
            const start = [...members].sort()[0];
            cycles.push(findCyclePath(start, memberSet, opById));
          }
        }
      }
    }
  };

  for (const id of [...opById.keys()].sort()) {
    if (!index.has(id)) strongConnect(id);
  }
  return cycles;
}

export function adjudicate(
  ctx: Pick<PlanContext, 'loomById'>,
  op: Operation,
  capabilities: SchedulingInput['capabilities'],
): Adjudication {
  const candidates = capabilities
    .filter((c) => c.operationType === op.type && ctx.loomById.has(c.loomId))
    .map((c) => ({ loomId: c.loomId, priority: c.priority }))
    .sort((a, b) => b.priority - a.priority || (a.loomId < b.loomId ? -1 : 1));

  let winner: string | null = null;
  let rule: Adjudication['rule'] = 'none';
  if (candidates.length === 1) {
    winner = candidates[0].loomId;
    rule = 'unique';
  } else if (candidates.length > 1) {
    winner = candidates[0].loomId;
    rule =
      candidates[0].priority === candidates[1].priority
        ? 'priority+loom-id-tiebreak'
        : 'priority';
  }
  const distinctPriorities = new Set(candidates.map((c) => c.priority)).size;
  return {
    opId: op.id,
    operationType: op.type,
    candidates,
    winner,
    rule,
    ambiguous: candidates.length > 1 && distinctPriorities > 1,
  };
}

export function buildContext(input: SchedulingInput): ContextBuild {
  const policy: Policy = { ...DEFAULT_POLICY, ...input.policy };
  const loomById = new Map(input.looms.map((l) => [l.id, l]));
  const opById = new Map<string, Operation>();
  const orderById = new Map<string, Order>();
  for (const order of input.orders) {
    orderById.set(order.id, order);
    for (const op of order.operations) opById.set(op.id, op);
  }

  const failures: ScheduleFailure[] = [];

  for (const cap of input.capabilities) {
    if (!loomById.has(cap.loomId)) {
      failures.push({
        kind: 'unknown-loom-reference',
        loomId: cap.loomId,
        operationType: cap.operationType,
      });
    }
  }

  for (const op of opById.values()) {
    for (const dep of op.dependsOn) {
      if (!opById.has(dep)) {
        failures.push({ kind: 'missing-dependency', opId: op.id, missingOpId: dep });
      }
    }
  }

  for (const cycle of detectCycles(opById)) {
    failures.push({ kind: 'dependency-cycle', cycle });
  }

  const adjudicationByOp = new Map<string, Adjudication>();
  const adjudications: Adjudication[] = [];
  for (const op of [...opById.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const adj = adjudicate({ loomById }, op, input.capabilities);
    adjudicationByOp.set(op.id, adj);
    adjudications.push(adj);
    if (adj.winner === null) {
      failures.push({ kind: 'no-capable-loom', opId: op.id, operationType: op.type });
    } else if (policy.strictAdjudication && adj.ambiguous) {
      failures.push({
        kind: 'ambiguous-coverage',
        opId: op.id,
        operationType: op.type,
        candidates: adj.candidates,
      });
    }
  }

  return {
    ctx: { policy, loomById, opById, orderById, adjudicationByOp, adjudications },
    failures,
  };
}

export function workMinutesOf(ctx: PlanContext, op: Operation): number {
  const adj = ctx.adjudicationByOp.get(op.id);
  const loom = adj && adj.winner !== null ? ctx.loomById.get(adj.winner) : undefined;
  const speed = loom && loom.speedFactor > 0 ? loom.speedFactor : 1;
  return Math.ceil(op.standardMinutes / speed);
}

interface Placement {
  start: number;
  blocker: Interval | null;
  usedAvailableFrom: boolean;
}

function findStart(
  timeline: Interval[],
  readyAt: number,
  work: number,
  availableFrom: number,
): Placement {
  let t = readyAt;
  let usedAvailableFrom = false;
  if (t < availableFrom) {
    t = availableFrom;
    usedAvailableFrom = true;
  }
  let blocker: Interval | null = null;
  for (const iv of timeline) {
    if (t + work <= iv.start) break;
    if (iv.end > t) {
      t = iv.end;
      blocker = iv;
      usedAvailableFrom = false;
    }
  }
  return { start: t, blocker, usedAvailableFrom };
}

function insertInterval(timeline: Interval[], iv: Interval): void {
  let i = 0;
  while (i < timeline.length && timeline[i].start <= iv.start) i += 1;
  timeline.splice(i, 0, iv);
}

function buildBasis(
  ctx: PlanContext,
  op: Operation,
  ends: Map<string, number>,
  readyAt: number,
  placement: Placement,
  loomId: string,
): ScheduleBasis {
  const order = ctx.orderById.get(op.orderId)!;
  let depsReadyAt = order.releaseAt;
  const maxPreds: { opId: string; end: number }[] = [];
  for (const dep of op.dependsOn) {
    const end = ends.get(dep);
    if (end === undefined) continue;
    if (end > depsReadyAt) {
      depsReadyAt = end;
      maxPreds.length = 0;
      maxPreds.push({ opId: dep, end });
    } else if (end === depsReadyAt && end > order.releaseAt) {
      maxPreds.push({ opId: dep, end });
    }
  }

  const reasons: string[] = [];
  if (op.dependsOn.length === 0) {
    reasons.push(`订单${op.orderId}放行于${order.releaseAt}，工序就绪于${readyAt}`);
  } else {
    const predText = maxPreds.map((p) => `${p.opId}完工@${p.end}`).join('、');
    reasons.push(`前置${predText}，工序就绪于${readyAt}`);
  }
  if (placement.blocker) {
    reasons.push(
      `织机${loomId}被工序${placement.blocker.opId}占用至${placement.blocker.end}，顺延至${placement.start}`,
    );
  } else if (placement.usedAvailableFrom) {
    reasons.push(`织机${loomId}自${placement.start}起可用，顺延至${placement.start}`);
  } else {
    reasons.push(`织机${loomId}空闲，按就绪时间${readyAt}开排`);
  }

  return {
    releaseAt: order.releaseAt,
    depsReadyAt,
    readyAt,
    startedAt: placement.start,
    reasons,
  };
}

export interface FrozenState {
  intervals: Map<string, Interval[]>;
  ends: Map<string, number>;
}

export function emptyFrozen(): FrozenState {
  return { intervals: new Map(), ends: new Map() };
}

export function simulate(
  ctx: PlanContext,
  opIds: Iterable<string>,
  frozen: FrozenState,
): ScheduledOp[] {
  const pending = new Set(opIds);
  const ends = new Map(frozen.ends);
  const timelines = new Map<string, Interval[]>();
  for (const [loomId, ivs] of frozen.intervals) {
    timelines.set(loomId, ivs.map((iv) => ({ ...iv })));
  }
  const result: ScheduledOp[] = [];

  while (pending.size > 0) {
    let bestOp: Operation | null = null;
    let bestReady = 0;
    for (const id of pending) {
      const op = ctx.opById.get(id)!;
      const order = ctx.orderById.get(op.orderId)!;
      let readyAt = order.releaseAt;
      let ready = true;
      for (const dep of op.dependsOn) {
        const end = ends.get(dep);
        if (end === undefined) {
          ready = false;
          break;
        }
        if (end > readyAt) readyAt = end;
      }
      if (!ready) continue;
      if (
        bestOp === null ||
        readyAt < bestReady ||
        (readyAt === bestReady && op.id < bestOp.id)
      ) {
        bestOp = op;
        bestReady = readyAt;
      }
    }
    if (bestOp === null) {
      throw new Error(
        `simulate: 存在无法就绪的工序（疑似依赖闭环）: ${[...pending].sort().join(', ')}`,
      );
    }

    const adj = ctx.adjudicationByOp.get(bestOp.id)!;
    const loomId = adj.winner!;
    const loom = ctx.loomById.get(loomId)!;
    const work = workMinutesOf(ctx, bestOp);
    let timeline = timelines.get(loomId);
    if (!timeline) {
      timeline = [];
      timelines.set(loomId, timeline);
    }
    const placement = findStart(timeline, bestReady, work, loom.availableFrom);
    const basis = buildBasis(ctx, bestOp, ends, bestReady, placement, loomId);
    const scheduled: ScheduledOp = {
      opId: bestOp.id,
      orderId: bestOp.orderId,
      loomId,
      start: placement.start,
      end: placement.start + work,
      workMinutes: work,
      basis,
    };
    insertInterval(timeline, { start: scheduled.start, end: scheduled.end, opId: scheduled.opId });
    ends.set(bestOp.id, scheduled.end);
    pending.delete(bestOp.id);
    result.push(scheduled);
  }
  return result;
}

function byOpId(a: ScheduledOp, b: ScheduledOp): number {
  return a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0;
}

export function scheduleAll(input: SchedulingInput): ScheduleResult {
  const { ctx, failures } = buildContext(input);
  if (failures.length > 0) {
    return { ok: false, scheduled: [], adjudications: ctx.adjudications, failures };
  }
  const scheduled = simulate(ctx, ctx.opById.keys(), emptyFrozen());
  scheduled.sort(byOpId);
  return { ok: true, scheduled, adjudications: ctx.adjudications, failures: [] };
}

export function sortScheduled(scheduled: ScheduledOp[]): ScheduledOp[] {
  return [...scheduled].sort(byOpId);
}
