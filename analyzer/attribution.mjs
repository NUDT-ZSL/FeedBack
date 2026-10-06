/**
 * 按路径归因：枚举 DAG 中全部“根到叶”路径，逐层分摊累计耗时。
 *
 * 共享节点：节点 n 被 k(n) 条不同路径经过时（多父 DAG 下一个节点可在多条路径上），
 * 在每条路径下记贡献 duration(n)/k(n)，从而：
 *  - 同一节点在不同路径下的贡献被明确区分；
 *  - 全局满足耗时守恒：Σ 路径累计耗时 == Σ 节点耗时。
 */

import { ANALYZER_VERSION, pathKey, round6, sortDiagnostics } from './model.mjs';
import { buildGraph } from './graph.mjs';

/** 枚举全部根到叶路径（节点 id 序列），按路径 key 排序去重。 */
export function enumeratePaths(nodes) {
  const roots = [...nodes.values()].filter((n) => n.parents.length === 0).map((n) => n.id).sort();
  const keys = new Set();
  const paths = [];
  const walk = (id, acc) => {
    const node = nodes.get(id);
    const next = [...acc, id];
    if (node.children.length === 0) {
      const key = pathKey(next);
      if (!keys.has(key)) {
        keys.add(key);
        paths.push(next);
      }
      return;
    }
    for (const childId of [...node.children].sort()) walk(childId, next);
  };
  for (const root of roots) walk(root, []);
  return paths.sort((a, b) => (pathKey(a) < pathKey(b) ? -1 : 1));
}

/** 每个节点被多少条不同路径经过。 */
export function pathMembership(paths) {
  const k = new Map();
  for (const path of paths) {
    for (const id of new Set(path)) k.set(id, (k.get(id) ?? 0) + 1);
  }
  return k;
}

/** 由路径与成员计数计算单条路径的逐层归因。 */
export function attributePath(nodes, path, k) {
  const contributions = path.map((id) => {
    const duration = nodes.get(id).duration;
    const count = k.get(id) ?? 1;
    return {
      nodeId: id,
      duration,
      pathCount: count,
      contribution: round6(duration / count),
    };
  });
  const total = round6(contributions.reduce((sum, c) => sum + c.contribution, 0));
  return { key: pathKey(path), path: [...path], totalDuration: total, contributions };
}

/** 由图状态生成完整归因报告（全量与增量共用同一输出形状）。 */
export function buildReport(nodes, paths, k, diagnostics, stats) {
  const pathAttributions = paths.map((p) => attributePath(nodes, p, k));
  const totalDuration = round6([...nodes.values()].reduce((s, n) => s + n.duration, 0));
  const attributedTotal = round6(pathAttributions.reduce((s, p) => s + p.totalDuration, 0));
  const sharedNodes = [...k.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({
      nodeId: id,
      pathCount: count,
      perPathContribution: round6(nodes.get(id).duration / count),
    }))
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  return {
    analyzerVersion: ANALYZER_VERSION,
    nodes: [...nodes.values()]
      .map((n) => ({ id: n.id, duration: n.duration, parents: [...n.parents] }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    paths: pathAttributions,
    sharedNodes,
    diagnostics: sortDiagnostics(diagnostics),
    totals: {
      nodeDurationTotal: totalDuration,
      attributedTotal,
      conserved: Math.abs(totalDuration - attributedTotal) < 1e-5,
    },
    stats,
  };
}

/** 全量归因：导入样本 -> 还原调用树 -> 按路径归因。 */
export function runFullAttribution(samples) {
  const graph = buildGraph(samples);
  const paths = enumeratePaths(graph.nodes);
  const k = pathMembership(paths);
  return buildReport(graph.nodes, paths, k, graph.diagnostics, graph.stats);
}
