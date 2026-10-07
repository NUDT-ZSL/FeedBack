/**
 * 依赖分析：证候规则之间、证候与体质/病史修正之间的依赖图。
 * 依赖闭环与指向缺失不会被静默跳过，而是作为 DependencyIssue 显式暴露，
 * 受影响证候被标记为 blocked。
 */
import { SYNDROME_RULES, type SyndromeRule } from './data/rules';
import type { DependencyIssue } from './types';

export interface DependencyPlan {
  /** 可评估证候的确定性评估顺序（拓扑序，同层按 id 字典序）。 */
  evalOrder: string[];
  /** 因闭环或缺失引用被阻断的证候及其原因。 */
  blocked: Map<string, string>;
  issues: DependencyIssue[];
}

const KNOWN_MODIFIER_PREFIXES = ['constitution:', 'history:'];

export function buildDependencyPlan(
  rules: SyndromeRule[] = SYNDROME_RULES,
): DependencyPlan {
  const issues: DependencyIssue[] = [];
  const blocked = new Map<string, string>();
  const ruleIds = new Set(rules.map((r) => r.id));

  // 1) 指向缺失：dependsOn 引用了不存在的证候；modifier 引用了非法命名空间。
  const edges = new Map<string, string[]>();
  for (const rule of rules) {
    const deps: string[] = [];
    for (const depId of Object.keys(rule.dependsOn)) {
      if (!ruleIds.has(depId)) {
        issues.push({
          type: 'missing_reference',
          nodes: [rule.id, depId],
          message: `证候「${rule.name}」(${rule.id}) 依赖了不存在的证候 ${depId}`,
        });
        blocked.set(rule.id, `依赖缺失：${depId}`);
        continue;
      }
      deps.push(depId);
    }
    for (const modId of Object.keys(rule.modifiers)) {
      if (!KNOWN_MODIFIER_PREFIXES.some((p) => modId.startsWith(p))) {
        issues.push({
          type: 'missing_reference',
          nodes: [rule.id, modId],
          message: `证候「${rule.name}」(${rule.id}) 的修正项指向未知来源 ${modId}`,
        });
        blocked.set(rule.id, `修正项指向缺失：${modId}`);
      }
    }
    edges.set(rule.id, deps);
  }

  // 2) 依赖闭环：Kahn 拓扑排序，同层按 id 字典序保证确定性。
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const rule of rules) {
    if (blocked.has(rule.id)) continue;
    const deps = (edges.get(rule.id) ?? []).filter((d) => !blocked.has(d));
    indegree.set(rule.id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(rule.id);
      dependents.set(dep, list);
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();
  const evalOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    evalOrder.push(id);
    for (const next of (dependents.get(id) ?? []).slice().sort()) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) {
        // 保持队列有序，保证同层顺序确定。
        const idx = queue.findIndex((q) => q > next);
        if (idx === -1) queue.push(next);
        else queue.splice(idx, 0, next);
      }
    }
  }

  // 剩余未入列的证候处于闭环中。
  const evaluated = new Set(evalOrder);
  const cyclic = rules
    .map((r) => r.id)
    .filter((id) => !evaluated.has(id) && !blocked.has(id))
    .sort();
  if (cyclic.length > 0) {
    // 还原一条闭环路径用于展示。
    const cyclePath = traceCycle(cyclic[0], edges);
    issues.push({
      type: 'dependency_cycle',
      nodes: cyclePath,
      message: `证候依赖存在闭环：${cyclePath.join(' -> ')}，相关证候已阻断，需先解除闭环`,
    });
    for (const id of cyclic) {
      blocked.set(id, `依赖闭环：${cyclePath.join(' -> ')}`);
    }
  }

  return { evalOrder, blocked, issues };
}

function traceCycle(start: string, edges: Map<string, string[]>): string[] {
  const path: string[] = [start];
  const seen = new Set<string>([start]);
  let current = start;
  for (;;) {
    const next = (edges.get(current) ?? []).slice().sort()[0];
    if (next === undefined) return path;
    if (seen.has(next)) {
      const idx = path.indexOf(next);
      return [...path.slice(idx), next];
    }
    seen.add(next);
    path.push(next);
    current = next;
  }
}
