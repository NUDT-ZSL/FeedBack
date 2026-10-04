import { detectCycles } from './merge.ts';
import type {
  AppliedDecision,
  BatchInput,
  Decision,
  DurationClaim,
  DurationConflictIssue,
  Issue,
  MergedEdge,
  MergedTask,
} from './types.ts';

export interface ResolvedGraph {
  tasks: Record<string, MergedTask>; // 已应用裁决后的合并视图（含被登记的外部任务）
  edges: { from: string; to: string; edge: MergedEdge }[];
  issues: Issue[]; // 带 resolved 状态与裁决依据
  appliedDecisions: AppliedDecision[];
  ignoredDecisions: { decision: Decision; reason: string }[];
  warnings: string[];
  skipped: { edge: MergedEdge; reason: string }[];
}

// 应用裁决：每次裁决都会留痕；无法匹配当前冲突的裁决不会被静默吞掉，而是进入 ignoredDecisions。
export function applyDecisions(input: BatchInput, merged: {
  tasks: Record<string, MergedTask>;
  issues: Issue[];
  warnings: string[];
}): ResolvedGraph {
  const tasks = new Map<string, { task: MergedTask; dropped: Set<string> }>();
  for (const task of Object.values(merged.tasks)) {
    tasks.set(task.id, {
      task: { id: task.id, durations: task.durations.map((c) => ({ ...c })), deps: task.deps.map(cloneEdge) },
      dropped: new Set(),
    });
  }

  const issues: Issue[] = merged.issues.map((issue) => ({
    ...issue,
    ...(issue.kind === 'missing-target' ? { claims: issue.claims.map((c) => ({ ...c })) } : {}),
    ...(issue.kind === 'duration-conflict' ? { claims: issue.claims.map((c) => ({ ...c })) } : {}),
    ...(issue.kind === 'cycle' ? { tasks: [...issue.tasks], displayCycle: [...issue.displayCycle] } : {}),
  })) as Issue[];

  const appliedDecisions: AppliedDecision[] = [];
  const ignoredDecisions: { decision: Decision; reason: string }[] = [];
  const warnings = [...merged.warnings];

  const findIssue = (predicate: (issue: Issue) => boolean): Issue | undefined => issues.find(predicate);

  for (const decision of input.decisions ?? []) {
    switch (decision.type) {
      case 'select-duration': {
        const issue = findIssue((candidate) => candidate.kind === 'duration-conflict'
          && candidate.taskId === decision.taskId
          && candidate.status === 'open') as DurationConflictIssue | undefined;
        if (!issue) {
          ignoredDecisions.push({ decision, reason: `任务 ${decision.taskId} 当前没有待裁决的耗时冲突` });
          break;
        }
        const claim = issue.claims.find((candidate) => candidate.source === decision.source);
        if (!claim) {
          ignoredDecisions.push({ decision, reason: `来源 ${decision.source} 未声明过任务 ${decision.taskId} 的耗时` });
          break;
        }
        const holder = tasks.get(decision.taskId);
        if (holder) {
          holder.task.durations = [{ ...claim }];
        }
        issue.status = 'resolved';
        issue.resolution = `采纳来源 ${decision.source} 的耗时 ${claim.duration}`;
        appliedDecisions.push({ decision, effect: `${decision.taskId} 耗时确定为 ${claim.duration}（来源 ${decision.source}）` });
        break;
      }
      case 'override-duration': {
        const issue = findIssue((candidate) => candidate.kind === 'duration-conflict'
          && candidate.taskId === decision.taskId
          && candidate.status === 'open') as DurationConflictIssue | undefined;
        if (!issue) {
          ignoredDecisions.push({ decision, reason: `任务 ${decision.taskId} 当前没有待裁决的耗时冲突` });
          break;
        }
        if (typeof decision.duration !== 'number' || !Number.isFinite(decision.duration) || decision.duration < 0) {
          ignoredDecisions.push({ decision, reason: `人工耗时非法：${String(decision.duration)}` });
          break;
        }
        const claim: DurationClaim = {
          source: `decision@${decision.type}`,
          note: `人工裁决：覆盖任务 ${decision.taskId} 耗时`,
          duration: decision.duration,
        };
        const holder = tasks.get(decision.taskId);
        if (holder) holder.task.durations = [claim];
        issue.status = 'resolved';
        issue.resolution = `人工指定耗时 ${decision.duration}`;
        appliedDecisions.push({ decision, effect: `${decision.taskId} 耗时确定为 ${decision.duration}（人工指定）` });
        break;
      }
      case 'drop-edge': {
        const missing = findIssue((candidate) => candidate.kind === 'missing-target'
          && candidate.from === decision.from
          && candidate.to === decision.to
          && candidate.status === 'open');
        const holder = tasks.get(decision.from);
        const edgeIndex = holder?.task.deps.findIndex((edge) => edge.to === decision.to) ?? -1;
        if (missing) {
          if (holder && edgeIndex >= 0) {
            holder.task.deps.splice(edgeIndex, 1);
            holder.dropped.add(decision.to);
          }
          missing.status = 'resolved';
          missing.resolution = '裁决放弃该依赖指向';
          appliedDecisions.push({ decision, effect: `已删除依赖边 ${decision.from} -> ${decision.to}` });
          break;
        }
        // 针对成环的弃边：边当前存在，且位于某个待裁决环内。
        if (holder && edgeIndex >= 0) {
          const inOpenCycle = issues.some((candidate) => candidate.kind === 'cycle'
            && candidate.status === 'open'
            && candidate.tasks.includes(decision.from)
            && candidate.tasks.includes(decision.to));
          if (inOpenCycle) {
            holder.task.deps.splice(edgeIndex, 1);
            holder.dropped.add(decision.to);
            appliedDecisions.push({ decision, effect: `已删除依赖边 ${decision.from} -> ${decision.to}（用于解除成环）` });
            break;
          }
        }
        ignoredDecisions.push({ decision, reason: `依赖边 ${decision.from} -> ${decision.to} 不属于任何待裁决的缺失/成环问题` });
        break;
      }
      case 'declare-external': {
        const missing = findIssue((candidate) => candidate.kind === 'missing-target'
          && candidate.to === decision.taskId
          && candidate.status === 'open');
        if (!missing) {
          ignoredDecisions.push({ decision, reason: `${decision.taskId} 不是待裁决的缺失依赖目标` });
          break;
        }
        const duration = typeof decision.duration === 'number' && Number.isFinite(decision.duration) && decision.duration >= 0
          ? decision.duration
          : 0;
        if (decision.duration !== undefined && duration !== decision.duration) {
          warnings.push(`外部任务 ${decision.taskId} 的登记耗时非法，回退为 0`);
        }
        tasks.set(decision.taskId, {
          task: {
            id: decision.taskId,
            durations: [{ source: `decision@${decision.type}`, note: '裁决登记的外部任务', duration }],
            deps: [],
          },
          dropped: new Set(),
        });
        missing.status = 'resolved';
        missing.resolution = `登记为外部任务（耗时 ${duration}）`;
        appliedDecisions.push({ decision, effect: `${decision.taskId} 登记为外部任务，耗时 ${duration}` });
        break;
      }
    }
  }

  // 缺失问题结算：仍 open 的可选依赖自动跳过（可解释，不阻塞）；硬依赖保持 open。
  const skipped: { edge: MergedEdge; reason: string }[] = [];
  for (const issue of issues) {
    if (issue.kind !== 'missing-target' || issue.status !== 'open') continue;
    if (issue.optional) {
      const holder = tasks.get(issue.from);
      const edgeIndex = holder?.task.deps.findIndex((edge) => edge.to === issue.to) ?? -1;
      if (holder && edgeIndex >= 0) {
        skipped.push({ edge: cloneEdge(holder.task.deps[edgeIndex]), reason: '可选依赖且目标缺失，自动跳过（已记录）' });
        holder.task.deps.splice(edgeIndex, 1);
      }
      issue.status = 'resolved';
      issue.resolution = '可选依赖且目标缺失，自动跳过（已记录）';
    }
  }

  // 弃边后重新检测环：已断开的环标记 resolved，剩余环保持/新增为 open。
  const remainingCycles = detectCycles(new Map([...tasks].map(([id, holder]) => [id, holder.task])));
  for (const issue of issues) {
    if (issue.kind !== 'cycle') continue;
    const stillThere = remainingCycles.some((remaining) => setsEqual(remaining.tasks, issue.tasks));
    if (!stillThere && issue.status === 'open') {
      issue.status = 'resolved';
      issue.resolution = '依赖边已按裁决删除，环解除';
    }
  }
  const knownKeys = new Set(issues.filter((issue) => issue.kind === 'cycle').map((issue) => issue.tasks.slice().sort().join('+')));
  for (const remaining of remainingCycles) {
    const key = remaining.tasks.join('+');
    if (!knownKeys.has(key)) issues.push(remaining);
  }

  const resolvedTasks = Object.fromEntries([...tasks.values()].map((holder) => [holder.task.id, holder.task]));
  const edges: { from: string; to: string; edge: MergedEdge }[] = [];
  for (const task of Object.values(resolvedTasks)) {
    for (const edge of task.deps) edges.push({ from: task.id, to: edge.to, edge });
  }
  edges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  return { tasks: resolvedTasks, edges, issues, appliedDecisions, ignoredDecisions, warnings, skipped };
}

function cloneEdge(edge: MergedEdge): MergedEdge {
  return { from: edge.from, to: edge.to, optional: edge.optional, claims: edge.claims.map((claim) => ({ ...claim })) };
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}
