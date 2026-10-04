import type {
  BatchInput,
  CycleIssue,
  DurationClaim,
  DurationConflictIssue,
  EdgeClaim,
  Issue,
  MergedTask,
  TaskDecl,
} from './types.ts';

// 多条来源声明合并为“每个任务一个合并视图”。冲突全部保留，不在此处择一。
export function mergeDeclarations(declarations: TaskDecl[]): {
  tasks: Record<string, MergedTask>;
  issues: Issue[];
  warnings: string[];
} {
  const tasks = new Map<string, MergedTask>();
  const warnings: string[] = [];
  const seenClaims = new Set<string>();

  const ensure = (id: string): MergedTask => {
    let task = tasks.get(id);
    if (!task) {
      task = { id, durations: [], deps: [] };
      tasks.set(id, task);
    }
    return task;
  };

  for (const decl of declarations) {
    if (!decl || typeof decl.taskId !== 'string' || !decl.taskId.trim()) {
      warnings.push('忽略一条缺少 taskId 的声明');
      continue;
    }
    const task = ensure(decl.taskId);

    if (typeof decl.duration !== 'number' || !Number.isFinite(decl.duration)) {
      warnings.push(`任务 ${decl.taskId} 的来源 ${decl.source} 耗时非法（${String(decl.duration)}），该耗时声明不参与合并`);
    } else {
      const claim: DurationClaim = {
        source: decl.source,
        note: decl.note,
        duration: decl.duration < 0 ? 0 : decl.duration,
      };
      if (decl.duration < 0) {
        warnings.push(`任务 ${decl.taskId} 的来源 ${decl.source} 耗时为负，按 0 处理`);
      }
      const key = `${decl.taskId}|${claim.source}|${claim.duration}`;
      if (!seenClaims.has(key)) {
        seenClaims.add(key);
        task.durations.push(claim);
      }
    }

    const depLists: { id: string; optional: boolean }[] = [
      ...(decl.dependsOn ?? []).map((id) => ({ id, optional: false })),
      ...(decl.optionalDependsOn ?? []).map((id) => ({ id, optional: true })),
    ];
    for (const dep of depLists) {
      if (typeof dep.id !== 'string' || !dep.id.trim()) {
        warnings.push(`任务 ${decl.taskId} 的来源 ${decl.source} 含空依赖指向，已忽略`);
        continue;
      }
      let edge = task.deps.find((candidate) => candidate.to === dep.id);
      if (!edge) {
        edge = { from: decl.taskId, to: dep.id, optional: dep.optional, claims: [] };
        task.deps.push(edge);
      }
      edge.optional = edge.optional && dep.optional; // 任一来源视为硬依赖则为硬依赖
      const claim: EdgeClaim = { source: decl.source, note: decl.note, optional: dep.optional };
      if (!edge.claims.some((existing) => existing.source === claim.source)) {
        edge.claims.push(claim);
      }
    }
  }

  const issues: Issue[] = [];

  // 耗时冲突：同一任务出现多个不同耗时，必须保留全部并要求裁决。
  for (const task of tasks.values()) {
    const distinct = new Map<number, DurationClaim[]>();
    for (const claim of task.durations) {
      const list = distinct.get(claim.duration) ?? [];
      list.push(claim);
      distinct.set(claim.duration, list);
    }
    if (distinct.size > 1) {
      const issue: DurationConflictIssue = {
        kind: 'duration-conflict',
        id: `duration:${task.id}`,
        taskId: task.id,
        claims: [...task.durations],
        status: 'open',
      };
      issues.push(issue);
    }
  }

  // 依赖指向不存在的任务：硬依赖挂起待裁决；可选依赖自动跳过并记录。
  for (const task of tasks.values()) {
    for (const edge of task.deps) {
      if (!tasks.has(edge.to)) {
        issues.push({
          kind: 'missing-target',
          id: `missing:${edge.from}->${edge.to}`,
          from: edge.from,
          to: edge.to,
          optional: edge.optional,
          claims: [...edge.claims],
          status: 'open',
        });
      }
    }
  }

  detectCycles(tasks).forEach((issue) => issues.push(issue));
  return { tasks: Object.fromEntries(tasks), issues, warnings };
}

// Tarjan 强连通分量；任何 size>1（含自环）的分量都是环。
export function detectCycles(tasks: Map<string, MergedTask> | Record<string, MergedTask>, sink: CycleIssue[] = []): CycleIssue[] {
  const map = tasks instanceof Map ? tasks : new Map(Object.entries(tasks));
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;

  const visit = (node: string): void => {
    indexOf.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);

    const task = map.get(node);
    for (const edge of task?.deps ?? []) {
      const next = edge.to;
      if (!map.has(next)) continue;
      if (!indexOf.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indexOf.get(next)!));
      }
    }

    if (low.get(node) === indexOf.get(node)) {
      const component: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      const selfLoop = component.length === 1 && (map.get(component[0])?.deps.some((edge) => edge.to === component[0]) ?? false);
      if (component.length > 1 || selfLoop) {
        component.sort();
        sink.push({
          kind: 'cycle',
          id: `cycle:${component.join('+')}`,
          tasks: component,
          displayCycle: buildCyclePath(component, map),
          status: 'open',
        });
      }
    }
  };

  for (const id of [...map.keys()].sort()) {
    if (!indexOf.has(id)) visit(id);
  }
  sink.sort((a, b) => a.id.localeCompare(b.id));
  return sink;
}

function buildCyclePath(component: string[], map: Map<string, MergedTask>): string[] {
  const members = new Set(component);
  const start = component[0];
  const path = [start];
  const visited = new Set<string>([start]);
  const walk = (node: string): boolean => {
    const task = map.get(node);
    for (const edge of [...(task?.deps ?? [])].sort((a, b) => a.to.localeCompare(b.to))) {
      if (!members.has(edge.to) || visited.has(edge.to)) {
        if (edge.to === start && path.length > 1) {
          return true;
        }
        continue;
      }
      visited.add(edge.to);
      path.push(edge.to);
      if (walk(edge.to)) return true;
      path.pop();
      visited.delete(edge.to);
    }
    return false;
  };
  walk(start);
  path.push(start);
  return path;
}

export function describeInput(input: BatchInput): {
  tasks: Record<string, MergedTask>;
  issues: Issue[];
  warnings: string[];
} {
  return mergeDeclarations(input.declarations ?? []);
}
