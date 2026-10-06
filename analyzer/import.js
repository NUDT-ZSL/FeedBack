/**
 * 调用链样本导入与调用树还原。
 *
 * 输入样本格式（trace）：
 *   { traceId: string, nodes: [{ id, name, parentId, durationMs }] }
 *
 * 导入阶段对所有边界输入产生「可观察」的异常记录（anomalies），绝不静默跳过：
 *   - invalid-duration   耗时字段缺失/非有限数值，按 0 处理
 *   - negative-duration  耗时为负，按 0 处理
 *   - duplicate-node     同一 trace 内节点 id 重复，保留先导入者
 *   - missing-parent     父节点引用不存在，节点提升为根
 *   - cycle              父引用成环，断开环边，节点提升为根
 */

export function buildTrace(sample) {
  const traceId = sample.traceId;
  const anomalies = [];
  const nodes = new Map();

  for (const raw of sample.nodes ?? []) {
    if (raw == null || raw.id == null) {
      anomalies.push({
        type: 'invalid-node',
        traceId,
        nodeId: null,
        detail: 'node entry missing id; entry ignored',
      });
      continue;
    }
    const id = String(raw.id);
    if (nodes.has(id)) {
      anomalies.push({
        type: 'duplicate-node',
        traceId,
        nodeId: id,
        detail: `duplicate node id '${id}'; first occurrence kept`,
      });
      continue;
    }
    let durationMs = raw.durationMs;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
      anomalies.push({
        type: 'invalid-duration',
        traceId,
        nodeId: id,
        detail: `durationMs is not a finite number (got ${JSON.stringify(durationMs)}); treated as 0`,
      });
      durationMs = 0;
    } else if (durationMs < 0) {
      anomalies.push({
        type: 'negative-duration',
        traceId,
        nodeId: id,
        detail: `durationMs is negative (${durationMs}); treated as 0`,
      });
      durationMs = 0;
    }
    nodes.set(id, {
      id,
      name: raw.name != null ? String(raw.name) : id,
      parentId: raw.parentId != null ? String(raw.parentId) : null,
      durationMs,
      effectiveParentId: null,
      children: [],
    });
  }

  // 解析父引用：缺失父节点 -> 提升为根
  for (const node of nodes.values()) {
    let parent = node.parentId;
    if (parent !== null && !nodes.has(parent)) {
      anomalies.push({
        type: 'missing-parent',
        traceId,
        nodeId: node.id,
        detail: `parent '${parent}' not found in trace; node promoted to root`,
      });
      parent = null;
    }
    node.effectiveParentId = parent;
  }

  // 环检测（与导入顺序无关）：从每个节点沿父链回溯收集全部环，
  // 每个环只断一次——将环中 id 最小的节点提升为根（断开其入向父边），
  // 因此无论节点按什么顺序导入，断环结果与异常记录完全一致。
  const cycles = new Map(); // 环成员集合（排序后的 id 串为键，保证同一环只处理一次）
  for (const node of nodes.values()) {
    const index = new Map();
    let cursor = node.effectiveParentId;
    while (cursor !== null && !index.has(cursor)) {
      index.set(cursor, index.size);
      cursor = nodes.get(cursor).effectiveParentId;
    }
    if (cursor !== null) {
      const members = [...index.keys()].slice(index.get(cursor));
      const key = [...members].sort().join('|');
      if (!cycles.has(key)) cycles.set(key, new Set(members));
    }
  }
  for (const members of cycles.values()) {
    const promoted = [...members].sort()[0];
    const promotedNode = nodes.get(promoted);
    anomalies.push({
      type: 'cycle',
      traceId,
      nodeId: promoted,
      detail: `parent chain forms a cycle ${[...members].sort().join(' -> ')} -> ${promoted}; '${promoted}' promoted to root (edge to '${promotedNode.effectiveParentId}' detached)`,
    });
    promotedNode.effectiveParentId = null;
  }

  const rootIds = [];
  for (const node of nodes.values()) {
    if (node.effectiveParentId === null) {
      rootIds.push(node.id);
    } else {
      nodes.get(node.effectiveParentId).children.push(node.id);
    }
  }
  // 子节点按 id 排序，保证结构枚举与导入顺序无关
  for (const node of nodes.values()) node.children.sort();
  rootIds.sort();

  return { traceId, nodes, rootIds, anomalies };
}

export function importSamples(samples) {
  const traces = new Map();
  const anomalies = [];
  for (const sample of samples) {
    const trace = buildTrace(sample);
    if (traces.has(trace.traceId)) {
      anomalies.push({
        type: 'duplicate-trace',
        traceId: trace.traceId,
        nodeId: null,
        detail: `duplicate traceId '${trace.traceId}'; first occurrence kept`,
      });
      continue;
    }
    traces.set(trace.traceId, trace);
    anomalies.push(...trace.anomalies);
  }
  return { traces, anomalies };
}
