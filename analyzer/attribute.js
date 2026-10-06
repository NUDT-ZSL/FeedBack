/**
 * 按路径逐层归因累计耗时。
 *
 * 语义定义：
 *   selfMs(node)      = max(0, durationMs(node) - sum(durationMs(children)))
 *                       子节点耗时之和超过父节点时产生 negative-self-time 异常（可观察），self 按 0 计
 *   cumulativeMs(n)   = 沿根到 n 的路径上所有节点 selfMs 之和（逐层累计）
 *   path.totalMs      = 叶子节点的 cumulativeMs，即该路径的累计归因耗时
 *
 * 共享节点（同名节点出现在多条路径）的贡献按路径分别记录，不做全局合并。
 */

export function computeSelfTimes(trace) {
  const selfMs = new Map();
  const anomalies = [];
  for (const node of trace.nodes.values()) {
    let childSum = 0;
    for (const childId of node.children) {
      childSum += trace.nodes.get(childId).durationMs;
    }
    const raw = node.durationMs - childSum;
    if (raw < 0) {
      anomalies.push({
        type: 'negative-self-time',
        traceId: trace.traceId,
        nodeId: node.id,
        detail: `children durations (${childSum}ms) exceed node duration (${node.durationMs}ms); self time clamped to 0`,
      });
    }
    selfMs.set(node.id, Math.max(0, raw));
  }
  return { selfMs, anomalies };
}

/**
 * 枚举 trace 中所有根到叶子的路径，并计算每个节点自根的累计值。
 * 返回 paths（按 key 排序）与 nodeCumulative（nodeId -> 自根累计 selfMs）。
 */
export function attributeTrace(trace) {
  const { selfMs, anomalies } = computeSelfTimes(trace);
  const nodeCumulative = new Map();
  const paths = [];

  const visit = (nodeId, prefixIds, prefixCum) => {
    const node = trace.nodes.get(nodeId);
    const cum = prefixCum + selfMs.get(nodeId);
    nodeCumulative.set(nodeId, cum);
    const ids = [...prefixIds, nodeId];
    if (node.children.length === 0) {
      const entries = ids.map((id, depth) => {
        const n = trace.nodes.get(id);
        return {
          nodeId: id,
          name: n.name,
          depth,
          selfMs: selfMs.get(id),
          cumulativeMs: nodeCumulative.get(id),
        };
      });
      paths.push({
        key: `${trace.traceId}:${ids.join('/')}`,
        label: `${trace.traceId}:${ids.map((id) => trace.nodes.get(id).name).join('>')}`,
        traceId: trace.traceId,
        nodeIds: ids,
        entries,
        totalMs: cum,
      });
      return;
    }
    for (const childId of node.children) visit(childId, ids, cum);
  };

  for (const rootId of trace.rootIds) visit(rootId, [], 0);
  paths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { paths, nodeCumulative, selfMs, anomalies };
}

/**
 * 汇总共享节点视图：name -> 各路径下的贡献（selfMs 合计、出现次数、路径内最大累计值）。
 * 只保留出现在多于一条路径中的名称。
 */
export function computeSharedNodes(paths) {
  const byName = new Map();
  for (const path of paths) {
    const perPath = new Map();
    for (const entry of path.entries) {
      const slot = perPath.get(entry.name) ?? { selfMs: 0, occurrences: 0, maxCumulativeMs: 0 };
      slot.selfMs += entry.selfMs;
      slot.occurrences += 1;
      slot.maxCumulativeMs = Math.max(slot.maxCumulativeMs, entry.cumulativeMs);
      perPath.set(entry.name, slot);
    }
    for (const [name, slot] of perPath) {
      const record = byName.get(name) ?? {};
      record[path.label] = slot;
      byName.set(name, record);
    }
  }
  const shared = {};
  for (const [name, record] of byName) {
    if (Object.keys(record).length > 1) shared[name] = record;
  }
  return shared;
}
