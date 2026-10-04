import { stableHash, stableStringify } from './hash.ts';
import { describeInput } from './merge.ts';
import { applyDecisions } from './resolve.ts';
import { schedule } from './schedule.ts';
import type { BatchInput, DeriveResult, SkippedEdge } from './types.ts';

// 唯一的整体推演入口：声明合并 -> 冲突/缺失/成环检测 -> 应用裁决 -> 调度/CPM/关键路径。
export function derive(input: BatchInput): DeriveResult {
  const merged = describeInput(input);
  const resolved = applyDecisions(input, merged);
  const scheduled = schedule(resolved.tasks, resolved.edges, resolved.issues);

  const skippedEdges: SkippedEdge[] = resolved.skipped.map(({ edge, reason }) => ({
    from: edge.from,
    to: edge.to,
    optional: edge.optional,
    claims: edge.claims.map((claim) => ({ ...claim })),
    reason,
  }));

  const fingerprint = stableHash({
    declarations: input.declarations ?? [],
    decisions: input.decisions ?? [],
  });

  return {
    inputName: input.name ?? 'unnamed',
    fingerprint,
    tasks: scheduled.tasks,
    edges: scheduled.edges,
    skippedEdges,
    order: scheduled.order,
    projectDuration: scheduled.projectDuration,
    criticalPaths: scheduled.criticalPaths,
    criticalTasks: scheduled.criticalTasks,
    issues: resolved.issues,
    blocked: scheduled.blocked,
    appliedDecisions: resolved.appliedDecisions,
    ignoredDecisions: resolved.ignoredDecisions,
    warnings: resolved.warnings,
  };
}

export function fingerprintOf(input: BatchInput): string {
  return stableHash({ declarations: input.declarations ?? [], decisions: input.decisions ?? [] });
}

export { stableStringify };
