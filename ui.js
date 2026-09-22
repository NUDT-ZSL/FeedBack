// ================= 渲染：学习者列表 / 图谱 =================
const STATUS_META = {
  mastered:  { label: '已掌握',   color: '#2e7d32' },
  inferred:  { label: '推断掌握', color: '#8bc34a' },
  unlocked:  { label: '待学习',   color: '#1976d2' },
  locked:    { label: '未解锁',   color: '#9e9e9e' },
  conflict:  { label: '矛盾待裁决', color: '#ef6c00' },
  untrusted: { label: '不可信',   color: '#c62828' },
};

function displayStatus(id) {
  const st = APP.result.state[id];
  if (st.untrusted) return 'untrusted';
  if (st.status === 'conflict') return 'conflict';
  if (st.status === 'mastered') return 'mastered';
  if (st.status === 'inferred') return 'inferred';
  return st.unlocked ? 'unlocked' : 'locked';
}

function renderAll() {
  renderHealth();
  renderLearners();
  renderGraph();
  renderConflicts();
  renderPath();
}

function renderHealth() {
  const g = APP.result.graph;
  const parts = [];
  if (g.cycleNodes.size)
    parts.push('检测到依赖环：' + [...g.cycleNodes].join(' ↔ '));
  if (g.missingEdges.length)
    parts.push('缺失依赖：' + g.missingEdges.map(e => e.from + ' → ' + e.to + '（不存在）').join('；'));
  if (parts.length)
    parts.push('共 ' + g.untrustworthy.size + ' 个知识点的路径结论不可信');
  document.getElementById('graph-health').textContent =
    parts.length ? '⚠ ' + parts.join('；') : '图谱校验通过，无环、无缺失依赖';
}

function renderLearners() {
  const ul = document.getElementById('learner-list');
  ul.innerHTML = '';
  LEARNERS.forEach(l => {
    const li = document.createElement('li');
    li.textContent = l.name + '（' + l.id + '）';
    const n = Object.keys(detectConflicts(l.id)).length;
    if (n) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = n + ' 处矛盾';
      li.appendChild(b);
    }
    if (l.id === APP.learner) li.classList.add('active');
    li.onclick = () => switchLearner(l.id);
    ul.appendChild(li);
  });
}

// 分层布局：按前置链最长路径分层，忽略缺失边与环内边。
function layoutGraph(g) {
  const map = buildIndex();
  const depth = {};
  KNOWLEDGE.forEach(k => { depth[k.id] = 0; });
  for (let i = 0; i < KNOWLEDGE.length; i++) {
    KNOWLEDGE.forEach(k => k.prereqs.forEach(p => {
      if (!map[p]) return;
      if (g.cycleNodes.has(k.id) && g.cycleNodes.has(p)) return;
      if (depth[p] + 1 > depth[k.id]) depth[k.id] = depth[p] + 1;
    }));
  }
  const layers = {};
  KNOWLEDGE.forEach(k => { (layers[depth[k.id]] = layers[depth[k.id]] || []).push(k.id); });
  const pos = {};
  Object.keys(layers).forEach(d => layers[d].forEach((id, i) => {
    pos[id] = { x: 80 + Number(d) * 150, y: 56 + i * 64 };
  }));
  return pos;
}

function renderGraph() {
  const g = APP.result.graph;
  const pos = layoutGraph(g);
  const map = buildIndex();
  const svg = document.getElementById('graph');
  const NS = 'http://www.w3.org/2000/svg';
  const maxX = Math.max(...Object.values(pos).map(p => p.x));
  const maxY = Math.max(...Object.values(pos).map(p => p.y));
  svg.setAttribute('width', maxX + 160);
  svg.setAttribute('height', maxY + 120);
  svg.innerHTML =
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
    'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#b0bec5"/></marker></defs>';
  function line(x1, y1, x2, y2, bad) {
    const e = document.createElementNS(NS, 'line');
    e.setAttribute('x1', x1); e.setAttribute('y1', y1);
    e.setAttribute('x2', x2); e.setAttribute('y2', y2);
    e.setAttribute('class', 'edge' + (bad ? ' bad' : ''));
    if (!bad) e.setAttribute('marker-end', 'url(#arrow)');
    svg.appendChild(e);
  }
  // 依赖边（前置 -> 当前）；缺失依赖画到红色幻影节点。
  KNOWLEDGE.forEach(k => k.prereqs.forEach(p => {
    if (pos[p]) line(pos[p].x, pos[p].y, pos[k.id].x, pos[k.id].y,
      g.cycleNodes.has(p) && g.cycleNodes.has(k.id));
    else {
      const ghost = { x: pos[k.id].x - 150, y: pos[k.id].y + 110 };
      line(ghost.x, ghost.y, pos[k.id].x, pos[k.id].y, true);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', ghost.x - 30); t.setAttribute('y', ghost.y + 4);
      t.setAttribute('fill', '#c62828');
      t.textContent = p + '（缺失）';
      svg.appendChild(t);
    }
  }));
  // 节点
  KNOWLEDGE.forEach(k => {
    const st = displayStatus(k.id);
    const meta = STATUS_META[st];
    const grp = document.createElementNS(NS, 'g');
    grp.setAttribute('class', 'node');
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', pos[k.id].x - 52); rect.setAttribute('y', pos[k.id].y - 20);
    rect.setAttribute('width', 104); rect.setAttribute('height', 40);
    rect.setAttribute('rx', 8);
    rect.setAttribute('fill', meta.color);
    rect.setAttribute('opacity', st === 'locked' ? 0.55 : 0.92);
    const t1 = document.createElementNS(NS, 'text');
    t1.setAttribute('x', pos[k.id].x); t1.setAttribute('y', pos[k.id].y - 2);
    t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('fill', '#fff');
    t1.textContent = k.id + ' ' + k.name;
    const t2 = document.createElementNS(NS, 'text');
    t2.setAttribute('x', pos[k.id].x); t2.setAttribute('y', pos[k.id].y + 13);
    t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('fill', '#fff');
    t2.textContent = meta.label;
    grp.appendChild(rect); grp.appendChild(t1); grp.appendChild(t2);
    grp.addEventListener('click', ev => openNodeMenu(k.id, ev));
    svg.appendChild(grp);
  });
}
