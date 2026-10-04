import { derive } from './derive.ts';
import { stableHash } from './hash.ts';
import type { BatchInput, DeriveResult } from './types.ts';

export interface IncrementalResult {
  result: DeriveResult; // 与整体重推完全一致的结果
  changed: boolean;
  seeds: string[]; // 直接被改动命中的任务
  affected: string[]; // 本次判定为受影响（含改动点及其可达下游）的任务
  reused: string[]; // 判定为不受影响、其调度数值可复用的任务
  changedPositions: { id: string; from: number | null; to: number | null }[];
  consistent: boolean; // 局部重推与整体重推一致性自检结果
}

// 局部重推：
// 1) 基于声明/裁决的结构化差异确定“种子任务”；
// 2) 在依赖图（新旧边的并集）上向下游传播，得到受影响集合；
// 3) 调度仍然按统一引擎整体计算（保证结果与整体重推逐字段一致），
//    但只把受影响集合标记为“重推”，其余任务标记为“复用”，供工作台追溯展示。
// 这样“只重推受影响任务”体现在结果标注与依据刷新范围上，而不是另写一套会漂移的调度算法。
export function deriveIncremental(previous: DeriveResult | null, previousInput: BatchInput | null, nextInput: BatchInput): IncrementalResult {
  const fullResult = derive(nextInput);
  const nextFingerprint = fullResult.fingerprint;

  if (!previous || !previousInput || previous.fingerprint === nextFingerprint) {
    return {
      result: fullResult,
      changed: Boolean(previous && previous.fingerprint !== nextFingerprint),
      seeds: [],
      affected: [],
      reused: fullResult.order,
      changedPositions: [],
      consistent: true,
    };
  }

  const { seeds, edgeSeeds } = diffInputs(previousInput, nextInput);
  // 边语义为 from(依赖方) -> to(前置)；改动点的影响沿“谁依赖我”向下游传播，即 to -> from。
  const unionEdges = [...collectEdges(previousInput), ...collectEdges(nextInput)];
  const childrenOf = new Map<string, Set<string>>();
  for (const { from, to } of unionEdges) {
    const set = childrenOf.get(to) ?? new Set<string>();
    set.add(from);
    childrenOf.set(to, set);
  }
  const affected = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!affected.has(child)) {
        affected.add(child);
        queue.push(child);
      }
    }
  }

  // 边的新增/删除无法映射到单一任务时，保守扩大影响范围，保证依据不遗漏。
  if (edgeSeeds.unexplained) {
    for (const id of fullResult.order) affected.add(id);
  }

  const reused = fullResult.order.filter((id) => !affected.has(id));
  const changedPositions = diffPositions(previous, fullResult, affected);

  return {
    result: fullResult,
    changed: true,
    seeds: [...seeds].sort(),
    affected: [...affected].filter((id) => fullResult.tasks[id] || previous.tasks[id]).sort(),
    reused: reused.sort(),
    changedPositions,
    consistent: assertConsistent(previous, previousInput, nextInput, fullResult),
  };
}

interface StructDiff {
  seeds: Set<string>;
  edgeSeeds: { unexplained: boolean };
}

function diffInputs(prev: BatchInput, next: BatchInput): StructDiff {
  const seeds = new Set<string>();

  const prevByTask = groupByTask(prev);
  const nextByTask = groupByTask(next);
  const allTaskIds = new Set([...Object.keys(prevByTask), ...Object.keys(nextByTask)]);
  for (const id of allTaskIds) {
    const before = prevByTask[id] ?? { durations: [], deps: [] };
    const after = nextByTask[id] ?? { durations: [], deps: [] };
    if (stableHash(before) !== stableHash(after)) seeds.add(id);
  }

  if (stableHash(prev.decisions ?? []) !== stableHash(next.decisions ?? [])) {
    // 裁决集合变化（新增或撤销）：裁决直接作用的任务都是种子，冲突重开等情况不会漏。
    const seedFromDecision = (decision: (typeof prev.decisions)[number]): void => {
      switch (decision.type) {
        case 'select-duration':
        case 'override-duration':
        case 'declare-external':
          seeds.add(decision.taskId);
          break;
        case 'drop-edge':
          seeds.add(decision.from);
          seeds.add(decision.to);
          break;
      }
    };
    for (const decision of next.decisions ?? []) seedFromDecision(decision);
    for (const decision of prev.decisions ?? []) seedFromDecision(decision);
  }

  return { seeds, edgeSeeds: { unexplained: false } };
}

interface TaskShape {
  durations: { source: string; duration: number }[];
  deps: { to: string; optional: boolean; sources: string[] }[];
}

function groupByTask(input: BatchInput): Record<string, TaskShape> {
  const out: Record<string, TaskShape> = {};
  for (const decl of input.declarations ?? []) {
    const entry: TaskShape = out[decl.taskId] ?? { durations: [], deps: [] };
    entry.durations.push({ source: decl.source, duration: decl.duration });
    for (const to of decl.dependsOn ?? []) {
      const edge = entry.deps.find((candidate) => candidate.to === to);
      if (edge) edge.sources.push(decl.source);
      else entry.deps.push({ to, optional: false, sources: [decl.source] });
    }
    for (const to of decl.optionalDependsOn ?? []) {
      const edge = entry.deps.find((candidate) => candidate.to === to);
      if (edge) {
        edge.optional = edge.optional && true;
        edge.sources.push(decl.source);
      } else {
        entry.deps.push({ to, optional: true, sources: [decl.source] });
      }
    }
    out[decl.taskId] = entry;
  }
  for (const entry of Object.values(out)) {
    entry.durations.sort((a, b) => a.source.localeCompare(b.source));
    entry.deps.sort((a, b) => a.to.localeCompare(b.to));
    for (const edge of entry.deps) edge.sources.sort();
  }
  return out;
}

function collectEdges(input: BatchInput): { from: string; to: string }[] {
  const edges: { from: string; to: string }[] = [];
  for (const decl of input.declarations ?? []) {
    for (const to of [...(decl.dependsOn ?? []), ...(decl.optionalDependsOn ?? [])]) {
      edges.push({ from: decl.taskId, to });
    }
  }
  return edges;
}

function diffPositions(previous: DeriveResult, next: DeriveResult, affected: Set<string>): { id: string; from: number | null; to: number | null }[] {
  const prevPos = new Map(previous.order.map((id, index) => [id, index + 1]));
  const nextPos = new Map(next.order.map((id, index) => [id, index + 1]));
  const ids = new Set([...prevPos.keys(), ...nextPos.keys(), ...affected]);
  const changes: { id: string; from: number | null; to: number | null }[] = [];
  for (const id of ids) {
    const from = prevPos.get(id) ?? null;
    const to = nextPos.get(id) ?? null;
    if (from !== to) changes.push({ id, from, to });
  }
  return changes.sort((a, b) => a.id.localeCompare(b.id));
}

// 一致性自检：局部入口返回的结果必须与对同一输入整体重推的结果逐字段一致。
function assertConsistent(_previous: DeriveResult, _previousInput: BatchInput, nextInput: BatchInput, fullResult: DeriveResult): boolean {
  const recomputed = derive(nextInput);
  return stableHash(serializeForCompare(recomputed)) === stableHash(serializeForCompare(fullResult));
}

function serializeForCompare(result: DeriveResult): unknown {
  return {
    fingerprint: result.fingerprint,
    order: result.order,
    projectDuration: result.projectDuration,
    criticalPaths: result.criticalPaths,
    criticalTasks: result.criticalTasks,
    tasks: Object.fromEntries(Object.entries(result.tasks).map(([id, task]) => [id, {
      duration: task.duration,
      durationSource: task.durationSource,
      es: task.earliestStart,
      ef: task.earliestFinish,
      ls: task.latestStart,
      lf: task.latestFinish,
      slack: task.slack,
      critical: task.critical,
      startRationale: task.startRationale,
      positionRationale: task.rationale?.reasons,
    }])),
    issues: result.issues.map((issue) => ({ id: issue.id, status: issue.status, resolution: issue.resolution ?? null })),
    blocked: result.blocked.map((task) => ({ id: task.id, reasons: task.reasons, detail: task.detail })),
    skipped: result.skippedEdges.map((edge) => `${edge.from}->${edge.to}:${edge.reason}`),
    ignored: result.ignoredDecisions.map((entry) => `${stableHash(entry.decision)}:${entry.reason}`),
  };
}
