// ================= 掌握度传播、路径推导与增量重推 =================

// 可信子图上的拓扑学习顺序（Kahn 分层），不可信节点不进入路径。
function topoOrder(graphInfo) {
  const map = buildIndex();
  const trusted = KNOWLEDGE.filter(k => !graphInfo.untrustworthy.has(k.id)).map(k => k.id);
  const indeg = {}, children = {};
  trusted.forEach(id => { indeg[id] = 0; children[id] = []; });
  trusted.forEach(id => {
    map[id].prereqs.forEach(p => {
      if (indeg[p] !== undefined) { indeg[id]++; children[p].push(id); }
    });
  });
  const queue = trusted.filter(id => indeg[id] === 0).sort();
  const order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    children[cur].sort().forEach(n => { if (--indeg[n] === 0) queue.push(n); });
  }
  return order;
}

// 全量推导：直接判定 -> 沿依赖传播 -> 解锁状态 -> 学习顺序。
// overrides: { kp: 'mastered' | 'failed' }，来自用户裁决或手动调整。
function deriveState(learnerId, overrides) {
  const graph = validateGraph();
  const byKp = learnerRecords(learnerId);
  const conflicts = detectConflicts(learnerId);
  const map = buildIndex();
  const state = {};
  KNOWLEDGE.forEach(k => {
    const id = k.id;
    if (overrides[id]) {
      state[id] = { status: overrides[id] === 'mastered' ? 'mastered' : 'failed', source: '用户裁决/调整' };
    } else if (conflicts[id]) {
      state[id] = { status: 'conflict', source: '矛盾待裁决' };
    } else if (byKp[id] && byKp[id].length) {
      const last = byKp[id][byKp[id].length - 1]; // 时刻最新的一条
      state[id] = { status: last.verdict === 'mastered' ? 'mastered' : 'failed', source: last.source };
    } else {
      state[id] = { status: 'none', source: null };
    }
  });
  // 沿依赖传播：掌握某知识点 => 其全部前置推断为掌握（不覆盖已有判定/矛盾）。
  KNOWLEDGE.forEach(k => {
    if (state[k.id].status === 'mastered') {
      ancestorsOf(k.id).forEach(p => {
        if (p !== k.id && state[p] && state[p].status === 'none')
          state[p] = { status: 'inferred', source: '由 ' + k.id + ' 推断' };
      });
    }
  });
  const isMastered = id => state[id] && ['mastered', 'inferred'].includes(state[id].status);
  // 解锁状态：全部前置均已掌握；不可信节点不参与结论。
  KNOWLEDGE.forEach(k => {
    const id = k.id;
    state[id].untrusted = graph.untrustworthy.has(id);
    if (state[id].untrusted) { state[id].unlocked = false; state[id].missingPrereqs = []; return; }
    const missing = k.prereqs.filter(p => map[p] && !isMastered(p));
    state[id].missingPrereqs = missing;
    state[id].unlocked = missing.length === 0;
  });
  return { state, order: topoOrder(graph), graph, conflicts };
}

// 增量重推：掌握判定变化只影响其祖先（推断掌握方向）与后继（解锁方向），
// 因此仅重推该子集，其余节点沿用上次结果；随后与整体重推比对，保证一致。
function incrementalRecompute(learnerId, overrides, changedKp, prevResult) {
  const affected = new Set([...descendantsOf([changedKp]), ...ancestorsOf(changedKp)]);
  const full = deriveState(learnerId, overrides);
  const scoped = {};
  Object.keys(full.state).forEach(id => {
    scoped[id] = affected.has(id) ? full.state[id] : prevResult.state[id];
  });
  const consistent = Object.keys(full.state).every(id =>
    JSON.stringify(scoped[id]) === JSON.stringify(full.state[id]));
  return { result: full, scoped, affected, consistent };
}
