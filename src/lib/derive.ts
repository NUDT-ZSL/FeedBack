import { TimelineEvent, TimelineBranch, EventDependency } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const dayOf = (dateStr: string): number =>
  Math.round(new Date(`${dateStr}T00:00:00Z`).getTime() / DAY_MS);

export const dateOf = (day: number): string => {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export const addDays = (dateStr: string, days: number): string =>
  dateOf(dayOf(dateStr) + days);

export const diffDays = (from: string, to: string): number =>
  dayOf(to) - dayOf(from);

export interface CycleIssue {
  type: 'cycle';
  id: string;
  eventIds: string[];
  dependencyIds: string[];
}

export interface DanglingIssue {
  type: 'dangling';
  id: string;
  dependencyId: string;
  missingEventId: string;
  anchorEventId: string;
}

export interface OrphanIssue {
  type: 'orphan';
  id: string;
  eventId: string;
  reason: 'missing-branch' | 'missing-parent';
}

export type DeriveIssue = CycleIssue | DanglingIssue | OrphanIssue;

export interface DeriveResult {
  events: TimelineEvent[];
  issues: DeriveIssue[];
  invalidDependencyIds: Set<string>;
  cycleEventIds: Set<string>;
  issueEventIds: Set<string>;
  branchEventCounts: Map<string, number>;
}

/**
 * 全量推导：从原始事件 / 分支 / 依赖出发，一次性算出
 * 所有事件的最终日期、依赖有效性与问题列表。
 * 界面上的一切展示都必须以该结果为准，保证局部操作与全量重推一致。
 */
export function deriveTimeline(
  events: TimelineEvent[],
  branches: TimelineBranch[],
  dependencies: EventDependency[]
): DeriveResult {
  const issues: DeriveIssue[] = [];
  const invalidDependencyIds = new Set<string>();
  const cycleEventIds = new Set<string>();
  const issueEventIds = new Set<string>();

  const eventById = new Map(events.map((e) => [e.id, e]));
  const branchById = new Map(branches.map((b) => [b.id, b]));

  // 1. 基础日期：主事件与手动模式分支事件用自身日期；
  //    偏移模式的分支事件不取自身日期，而是通过“主事件 -> 分支事件”的
  // 虚拟边（权重 = offsetDays）与依赖边一起在同一个有向图里做最长路径求解，
  // 因此主事件被依赖推后时，偏移事件也会跟随其最终日期整体重排。
  const NEG_INF = Number.MIN_SAFE_INTEGER;
  const baseDay = new Map<string, number>();
  const offsetEdges: { fromId: string; toId: string; weight: number }[] = [];
  for (const e of events) {
    if (!e.branchId) {
      baseDay.set(e.id, dayOf(e.date));
      continue;
    }
    const branch = branchById.get(e.branchId);
    if (!branch) {
      issues.push({ type: 'orphan', id: `orphan-${e.id}`, eventId: e.id, reason: 'missing-branch' });
      issueEventIds.add(e.id);
      baseDay.set(e.id, dayOf(e.date));
      continue;
    }
    const parent = eventById.get(branch.parentEventId);
    if (!parent) {
      issues.push({ type: 'orphan', id: `orphan-${e.id}`, eventId: e.id, reason: 'missing-parent' });
      issueEventIds.add(e.id);
      baseDay.set(e.id, dayOf(e.date));
      continue;
    }
    if (e.offsetDays != null) {
      baseDay.set(e.id, NEG_INF);
      offsetEdges.push({ fromId: parent.id, toId: e.id, weight: e.offsetDays });
    } else {
      baseDay.set(e.id, dayOf(e.date));
    }
  }

  // 2. 依赖校验：悬空依赖（端点已删除）保留并上报，不静默丢弃。
  const activeDeps: EventDependency[] = [];
  for (const dep of dependencies) {
    const fromOk = eventById.has(dep.fromId);
    const toOk = eventById.has(dep.toId);
    if (!fromOk || !toOk) {
      invalidDependencyIds.add(dep.id);
      const missing = !fromOk ? dep.fromId : dep.toId;
      const anchor = !fromOk ? dep.toId : dep.fromId;
      issues.push({
        type: 'dangling',
        id: `dangling-${dep.id}`,
        dependencyId: dep.id,
        missingEventId: missing,
        anchorEventId: anchor,
      });
      issueEventIds.add(anchor);
    } else {
      activeDeps.push(dep);
    }
  }

  // 3. 拓扑传播（最长路径）：依赖边 to.date >= from.date + 1 天；
  //    偏移边 to.date >= from.date + offsetDays（无其他约束时即取等号）。
  //    Kahn 算法；未能处理的节点即处于（或下游于）环中。
  const involved = new Set<string>();
  for (const d of activeDeps) {
    involved.add(d.fromId);
    involved.add(d.toId);
  }
  for (const oe of offsetEdges) {
    involved.add(oe.fromId);
    involved.add(oe.toId);
  }
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, { toId: string; weight: number; depId?: string }[]>();
  for (const id of involved) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const d of activeDeps) {
    indegree.set(d.toId, (indegree.get(d.toId) ?? 0) + 1);
    outgoing.get(d.fromId)!.push({ toId: d.toId, weight: 1, depId: d.id });
  }
  for (const oe of offsetEdges) {
    indegree.set(oe.toId, (indegree.get(oe.toId) ?? 0) + 1);
    outgoing.get(oe.fromId)!.push({ toId: oe.toId, weight: oe.weight });
  }

  const finalDay = new Map(baseDay);
  const queue: string[] = [];
  for (const id of involved) {
    if ((indegree.get(id) ?? 0) === 0) queue.push(id);
  }
  const processed = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      const from = finalDay.get(id);
      if (from == null || from === NEG_INF) continue;
      const required = from + edge.weight;
      if (required > (finalDay.get(edge.toId) ?? NEG_INF)) {
        finalDay.set(edge.toId, required);
      }
      const remaining = (indegree.get(edge.toId) ?? 0) - 1;
      indegree.set(edge.toId, remaining);
      if (remaining === 0) queue.push(edge.toId);
    }
  }

  // 4. 环检测：未处理节点中找出强连通分量（Tarjan），逐环上报。
  const unprocessed = [...involved].filter((id) => !processed.has(id));
  if (unprocessed.length > 0) {
    const unprocessedSet = new Set(unprocessed);
    const sccs = tarjanSCC(unprocessed, (id) =>
      (outgoing.get(id) ?? [])
        .map((edge) => edge.toId)
        .filter((to) => unprocessedSet.has(to))
    );
    for (const scc of sccs) {
      const sccSet = new Set(scc);
      const isSelfLoop =
        scc.length === 1 &&
        (outgoing.get(scc[0]) ?? []).some((edge) => edge.toId === scc[0]);
      if (scc.length < 2 && !isSelfLoop) continue; // 仅下游于环，非环成员
      const depIds = activeDeps
        .filter((d) => sccSet.has(d.fromId) && sccSet.has(d.toId))
        .map((d) => d.id);
      depIds.forEach((id) => invalidDependencyIds.add(id));
      scc.forEach((id) => {
        cycleEventIds.add(id);
        issueEventIds.add(id);
      });
      issues.push({
        type: 'cycle',
        id: `cycle-${scc.slice().sort().join('-')}`,
        eventIds: scc,
        dependencyIds: depIds,
      });
    }
  }

  // 5. 输出：日期全部来自同一次推导，UI 不做任何局部修补。
  const derivedEvents = events.map((e) => {
    let day = finalDay.get(e.id);
    if (day == null) return e;
    if (day === NEG_INF) day = dayOf(e.date); // 偏移边失效（如成环）时回退到自身日期
    const date = dateOf(day);
    return date === e.date ? e : { ...e, date };
  });

  const branchEventCounts = new Map<string, number>();
  for (const e of events) {
    if (e.branchId) {
      branchEventCounts.set(e.branchId, (branchEventCounts.get(e.branchId) ?? 0) + 1);
    }
  }

  return { events: derivedEvents, issues, invalidDependencyIds, cycleEventIds, issueEventIds, branchEventCounts };
}

function tarjanSCC(nodes: string[], neighbors: (id: string) => string[]): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  const strongconnect = (v: string) => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of neighbors(v)) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  };

  for (const v of nodes) {
    if (!index.has(v)) strongconnect(v);
  }
  return result;
}

export interface DeletionImpact {
  removedEventIds: Set<string>;
  removedBranchIds: Set<string>;
  danglingDependencyIds: Set<string>;
}

/**
 * 删除主事件：按“归属可达性”推导受影响范围 ——
 * 事件本身、其名下分支、以及这些分支上的事件失去归属被清理；
 * 指向它们的依赖不删除，转为悬空依赖交由人工裁决。
 */
export function computeEventDeletionImpact(
  events: TimelineEvent[],
  branches: TimelineBranch[],
  dependencies: EventDependency[],
  eventId: string
): DeletionImpact {
  const removedBranchIds = new Set(
    branches.filter((b) => b.parentEventId === eventId).map((b) => b.id)
  );
  const removedEventIds = new Set<string>([eventId]);
  for (const e of events) {
    if (e.branchId && removedBranchIds.has(e.branchId)) removedEventIds.add(e.id);
  }
  const danglingDependencyIds = new Set(
    dependencies
      .filter(
        (d) =>
          (removedEventIds.has(d.fromId) || removedEventIds.has(d.toId)) &&
          !(removedEventIds.has(d.fromId) && removedEventIds.has(d.toId))
      )
      .map((d) => d.id)
  );
  return { removedEventIds, removedBranchIds, danglingDependencyIds };
}

/**
 * 删除分支：仅清理该分支上的事件；跨分支依赖转为悬空依赖保留。
 */
export function computeBranchDeletionImpact(
  events: TimelineEvent[],
  dependencies: EventDependency[],
  branchId: string
): DeletionImpact {
  const removedEventIds = new Set(
    events.filter((e) => e.branchId === branchId).map((e) => e.id)
  );
  const danglingDependencyIds = new Set(
    dependencies
      .filter(
        (d) =>
          (removedEventIds.has(d.fromId) || removedEventIds.has(d.toId)) &&
          !(removedEventIds.has(d.fromId) && removedEventIds.has(d.toId))
      )
      .map((d) => d.id)
  );
  return { removedEventIds, removedBranchIds: new Set([branchId]), danglingDependencyIds };
}
