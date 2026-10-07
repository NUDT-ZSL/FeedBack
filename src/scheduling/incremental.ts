import { buildContext, simulate, scheduleAll, sortScheduled } from './scheduler.ts';
import type { FrozenState } from './scheduler.ts';
import type {
  Capability,
  ScheduleResult,
  ScheduledOp,
  SchedulingInput,
} from './types.ts';

export interface DependencyChange {
  opId: string;
  dependsOn: string[];
}

export interface CapabilityRemoval {
  loomId: string;
  operationType: string;
}

export interface ChangeSet {
  dependencies?: DependencyChange[];
  capabilityUpserts?: Capability[];
  capabilityRemovals?: CapabilityRemoval[];
}

export interface ImpactedOp {
  opId: string;
  reasons: string[];
}

export interface IncrementalResult {
  result: ScheduleResult;
  impacted: ImpactedOp[];
}

export function applyChanges(input: SchedulingInput, changes: ChangeSet): SchedulingInput {
  const depChanges = new Map((changes.dependencies ?? []).map((d) => [d.opId, d.dependsOn]));
  const removals = new Set(
    (changes.capabilityRemovals ?? []).map((r) => `${r.loomId}${r.operationType}`),
  );
  const upserts = changes.capabilityUpserts ?? [];
  const upsertKeys = new Set(upserts.map((u) => `${u.loomId}${u.operationType}`));

  return {
    looms: input.looms,
    orders: input.orders.map((order) => ({
      ...order,
      operations: order.operations.map((op) =>
        depChanges.has(op.id) ? { ...op, dependsOn: depChanges.get(op.id)! } : op,
      ),
    })),
    capabilities: [
      ...input.capabilities.filter(
        (c) =>
          !removals.has(`${c.loomId}${c.operationType}`) &&
          !upsertKeys.has(`${c.loomId}${c.operationType}`),
      ),
      ...upserts,
    ],
    policy: input.policy,
  };
}

function addReason(map: Map<string, string[]>, opId: string, reason: string): boolean {
  let list = map.get(opId);
  if (!list) {
    list = [];
    map.set(opId, list);
  }
  if (!list.includes(reason)) {
    list.push(reason);
    return true;
  }
  return false;
}

export function analyzeImpact(
  nextInput: SchedulingInput,
  prevResult: ScheduleResult,
  changes: ChangeSet,
): Map<string, string[]> {
  const impacted = new Map<string, string[]>();
  const nextBuild = buildContext(nextInput);
  const prevByOp = new Map(prevResult.scheduled.map((s) => [s.opId, s]));

  const touchedTypes = new Set<string>();
  for (const u of changes.capabilityUpserts ?? []) touchedTypes.add(u.operationType);
  for (const r of changes.capabilityRemovals ?? []) touchedTypes.add(r.operationType);

  for (const d of changes.dependencies ?? []) {
    addReason(impacted, d.opId, `前置依赖被修改为[${d.dependsOn.join(', ')}]`);
  }
  for (const order of nextInput.orders) {
    for (const op of order.operations) {
      if (touchedTypes.has(op.type)) {
        addReason(impacted, op.id, `工序类型${op.type}的织机能力发生变更`);
      }
    }
  }

  const dependents = new Map<string, string[]>();
  for (const order of nextInput.orders) {
    for (const op of order.operations) {
      for (const dep of op.dependsOn) {
        const list = dependents.get(dep) ?? [];
        list.push(op.id);
        dependents.set(dep, list);
      }
    }
  }
  const queue = [...impacted.keys()];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of dependents.get(current) ?? []) {
      if (addReason(impacted, next, `前置工序${current}受影响，需联动重推`)) {
        queue.push(next);
      }
    }
  }

  const lowerBound = new Map<string, number>();
  const computing = new Set<string>();
  const lbOf = (opId: string): number => {
    const cached = lowerBound.get(opId);
    if (cached !== undefined) return cached;
    if (computing.has(opId)) return 0;
    computing.add(opId);
    let lb = 0;
    for (const order of nextInput.orders) {
      for (const op of order.operations) {
        if (op.id !== opId) continue;
        lb = order.releaseAt;
        for (const dep of op.dependsOn) {
          let depEnd: number;
          if (impacted.has(dep)) {
            depEnd = lbOf(dep);
          } else {
            const prev = prevByOp.get(dep);
            depEnd = prev ? prev.end : 0;
          }
          if (depEnd > lb) lb = depEnd;
        }
      }
    }
    computing.delete(opId);
    lowerBound.set(opId, lb);
    return lb;
  };

  let changed = true;
  while (changed) {
    changed = false;
    lowerBound.clear();
    for (const opId of [...impacted.keys()]) {
      const prev = prevByOp.get(opId);
      if (!prev) continue;
      const lb = lbOf(opId);
      const oldLoom = prev.loomId;
      const oldThreshold = Math.min(prev.start, lb);
      for (const s of prevResult.scheduled) {
        if (s.loomId === oldLoom && s.start >= oldThreshold && !impacted.has(s.opId)) {
          addReason(
            impacted,
            s.opId,
            `与${opId}同机台${oldLoom}且档期不早于${oldThreshold}，属受影响后缀`,
          );
          changed = true;
        }
      }
      const adj = nextBuild.ctx.adjudicationByOp.get(opId);
      const newLoom = adj?.winner ?? null;
      if (newLoom !== null && newLoom !== oldLoom) {
        for (const s of prevResult.scheduled) {
          if (s.loomId === newLoom && s.start >= lb && !impacted.has(s.opId)) {
            addReason(
              impacted,
              s.opId,
              `${opId}改判至机台${newLoom}，本机台不早于${lb}的档期需联动重推`,
            );
            changed = true;
          }
        }
      }
    }
  }

  return impacted;
}

export function rescheduleAffected(
  prevInput: SchedulingInput,
  changes: ChangeSet,
  prevResult: ScheduleResult,
): IncrementalResult {
  const nextInput = applyChanges(prevInput, changes);
  const nextBuild = buildContext(nextInput);

  if (!prevResult.ok || nextBuild.failures.length > 0) {
    const full = scheduleAll(nextInput);
    const impacted = [...nextBuild.ctx.opById.keys()].sort().map((opId) => ({
      opId,
      reasons: ['输入校验未通过，退化为整体重排'],
    }));
    return { result: full, impacted };
  }

  const impactedMap = analyzeImpact(nextInput, prevResult, changes);
  const impactedIds = new Set(impactedMap.keys());

  const frozen: FrozenState = { intervals: new Map(), ends: new Map() };
  const frozenOps: ScheduledOp[] = [];
  for (const s of prevResult.scheduled) {
    if (impactedIds.has(s.opId)) continue;
    frozenOps.push(s);
    frozen.ends.set(s.opId, s.end);
    const list = frozen.intervals.get(s.loomId) ?? [];
    list.push({ start: s.start, end: s.end, opId: s.opId });
    frozen.intervals.set(s.loomId, list);
  }
  for (const list of frozen.intervals.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  const rescheduled = simulate(nextBuild.ctx, impactedIds, frozen);
  const scheduled = sortScheduled([...frozenOps, ...rescheduled]);

  const impacted = [...impactedMap.entries()]
    .map(([opId, reasons]) => ({ opId, reasons }))
    .sort((a, b) => (a.opId < b.opId ? -1 : 1));

  return {
    result: {
      ok: true,
      scheduled,
      adjudications: nextBuild.ctx.adjudications,
      failures: [],
    },
    impacted,
  };
}
