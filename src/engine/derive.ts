import type {
  Conflict,
  DependencyCycle,
  DepRef,
  DerivationResult,
  DurationConflict,
  MissingDependency,
  Resolution,
  TaskDecl,
  TaskResult,
} from './types.ts';

/** 推导用的中间图模型：声明合并 + 裁决应用后的结果。 */
export interface GraphModel {
  ids: string[];
  duration: Map<string, number | null>;
  durationSources: Map<string, string[]>;
  durationConflict: Set<string>;
  deps: Map<string, DepRef[]>;
  optionalDeps: Map<string, DepRef[]>;
  missingDeps: Map<string, DepRef[]>;
  dependents: Map<string, string[]>;
  cycleMembers: Set<string>;
  cycles: DependencyCycle[];
  conflicts: Conflict[];
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 合并声明并应用裁决，得到生效图模型。冲突不静默处理：全部记录到 model.conflicts。 */
export function buildModel(decls: TaskDecl[], resolutions: Resolution[]): GraphModel {
  const byId = new Map<string, TaskDecl[]>();
  for (const decl of decls) {
    const list = byId.get(decl.id) ?? [];
    list.push(decl);
    byId.set(decl.id, list);
  }
  const ids = [...byId.keys()].sort(compareId);

  const pickDuration = new Map<string, { source?: string; value?: number }>();
  const removedEdges = new Set<string>();
  const retargets = new Map<string, string>();
  for (const res of resolutions) {
    if (res.kind === 'pick-duration') pickDuration.set(res.taskId, { source: res.source });
    else if (res.kind === 'set-duration') pickDuration.set(res.taskId, { value: res.duration });
    else if (res.kind === 'remove-dependency') removedEdges.add(`${res.taskId}→${res.dep}`);
    else if (res.kind === 'retarget-dependency') retargets.set(`${res.taskId}→${res.dep}`, res.to);
  }

  const duration = new Map<string, number | null>();
  const durationSources = new Map<string, string[]>();
  const durationConflict = new Set<string>();
  const conflicts: Conflict[] = [];

  for (const id of ids) {
    const declList = byId.get(id)!;
    const pick = pickDuration.get(id);
    if (pick?.value !== undefined) {
      duration.set(id, pick.value);
      durationSources.set(id, ['user-adjudication']);
    } else if (pick?.source !== undefined) {
      const chosen = declList.find((d) => d.source === pick.source);
      if (chosen) {
        duration.set(id, chosen.duration);
        durationSources.set(id, [chosen.source]);
      } else {
        duration.set(id, null);
        durationSources.set(id, []);
        durationConflict.add(id);
      }
    } else {
      const distinct = new Map<number, string[]>();
      for (const d of declList) {
        const list = distinct.get(d.duration) ?? [];
        list.push(d.source);
        distinct.set(d.duration, list);
      }
      if (distinct.size === 1) {
        const [value, sources] = [...distinct.entries()][0];
        duration.set(id, value);
        durationSources.set(id, sources);
      } else {
        duration.set(id, null);
        durationSources.set(id, []);
        durationConflict.add(id);
        const variants: DurationConflict['variants'] = [];
        for (const d of declList) variants.push({ source: d.source, duration: d.duration });
        conflicts.push({ type: 'duration-conflict', taskId: id, variants });
      }
    }
  }

  const deps = new Map<string, DepRef[]>();
  const optionalDeps = new Map<string, DepRef[]>();
  const missingDeps = new Map<string, DepRef[]>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) {
    deps.set(id, []);
    optionalDeps.set(id, []);
    missingDeps.set(id, []);
    dependents.set(id, []);
  }

  for (const id of ids) {
    const hard = new Map<string, string[]>();
    const optional = new Map<string, string[]>();
    const missing = new Map<string, string[]>();
    for (const decl of byId.get(id)!) {
      for (const rawDep of decl.dependsOn) {
        const key = `${id}→${rawDep}`;
        if (removedEdges.has(key)) continue;
        const dep = retargets.get(key) ?? rawDep;
        const bucket = byId.has(dep) ? hard : missing;
        const list = bucket.get(dep) ?? [];
        if (!list.includes(decl.source)) list.push(decl.source);
        bucket.set(dep, list);
      }
      for (const opt of decl.optionalDeps ?? []) {
        if (!byId.has(opt)) continue;
        const list = optional.get(opt) ?? [];
        if (!list.includes(decl.source)) list.push(decl.source);
        optional.set(opt, list);
      }
    }
    const toRefs = (m: Map<string, string[]>): DepRef[] =>
      [...m.keys()].sort(compareId).map((depId) => ({ id: depId, sources: m.get(depId)! }));
    deps.set(id, toRefs(hard));
    optionalDeps.set(id, toRefs(optional));
    missingDeps.set(id, toRefs(missing));
    for (const [dep, sources] of missing) {
      conflicts.push({ type: 'missing-dependency', taskId: id, dep, sources } satisfies MissingDependency);
    }
  }

  for (const id of ids) {
    for (const dep of deps.get(id)!) {
      dependents.get(dep.id)!.push(id);
    }
  }
  for (const id of ids) dependents.get(id)!.sort(compareId);

  const cycles = findCycles(ids, deps);
  const cycleMembers = new Set<string>();
  for (const cycle of cycles) for (const m of cycle.members) cycleMembers.add(m);
  conflicts.push(...cycles);

  return {
    ids,
    duration,
    durationSources,
    durationConflict,
    deps,
    optionalDeps,
    missingDeps,
    dependents,
    cycleMembers,
    cycles,
    conflicts,
  };
}

/** Tarjan 强连通分量，提取所有依赖环（含自环）。 */
function findCycles(ids: string[], deps: Map<string, DepRef[]>): DependencyCycle[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v)!) {
      if (!index.has(w.id)) {
        strongconnect(w.id);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w.id)!));
      } else if (onStack.has(w.id)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w.id)!));
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
      sccs.push(scc);
    }
  }

  for (const id of ids) if (!index.has(id)) strongconnect(id);

  const cycles: DependencyCycle[] = [];
  for (const scc of sccs) {
    const memberSet = new Set(scc);
    const isCycle =
      scc.length > 1 || deps.get(scc[0])!.some((d) => d.id === scc[0]);
    if (!isCycle) continue;
    const members = [...scc].sort(compareId);
    const edges: DependencyCycle['edges'] = [];
    for (const from of members) {
      for (const dep of deps.get(from)!) {
        if (memberSet.has(dep.id)) edges.push({ from, to: dep.id, sources: dep.sources });
      }
    }
    cycles.push({ type: 'dependency-cycle', members, edges });
  }
  cycles.sort((a, b) => compareId(a.members[0], b.members[0]));
  return cycles;
}

export interface TopoOutcome {
  order: string[];
  readyWith: Map<string, string[]>;
  unscheduled: { id: string; reason: string }[];
}

/** Kahn 拓扑排序，就绪集合内按标识字典序出队，保证结果确定、可解释。 */
export function topoSort(model: GraphModel): TopoOutcome {
  const indegree = new Map<string, number>();
  for (const id of model.ids) indegree.set(id, model.deps.get(id)!.length);
  const ready: string[] = model.ids.filter((id) => indegree.get(id) === 0).sort(compareId);
  const order: string[] = [];
  const readyWith = new Map<string, string[]>();

  while (ready.length > 0) {
    const next = ready.shift()!;
    readyWith.set(next, ready.filter((id) => id !== next));
    order.push(next);
    for (const dependent of model.dependents.get(next)!) {
      const remaining = indegree.get(dependent)! - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        const pos = ready.findIndex((id) => compareId(id, dependent) > 0);
        if (pos === -1) ready.push(dependent);
        else ready.splice(pos, 0, dependent);
      }
    }
  }

  const scheduled = new Set(order);
  const unscheduled: { id: string; reason: string }[] = [];
  for (const id of model.ids) {
    if (scheduled.has(id)) continue;
    if (model.cycleMembers.has(id)) {
      const cycle = model.cycles.find((c) => c.members.includes(id))!;
      unscheduled.push({ id, reason: `处于依赖环 ${cycle.members.join(' → ')} 中` });
    } else {
      const blocker = model.deps.get(id)!.find((d) => !scheduled.has(d.id));
      unscheduled.push({ id, reason: `依赖的任务 ${blocker ? blocker.id : '?'} 无法被调度` });
    }
  }
  return { order, readyWith, unscheduled };
}

export interface ScheduleEntry {
  est: number | null;
  finish: number | null;
  gatedBy: string[];
}

/**
 * 计算最早开始时刻。传入 previous 与 affected 时，未受影响的任务直接复用缓存，
 * 只重推受影响任务——受影响集合之外的任务其子图未变，结果与整体重推一致。
 */
export function computeSchedule(
  model: GraphModel,
  order: string[],
  previous?: Map<string, ScheduleEntry>,
  affected?: Set<string>,
): Map<string, ScheduleEntry> {
  const table = new Map<string, ScheduleEntry>();
  for (const id of order) {
    if (previous && affected && !affected.has(id)) {
      const cached = previous.get(id);
      if (cached) {
        table.set(id, cached);
        continue;
      }
    }
    const deps = model.deps.get(id)!;
    let est: number | null = 0;
    for (const dep of deps) {
      const depFinish = table.get(dep.id)?.finish ?? null;
      if (depFinish === null) {
        est = null;
        break;
      }
      est = Math.max(est, depFinish);
    }
    const duration = model.duration.get(id)!;
    const finish = est === null || duration === null ? null : est + duration;
    const gatedBy =
      est === null
        ? []
        : deps.filter((d) => table.get(d.id)?.finish === est).map((d) => d.id);
    table.set(id, { est, finish, gatedBy });
  }
  return table;
}

/** 关键路径：完工时刻最大的任务为终点，沿“决定 est 的依赖”回溯；并列时取字典序最小者，并列分支保留在 gatedBy 中可解释。 */
export function computeCriticalPath(
  model: GraphModel,
  order: string[],
  schedule: Map<string, ScheduleEntry>,
): { criticalPath: string[]; makespan: number | null } {
  let makespan: number | null = null;
  for (const id of order) {
    const finish = schedule.get(id)?.finish ?? null;
    if (finish === null) continue;
    if (makespan === null || finish > makespan) makespan = finish;
  }
  if (makespan === null) return { criticalPath: [], makespan: null };
  const ends = order
    .filter((id) => schedule.get(id)?.finish === makespan)
    .sort(compareId);
  const path: string[] = [];
  let current: string | null = ends[0];
  while (current !== null) {
    path.unshift(current);
    const gated = (schedule.get(current)?.gatedBy ?? []).slice().sort(compareId);
    current = gated.length > 0 ? gated[0] : null;
  }
  return { criticalPath: path, makespan };
}

export function assemble(
  model: GraphModel,
  topo: TopoOutcome,
  schedule: Map<string, ScheduleEntry>,
  criticalPath: string[],
  makespan: number | null,
): DerivationResult {
  const onPath = new Set(criticalPath);
  const tasks: Record<string, TaskResult> = {};
  const unscheduledReason = new Map(topo.unscheduled.map((u) => [u.id, u.reason]));
  const orderIndex = new Map(topo.order.map((id, i) => [id, i]));
  for (const id of model.ids) {
    const entry = schedule.get(id) ?? { est: null, finish: null, gatedBy: [] };
    tasks[id] = {
      id,
      duration: model.duration.get(id)!,
      durationSources: model.durationSources.get(id)!,
      durationConflict: model.durationConflict.has(id),
      deps: model.deps.get(id)!,
      optionalDeps: model.optionalDeps.get(id)!,
      missingDeps: model.missingDeps.get(id)!,
      est: entry.est,
      finish: entry.finish,
      gatedBy: entry.gatedBy,
      readyWith: topo.readyWith.get(id) ?? [],
      orderIndex: orderIndex.get(id) ?? null,
      onCriticalPath: onPath.has(id),
      unscheduledReason: unscheduledReason.get(id) ?? null,
    };
  }
  return {
    order: topo.order,
    tasks,
    conflicts: model.conflicts,
    criticalPath,
    makespan,
  };
}

/** 整体重推。 */
export function derive(decls: TaskDecl[], resolutions: Resolution[]): DerivationResult {
  const model = buildModel(decls, resolutions);
  const topo = topoSort(model);
  const schedule = computeSchedule(model, topo.order);
  const { criticalPath, makespan } = computeCriticalPath(model, topo.order, schedule);
  return assemble(model, topo, schedule, criticalPath, makespan);
}

/** 计算一组新裁决影响的任务集合：裁决目标 + 其全部传递下游（依赖它们的任务）。 */
export function computeAffected(decls: TaskDecl[], resolutions: Resolution[], fresh: Resolution[]): Set<string> {
  const model = buildModel(decls, resolutions);
  const seeds = new Set<string>();
  for (const res of fresh) seeds.add(res.taskId);
  const affected = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const dependent of model.dependents.get(id) ?? []) queue.push(dependent);
  }
  return affected;
}

/**
 * 增量重推：仅对受影响任务重算时刻，未受影响任务复用上次结果；
 * 顺序与关键路径由合并后的任务表确定性地重建，保证与整体重推一致。
 */
export function deriveIncremental(
  decls: TaskDecl[],
  resolutions: Resolution[],
  fresh: Resolution[],
  previous: DerivationResult,
): { affected: string[]; result: DerivationResult } {
  const affectedSet = computeAffected(decls, resolutions, fresh);
  const model = buildModel(decls, resolutions);
  const topo = topoSort(model);
  const previousSchedule = new Map<string, ScheduleEntry>();
  for (const id of Object.keys(previous.tasks)) {
    const t = previous.tasks[id];
    previousSchedule.set(id, { est: t.est, finish: t.finish, gatedBy: t.gatedBy });
  }
  const schedule = computeSchedule(model, topo.order, previousSchedule, affectedSet);
  const { criticalPath, makespan } = computeCriticalPath(model, topo.order, schedule);
  const result = assemble(model, topo, schedule, criticalPath, makespan);
  return { affected: [...affectedSet].sort(compareId), result };
}
