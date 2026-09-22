// ================= 图谱校验与作答记录整理 =================
function buildIndex() {
  const map = {};
  KNOWLEDGE.forEach(k => { map[k.id] = k; });
  return map;
}

function nameOf(id) {
  const k = buildIndex()[id];
  return k ? k.name : id;
}

// kp -> 依赖它的后继知识点
function childrenMap() {
  const children = {};
  KNOWLEDGE.forEach(k => { children[k.id] = []; });
  KNOWLEDGE.forEach(k => k.prereqs.forEach(p => {
    if (children[p]) children[p].push(k.id);
  }));
  return children;
}

// 沿"被依赖"方向可达的全部后继（含起点自身）
function descendantsOf(startIds) {
  const children = childrenMap();
  const seen = new Set(startIds);
  const stack = [...startIds];
  while (stack.length) {
    const cur = stack.pop();
    (children[cur] || []).forEach(n => {
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    });
  }
  return seen;
}

// 沿"前置"方向可达的全部祖先（含起点自身），忽略缺失节点与环
function ancestorsOf(startId) {
  const map = buildIndex();
  const seen = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    (map[cur].prereqs || []).forEach(p => {
      if (map[p] && !seen.has(p)) { seen.add(p); stack.push(p); }
    });
  }
  return seen;
}

// 校验图谱：识别依赖环（Tarjan SCC）与指向缺失知识点的依赖。
// 受影响（环上/缺失依赖及其全部后继）的路径结论标为不可信。
function validateGraph() {
  const map = buildIndex();
  const missingEdges = [];
  KNOWLEDGE.forEach(k => k.prereqs.forEach(p => {
    if (!map[p]) missingEdges.push({ from: k.id, to: p });
  }));
  const index = {}, low = {}, onStack = {}, stack = [];
  let counter = 0;
  const cycleNodes = new Set();
  function strongconnect(v) {
    index[v] = low[v] = counter++;
    stack.push(v); onStack[v] = true;
    (map[v].prereqs || []).forEach(w => {
      if (!map[w]) return;
      if (index[w] === undefined) { strongconnect(w); low[v] = Math.min(low[v], low[w]); }
      else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    });
    if (low[v] === index[v]) {
      const scc = []; let w;
      do { w = stack.pop(); onStack[w] = false; scc.push(w); } while (w !== v);
      if (scc.length > 1 || map[scc[0]].prereqs.includes(scc[0]))
        scc.forEach(n => cycleNodes.add(n));
    }
  }
  KNOWLEDGE.forEach(k => { if (index[k.id] === undefined) strongconnect(k.id); });
  const taintRoots = new Set([...cycleNodes, ...missingEdges.map(e => e.from)]);
  const untrustworthy = descendantsOf([...taintRoots]);
  return { cycleNodes, missingEdges, untrustworthy };
}

// 整理某学习者的作答记录：完全重复（同知识点/时刻/判定/来源）只保留一条，
// 按时刻升序排列（原始文件可能倒序，绝不按文件顺序取"最新"）。
function learnerRecords(learnerId) {
  const byKp = {};
  RECORDS.filter(r => r.learner === learnerId).forEach(r => {
    const list = byKp[r.kp] = byKp[r.kp] || [];
    if (!list.some(x => x.ts === r.ts && x.verdict === r.verdict && x.source === r.source))
      list.push(r);
  });
  Object.values(byKp).forEach(list => list.sort((a, b) => a.ts < b.ts ? -1 : 1));
  return byKp;
}

// 识别互相矛盾的掌握判定：
// “未掌握 -> 掌握”属于正常进步，按时刻取最新即可；
// “掌握之后又判未掌握”（回退）或同一时刻判定不一致，视为矛盾，
// 保留双方全部来源，等待用户在界面上裁决。
function detectConflicts(learnerId) {
  const byKp = learnerRecords(learnerId);
  const conflicts = {};
  Object.keys(byKp).forEach(kp => {
    const list = byKp[kp];
    if (new Set(list.map(r => r.verdict)).size < 2) return;
    let seenMastered = false, regression = false;
    list.forEach(r => {
      if (r.verdict === 'mastered') seenMastered = true;
      else if (seenMastered) regression = true;
    });
    const lastTs = list[list.length - 1].ts;
    const latestVerdicts = new Set(list.filter(r => r.ts === lastTs).map(r => r.verdict));
    if (regression || latestVerdicts.size > 1) conflicts[kp] = { records: list };
  });
  return conflicts;
}
