import type {
  BlockedReason,
  BlockedTask,
  DerivedEdge,
  DerivedTask,
  Issue,
  MergedTask,
  PositionRationale,
} from './types.ts';

export interface ScheduleOutput {
  tasks: Record<string, DerivedTask>;
  edges: DerivedEdge[];
  order: string[];
  projectDuration: number;
  criticalPaths: string[][];
  criticalTasks: string[];
  blocked: BlockedTask[];
}

// 统一调度：确定性拓扑序 + 最早开始时刻（CPM 正向）+ 最晚时刻/松弛度（反向）+ 关键路径。
export function schedule(
  tasks: Record<string, MergedTask>,
  edges: { from: string; to: string; edge: { from: string; to: string; optional: boolean; claims: { source: string; note?: string; optional: boolean }[] } }[],
  issues: Issue[],
): ScheduleOutput {
  const ids = Object.keys(tasks).sort();
  const idSet = new Set(ids);

  // ---- 1. 阻塞判定：未解除的缺失/成环/耗时冲突任务及其下游不参与调度 ----
  const blockedMap = new Map<string, { reasons: Set<BlockedReason>; details: string[] }>();
  const addBlocked = (id: string, reason: BlockedReason, detail: string): void => {
    let entry = blockedMap.get(id);
    if (!entry) {
      entry = { reasons: new Set(), details: [] };
      blockedMap.set(id, entry);
    }
    entry.reasons.add(reason);
    entry.details.push(detail);
  };

  const openCycles = issues.filter((issue): issue is Extract<Issue, { kind: 'cycle' }> => issue.kind === 'cycle' && issue.status === 'open');
  const cycleMembers = new Set(openCycles.flatMap((issue) => issue.tasks));
  const openMissingPairs = new Set(
    issues
      .filter((issue): issue is Extract<Issue, { kind: 'missing-target' }> => issue.kind === 'missing-target' && issue.status === 'open')
      .map((issue) => `${issue.from}->${issue.to}`),
  );
  const durationConflictIds = new Set(
    issues
      .filter((issue): issue is Extract<Issue, { kind: 'duration-conflict' }> => issue.kind === 'duration-conflict' && issue.status === 'open')
      .map((issue) => issue.taskId),
  );

  for (const id of ids) {
    if (cycleMembers.has(id)) addBlocked(id, 'cycle', '处于未解除的依赖环中');
    if (durationConflictIds.has(id)) addBlocked(id, 'duration-conflict', '多来源耗时不一致，等待裁决');
    const task = tasks[id];
    for (const edge of task.deps) {
      if (openMissingPairs.has(`${id}->${edge.to}`)) {
        addBlocked(id, 'missing-target', `依赖 ${edge.to} 指向缺失且未裁决`);
      }
    }
  }

  // 下游传播：用反向可达求“祖先里有阻塞任务”的任务。
  const childrenOf = new Map<string, string[]>(); // dep -> dependents
  for (const id of ids) {
    for (const edge of tasks[id].deps) {
      if (!idSet.has(edge.to)) continue;
      const list = childrenOf.get(edge.to) ?? [];
      list.push(id);
      childrenOf.set(edge.to, list);
    }
  }
  const tainted = new Set<string>();
  const seed = [...blockedMap.keys()];
  const queue = [...seed];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!tainted.has(child) && !blockedMap.has(child)) {
        tainted.add(child);
        queue.push(child);
      }
    }
  }
  for (const id of tainted) {
    addBlocked(id, 'upstream-blocked', '上游任务处于未解决状态');
  }

  // ---- 2. 有效图：仅含可调度任务 ----
  const activeIds = ids.filter((id) => !blockedMap.has(id));
  const activeSet = new Set(activeIds);
  const predsOf = new Map<string, { dep: string; optional: boolean }[]>();
  const succsOf = new Map<string, { succ: string; optional: boolean }[]>();
  const derivedEdges: DerivedEdge[] = [];
  for (const id of activeIds) {
    predsOf.set(id, []);
    succsOf.set(id, []);
  }
  for (const id of activeIds) {
    for (const edge of tasks[id].deps) {
      if (!activeSet.has(edge.to)) continue; // 被阻塞/缺失的边不参与有效图
      predsOf.get(id)!.push({ dep: edge.to, optional: edge.optional });
      succsOf.get(edge.to)!.push({ succ: id, optional: edge.optional });
      derivedEdges.push({ from: edge.from, to: edge.to, optional: edge.optional, claims: edge.claims.map((c) => ({ ...c })) });
    }
  }

  // ---- 3. 确定性 Kahn 拓扑 + 正向 CPM ----
  const indegree = new Map<string, number>();
  for (const id of activeIds) indegree.set(id, predsOf.get(id)!.length);
  const earliestStart = new Map<string, number>();
  const startRationale = new Map<string, string[]>();
  const chosenAt = new Map<string, PositionRationale>();
  const readyOrder: string[] = [];
  for (const id of activeIds) {
    earliestStart.set(id, 0);
    if (indegree.get(id) === 0) readyOrder.push(id);
  }
  readyOrder.sort();

  const durationOf = (id: string): number => tasks[id].durations[0]?.duration ?? 0;
  const order: string[] = [];
  while (readyOrder.length) {
    // 就绪集合中按 (最早开始时刻, id) 确定性选取：先能开始的先排，同时刻按标识稳定排序。
    readyOrder.sort((a, b) => {
      const ea = earliestStart.get(a)!;
      const eb = earliestStart.get(b)!;
      return ea === eb ? a.localeCompare(b) : ea - eb;
    });
    const current = readyOrder.shift()!;
    const es = earliestStart.get(current)!;
    const reasons: string[] = [];
    const preds = predsOf.get(current)!;
    if (preds.length === 0) {
      reasons.push('无前置依赖，可在时刻 0 开始');
    } else {
      const fins = preds.map((pred) => ({ pred, finish: earliestStart.get(pred.dep)! + durationOf(pred.dep) }));
      const governing = fins.filter((item) => item.finish === es);
      reasons.push(`最早开始 = max(${fins.map((item) => `ES(${item.pred.dep})+d=${item.finish}${item.pred.optional ? '(可选)' : ''}`).join(', ')}) = ${es}`);
      reasons.push(`排位受前置 ${governing.map((item) => item.pred.dep).join('、')} 的最早完成时刻约束`);
    }
    startRationale.set(current, reasons);

    const candidateSet = [...readyOrder];
    chosenAt.set(current, {
      position: order.length + 1,
      readyAtPick: candidateSet,
      reasons: [
        ...reasons,
        ...(candidateSet.length
          ? [`选取时同时就绪的候选还有 ${candidateSet.join('、')}；其最早开始时刻不早于本任务，按标识稳定排序后本任务在前`]
          : ['选取时就绪集合中仅此任务']),
      ],
    });

    order.push(current);
    for (const { succ } of succsOf.get(current)!) {
      const candidate = es + durationOf(current);
      if (candidate > earliestStart.get(succ)!) {
        earliestStart.set(succ, candidate);
      }
      indegree.set(succ, indegree.get(succ)! - 1);
      if (indegree.get(succ) === 0) readyOrder.push(succ);
    }
  }

  // ---- 4. 反向 CPM：最晚开始/完成与松弛度 ----
  const earliestFinish = new Map<string, number>();
  for (const id of activeIds) earliestFinish.set(id, earliestStart.get(id)! + durationOf(id));
  const projectDuration = activeIds.reduce((max, id) => Math.max(max, earliestFinish.get(id)!), 0);

  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();
  const reverseOrder = [...order].reverse();
  for (const id of reverseOrder) {
    const successors = succsOf.get(id)!;
    const lf = successors.length
      ? Math.min(...successors.map(({ succ }) => latestStart.get(succ)!))
      : projectDuration;
    latestFinish.set(id, lf);
    latestStart.set(id, lf - durationOf(id));
  }

  const derivedTasks: Record<string, DerivedTask> = {};
  const criticalTasks: string[] = [];
  for (const id of activeIds) {
    const slack = latestStart.get(id)! - earliestStart.get(id)!;
    const critical = slack === 0;
    if (critical) criticalTasks.push(id);
    const claim = tasks[id].durations[0];
    derivedTasks[id] = {
      id,
      duration: durationOf(id),
      durationSource: claim ? `${claim.source}${claim.note ? `（${claim.note}）` : ''}` : '无耗时声明，按 0 处理',
      earliestStart: earliestStart.get(id)!,
      earliestFinish: earliestFinish.get(id)!,
      latestStart: latestStart.get(id)!,
      latestFinish: latestFinish.get(id)!,
      slack,
      critical,
      startRationale: startRationale.get(id) ?? [],
      rationale: chosenAt.get(id),
    };
  }
  criticalTasks.sort();

  // ---- 5. 关键路径：松弛度为 0 的节点上沿决定边回溯，枚举全部最长路径 ----
  const criticalSet = new Set(criticalTasks);
  const allPaths: string[][] = [];
  const pathStack: string[] = [];
  const enumerate = (id: string): void => {
    pathStack.push(id);
    const preds = predsOf.get(id)!.filter((pred) => criticalSet.has(pred.dep) && earliestFinish.get(pred.dep)! === earliestStart.get(id));
    if (preds.length === 0) {
      allPaths.push([...pathStack].reverse());
    } else {
      for (const pred of preds) enumerate(pred.dep);
    }
    pathStack.pop();
  };
  for (const id of criticalTasks) {
    if (earliestFinish.get(id)! === projectDuration) enumerate(id);
  }
  allPaths.sort((a, b) => a.join('>').localeCompare(b.join('>')));

  const blocked: BlockedTask[] = [...blockedMap.entries()]
    .map(([id, entry]) => ({
      id,
      reasons: [...entry.reasons],
      detail: [...new Set(entry.details)].join('；'),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  derivedEdges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  return { tasks: derivedTasks, edges: derivedEdges, order, projectDuration, criticalPaths: allPaths, criticalTasks, blocked };
}
