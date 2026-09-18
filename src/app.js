// 专注会话恢复工作台 —— 界面层
// 所有推导均委托给 src/engine.js（window.FocusEngine）的纯函数；本文件只负责状态、渲染与交互。
(() => {
'use strict';

const { REPORT_STATUS, recompute, backfillReport, validateStages } = globalThis.FocusEngine;

const STORAGE_KEY = 'focus-recovery-workbench-v1';

let uidSeq = 1;
const nextUid = () => `r${uidSeq++}`;

// ---------------------------------------------------------------------------
// 示例数据：覆盖归并、冲突、越界裁剪、已消解等典型情形
// ---------------------------------------------------------------------------
function seedState() {
  return {
    session: { name: '数据迁移演练 · 专注会话', startMin: 0, nowMin: 240 },
    stages: [
      { id: 's1', order: 1, name: '需求梳理', budgetMin: 45 },
      { id: 's2', order: 2, name: '编码实现', budgetMin: 90 },
      { id: 's3', order: 3, name: '自测验证', budgetMin: 60 },
      { id: 's4', order: 4, name: '文档整理', budgetMin: 30 },
      { id: 's5', order: 5, name: '复盘', budgetMin: 15 },
    ],
    reports: [
      { uid: nextUid(), id: 'intr-1', source: '手动记录', start: 20, end: 35, status: 'active' },
      { uid: nextUid(), id: 'intr-2', source: '应用监控', start: 70, end: 90, status: 'active' },
      { uid: nextUid(), id: 'intr-3', source: '日历同步', start: 85, end: 100, status: 'active' },
      { uid: nextUid(), id: 'intr-4', source: '应用监控', start: 150, end: 170, status: 'active' },
      { uid: nextUid(), id: 'intr-4', source: '日历同步', start: 155, end: 165, status: 'resolved' },
      { uid: nextUid(), id: 'intr-5', source: '手动记录', start: 300, end: 320, status: 'active' },
      { uid: nextUid(), id: 'intr-6', source: '应用监控', start: 200, end: 210, status: 'resolved' },
    ],
    log: [],
  };
}

let state = loadState();
let logSeq = state.log.length;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.session && Array.isArray(parsed.stages) && Array.isArray(parsed.reports)) {
        const maxUid = parsed.reports.reduce((m, r) => {
          const hit = /^r(\d+)$/.exec((r && r.uid) || '');
          return hit ? Math.max(m, Number(hit[1])) : m;
        }, 0);
        uidSeq = maxUid + 1;
        return { log: [], ...parsed };
      }
    }
  } catch { /* 损坏数据则回落到示例 */ }
  return seedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// 事件日志
// ---------------------------------------------------------------------------
function addLog(kind, text) {
  state.log.unshift({ seq: ++logSeq, kind, text });
  if (state.log.length > 200) state.log.length = 200;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtRange = (s, e) => `T+${fmt(s)} ~ T+${fmt(e)}（${fmt(e - s)} 分钟）`;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------
function render() {
  const { session, stages, reports } = state;
  const result = recompute(session, stages, reports);

  $('#session-meta').textContent =
    `${session.name} · 会话墙钟区间 [T+${fmt(session.startMin)}, T+${fmt(session.nowMin)}) · ` +
    `共 ${stages.length} 个阶段 / ${reports.length} 份打断报告`;

  renderResume(result);
  renderTimeline(result);
  renderStageTable(result);
  renderNetList(result);
  renderInterruptions(result);
  renderLog();
  fillSessionForm();
  renderStageEditor();
}

function renderResume({ derivation, conflicts, stageErrors }) {
  const banner = $('#resume-banner');
  banner.className = 'resume-banner';
  if (stageErrors.length > 0 || !derivation) {
    banner.classList.add('blocked');
    banner.textContent = `阶段设置存在 ${stageErrors.length} 处错误，修正后才能推导恢复位置。`;
    return;
  }
  if (!derivation.resume) {
    banner.classList.add('done');
    banner.textContent = `全部阶段已完成：累计计入 ${fmt(derivation.totalWorkMin)} 分钟工作。`;
    return;
  }
  if (conflicts.length > 0) banner.classList.add('blocked');
  const r = derivation.resume;
  banner.textContent =
    `继续进入：第 ${r.order} 阶段「${r.stageName}」—— 该阶段已计入 ${fmt(r.offsetMin)} 分钟，剩余额度 ${fmt(r.remainingMin)} 分钟，` +
    `从该阶段第 ${fmt(r.offsetMin)} 分钟处继续。` +
    (conflicts.length > 0 ? `（注意：${conflicts.length} 个打断存在冲突，未纳入本次推导）` : '');
}

function renderTimeline({ derivation, net, conflicts, stageErrors }) {
  const box = $('#timeline');
  box.innerHTML = '';
  if (stageErrors.length > 0 || !derivation) {
    box.appendChild(el('p', 'empty', '阶段设置有误，时间线暂不可用。'));
    return;
  }
  const S = state.session.startMin;
  const N = state.session.nowMin;
  const endOfAll = Math.max(
    N,
    S + 1,
    ...net.map((iv) => iv.end),
    ...derivation.rows.map((r) => r.wallEnd),
    ...conflicts.flatMap((c) => c.parties.map((p) => p.end)),
  );
  const span = endOfAll - S;
  const pct = (t) => `${(((t - S) / span) * 100).toFixed(3)}%`;
  const place = (bar, s, e) => {
    bar.style.left = pct(s);
    bar.style.width = `calc(${pct(e)} - ${pct(s)})`;
  };

  const inner = el('div', 'tl-inner');

  // 净打断行（含冲突报告区间标记）
  const netRow = el('div', 'tl-row');
  netRow.appendChild(el('div', 'tl-label', '净打断区间'));
  const netTrack = el('div', 'tl-track');
  for (const iv of net) {
    const bar = el('div', 'tl-bar tl-net');
    place(bar, iv.start, iv.end);
    bar.title = `${fmtRange(iv.start, iv.end)} 来源：${iv.refs.map((r) => `${r.id}@${r.source}`).join('、')}`;
    netTrack.appendChild(bar);
  }
  for (const c of conflicts) {
    for (const p of c.parties) {
      const bar = el('div', 'tl-bar tl-conflict');
      place(bar, p.start, p.end);
      bar.title = `冲突 ${c.id}：来源「${p.source}」报 ${fmtRange(p.start, p.end)}`;
      netTrack.appendChild(bar);
    }
  }
  netRow.appendChild(netTrack);
  inner.appendChild(netRow);

  // 各阶段行
  for (const row of derivation.rows) {
    const line = el('div', 'tl-row');
    line.appendChild(el('div', 'tl-label', `${row.order}. ${row.name}`));
    const track = el('div', 'tl-track');
    if (row.countedMin > 0) {
      const bar = el('div', 'tl-bar tl-counted');
      place(bar, row.wallStart, row.countedWallEnd);
      bar.title = `已计入 ${fmt(row.countedMin)} 分钟`;
      track.appendChild(bar);
    }
    if (row.remainingMin > 0) {
      const bar = el('div', 'tl-bar tl-remaining');
      place(bar, row.countedWallEnd, row.wallEnd);
      bar.title = `剩余 ${fmt(row.remainingMin)} 分钟`;
      track.appendChild(bar);
    }
    line.appendChild(track);
    inner.appendChild(line);
  }

  // 当前时刻竖线（画在每一行）
  for (const track of inner.querySelectorAll('.tl-track')) {
    const now = el('div', 'tl-now');
    now.style.left = pct(N);
    track.appendChild(now);
  }

  // 刻度轴
  const axis = el('div', 'tl-axis');
  const step = niceStep(span);
  for (let t = Math.ceil(S / step) * step; t <= endOfAll; t += step) {
    const tick = el('span', 'tl-tick', `T+${fmt(t)}`);
    tick.style.left = pct(t);
    axis.appendChild(tick);
  }
  inner.appendChild(axis);

  box.appendChild(inner);
}

function niceStep(span) {
  const candidates = [15, 30, 60, 120, 240, 480];
  for (const c of candidates) if (span / c <= 10) return c;
  return 720;
}

function renderStageTable({ derivation, stageErrors }) {
  const tbody = $('#stage-result-table tbody');
  tbody.innerHTML = '';
  const badge = $('#conservation-badge');
  if (stageErrors.length > 0 || !derivation) {
    badge.textContent = '推导被阻断';
    badge.className = 'badge bad';
    return;
  }
  badge.textContent = derivation.conservationOk ? '守恒校验通过：计入 + 剩余 = 预算' : '守恒校验失败';
  badge.className = derivation.conservationOk ? 'badge' : 'badge bad';
  const statusText = { done: '已完成', active: '进行中', pending: '未开始' };
  for (const row of derivation.rows) {
    const tr = el('tr');
    tr.append(
      el('td', null, String(row.order)),
      el('td', null, row.name),
      el('td'),
      el('td', null, `${fmt(row.budgetMin)} 分钟`),
      el('td', null, `${fmt(row.countedMin)} 分钟`),
      el('td', null, `${fmt(row.remainingMin)} 分钟`),
      el('td', null, `T+${fmt(row.wallStart)} ~ T+${fmt(row.wallEnd)}`),
    );
    const st = el('span', `st st-${row.status}`, statusText[row.status]);
    tr.children[2].appendChild(st);
    tbody.appendChild(tr);
  }
}

function renderNetList({ net, clipNotes }) {
  const box = $('#net-list');
  box.innerHTML = '';
  if (net.length === 0) {
    box.appendChild(el('p', 'empty', '当前没有净打断区间。'));
  }
  net.forEach((iv, i) => {
    const item = el('div', 'net-item');
    item.textContent = `#${i + 1} ${fmtRange(iv.start, iv.end)} · 来源：${iv.refs.map((r) => `${r.id}@${r.source}`).join('、')}`;
    box.appendChild(item);
  });
  for (const note of clipNotes) {
    box.appendChild(el('div', 'net-item mini', `✂ ${note.message}`));
  }
}

function renderInterruptions({ groups }) {
  const box = $('#interruption-list');
  box.innerHTML = '';
  if (groups.length === 0) {
    box.appendChild(el('p', 'empty', '暂无打断报告。'));
    return;
  }
  for (const g of groups) {
    const card = el('div', `intr-group${g.conflict ? ' conflicted' : ''}`);
    const head = el('div', 'intr-head');
    head.appendChild(el('span', 'intr-title', `打断「${g.id}」`));
    const headRight = el('span');
    if (g.conflict) {
      headRight.appendChild(el('span', 'conflict-tag', '⚠ 冲突：双方已保留，未纳入推导'));
    } else if (g.effective) {
      const eff = g.effective;
      headRight.appendChild(
        el(
          'span',
          'mini',
          eff.status === REPORT_STATUS.ACTIVE
            ? `生效区间 ${fmtRange(eff.start, eff.end)}（未消解）`
            : '已消解，不计入打断',
        ),
      );
      if (g.hadConflict) headRight.appendChild(el('span', 'mini', ' · 冲突已人工消解'));
    }
    head.appendChild(headRight);
    card.appendChild(head);

    if (g.conflict) card.appendChild(el('p', 'conflict-msg', g.conflict.message));

    const anyAdopted = g.reports.some((r) => r.adopted);
    for (const rep of g.reports) {
      const row = el(
        'div',
        `report-row${rep.adopted ? ' adopted' : ''}${anyAdopted && !rep.adopted ? ' superseded' : ''}`,
      );
      row.appendChild(el('span', 'src', rep.source));
      row.appendChild(
        el(
          'span',
          null,
          `${fmtRange(rep.start, rep.end)} · ${rep.status === REPORT_STATUS.ACTIVE ? '未消解' : '已消解'}${rep.adopted ? ' · 已采纳' : ''}`,
        ),
      );
      if (g.conflict) {
        const adoptBtn = el('button', 'btn btn-sm', '采纳此来源');
        adoptBtn.type = 'button';
        adoptBtn.addEventListener('click', () => resolveConflict(g.id, rep.uid));
        row.appendChild(adoptBtn);
      }
      const toggleBtn = el(
        'button',
        'btn btn-ghost btn-sm',
        rep.status === REPORT_STATUS.ACTIVE ? '标记已消解' : '标记未消解',
      );
      toggleBtn.type = 'button';
      toggleBtn.addEventListener('click', () => toggleReportStatus(rep.uid));
      row.appendChild(toggleBtn);
      const delBtn = el('button', 'btn btn-danger btn-sm', '删除');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => deleteReport(rep.uid));
      row.appendChild(delBtn);
      card.appendChild(row);
    }
    box.appendChild(card);
  }
}

function renderLog() {
  const list = $('#event-log');
  list.innerHTML = '';
  if (state.log.length === 0) {
    list.appendChild(el('li', 'info', '暂无事件。补报打断、修改阶段或消解冲突后，结果会记录在这里。'));
    return;
  }
  for (const entry of state.log) {
    list.appendChild(el('li', entry.kind, `#${entry.seq} ${entry.text}`));
  }
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------
function fillSessionForm() {
  $('#inp-session-name').value = state.session.name;
  $('#inp-session-start').value = state.session.startMin;
  $('#inp-session-now').value = state.session.nowMin;
}

function renderStageEditor() {
  const tbody = $('#stage-edit-table tbody');
  tbody.innerHTML = '';
  state.stages.forEach((st, idx) => {
    const tr = el('tr');

    const tdOrder = el('td');
    const inpOrder = el('input');
    inpOrder.type = 'number';
    inpOrder.value = st.order;
    inpOrder.dataset.idx = idx;
    inpOrder.dataset.field = 'order';
    tdOrder.appendChild(inpOrder);

    const tdName = el('td');
    const inpName = el('input');
    inpName.type = 'text';
    inpName.value = st.name;
    inpName.dataset.idx = idx;
    inpName.dataset.field = 'name';
    tdName.appendChild(inpName);

    const tdBudget = el('td');
    const inpBudget = el('input');
    inpBudget.type = 'number';
    inpBudget.step = '1';
    inpBudget.value = st.budgetMin;
    inpBudget.dataset.idx = idx;
    inpBudget.dataset.field = 'budgetMin';
    tdBudget.appendChild(inpBudget);

    const tdDel = el('td');
    const delBtn = el('button', 'btn btn-danger btn-sm', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => {
      state.stages.splice(idx, 1);
      addLog('info', `已删除阶段「${st.name}」（原顺序 ${st.order}）`);
      commit();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdOrder, tdName, tdBudget, tdDel);
    tbody.appendChild(tr);
  });
}

function readStageEditor() {
  const rows = state.stages.map((st) => ({ ...st }));
  for (const inp of document.querySelectorAll('#stage-edit-table input')) {
    const idx = Number(inp.dataset.idx);
    const field = inp.dataset.field;
    if (!rows[idx]) continue;
    if (field === 'name') rows[idx].name = inp.value.trim();
    else rows[idx][field] = inp.value === '' ? NaN : Number(inp.value);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 变更操作
// ---------------------------------------------------------------------------
function commit() {
  saveState();
  render();
}

function applySession() {
  const name = $('#inp-session-name').value.trim() || '未命名会话';
  const startMin = Number($('#inp-session-start').value);
  const nowMin = Number($('#inp-session-now').value);
  if (!Number.isFinite(startMin) || !Number.isFinite(nowMin) || nowMin <= startMin) {
    addLog('reject', `拒绝会话设置：当前时刻（T+${$('#inp-session-now').value}）必须大于开始时刻（T+${$('#inp-session-start').value}）。`);
    commit();
    return;
  }
  state.session = { name, startMin, nowMin };
  addLog('ok', `会话设置已更新：墙钟区间 [T+${fmt(startMin)}, T+${fmt(nowMin)})。`);
  commit();
}

function applyStages() {
  const next = readStageEditor();
  const errors = validateStages(next);
  if (errors.length > 0) {
    for (const e of errors) addLog('reject', `拒绝阶段设置：${e.reason}`);
    commit(); // 状态未变，仅刷新日志
    return;
  }
  state.stages = next;
  addLog('ok', `阶段设置已应用：${next.length} 个阶段，总预算 ${fmt(next.reduce((s, x) => s + x.budgetMin, 0))} 分钟。`);
  commit();
}

function addStage() {
  const maxOrder = state.stages.reduce((m, s) => Math.max(m, s.order), 0);
  state.stages.push({ id: `s${Date.now().toString(36)}`, order: maxOrder + 1, name: `新阶段 ${maxOrder + 1}`, budgetMin: 30 });
  commit();
}

function submitReport() {
  const rep = {
    uid: nextUid(),
    id: $('#inp-rep-id').value.trim(),
    source: $('#inp-rep-source').value.trim(),
    start: Number($('#inp-rep-start').value),
    end: Number($('#inp-rep-end').value),
    status: $('#inp-rep-status').value,
  };
  const outcome = backfillReport(state.session, state.stages, state.reports, rep);
  if (!outcome.ok) {
    addLog('reject', `拒绝补报：${outcome.reason}`);
    commit();
    return;
  }
  state.reports.push(rep);
  logBackfill(rep, outcome);
  commit();
}

function logBackfill(rep, { after, newNetParts, droppedNetParts, diff }) {
  const lines = [];
  lines.push(
    `已补报打断「${rep.id}」（来源 ${rep.source}）区间 [${fmt(rep.start)}, ${fmt(rep.end)})、` +
      `${rep.status === REPORT_STATUS.ACTIVE ? '未消解' : '已消解'}。`,
  );
  for (const note of after.clipNotes.filter((n) => n.id === rep.id && n.source === rep.source)) {
    lines.push(`✂ ${note.message}`);
  }
  for (const part of newNetParts) {
    lines.push(`净打断新增 [${fmt(part.start)}, ${fmt(part.end)})（${fmt(part.end - part.start)} 分钟）。`);
  }
  for (const part of droppedNetParts) {
    lines.push(`净打断移除 [${fmt(part.start)}, ${fmt(part.end)})（与既有报告冲突，暂被排除）。`);
  }
  if (diff) {
    for (const d of diff.deductions) {
      lines.push(
        `扣减：阶段「${d.name}」重复计入 ${fmt(d.amountMin)} 分钟已扣掉` +
          `（来源：打断「${rep.id}」@${rep.source} 的净区间与已计入片段交叠，同一时刻不计两次）。`,
      );
    }
    for (const r of diff.restored) {
      lines.push(`回补：阶段「${r.name}」计入增加 ${fmt(r.amountMin)} 分钟。`);
    }
    for (const s of diff.shifted) {
      lines.push(`平移：阶段「${s.name}」墙钟起点后移 ${fmt(s.shiftMin)} 分钟。`);
    }
    lines.push(`未受影响阶段 ${diff.unaffected.length} 个，其结果保持不变。`);
  }
  const newConflicts = after.conflicts.filter((c) => c.id === rep.id);
  for (const c of newConflicts) {
    lines.push(`⚠ ${c.message}`);
  }
  addLog(newNetParts.length > 0 || (diff && diff.deductions.length > 0) ? 'deduct' : 'ok', lines.join('\n'));
  for (const c of newConflicts) {
    addLog('conflict', c.message);
  }
}

function resolveConflict(id, chosenUid) {
  const before = recompute(state.session, state.stages, state.reports);
  for (const rep of state.reports) {
    if (rep.id === id) rep.adopted = rep.uid === chosenUid;
  }
  const chosen = state.reports.find((r) => r.uid === chosenUid);
  const after = recompute(state.session, state.stages, state.reports);
  addLog(
    'ok',
    `冲突消解：打断「${id}」采纳来源「${chosen.source}」的区间 [${fmt(chosen.start)}, ${fmt(chosen.end)})、` +
      `${chosen.status === REPORT_STATUS.ACTIVE ? '未消解' : '已消解'}；其余来源保留为未采纳。`,
  );
  logDiff('冲突消解', before, after);
  commit();
}

function toggleReportStatus(uid) {
  const before = recompute(state.session, state.stages, state.reports);
  const rep = state.reports.find((r) => r.uid === uid);
  if (!rep) return;
  rep.status = rep.status === REPORT_STATUS.ACTIVE ? REPORT_STATUS.RESOLVED : REPORT_STATUS.ACTIVE;
  rep.adopted = false;
  addLog(
    'info',
    `打断「${rep.id}」（来源 ${rep.source}）已标记为${rep.status === REPORT_STATUS.ACTIVE ? '未消解' : '已消解'}。`,
  );
  const after = recompute(state.session, state.stages, state.reports);
  logDiff('状态变更', before, after);
  commit();
}

function deleteReport(uid) {
  const before = recompute(state.session, state.stages, state.reports);
  const idx = state.reports.findIndex((r) => r.uid === uid);
  if (idx < 0) return;
  const [rep] = state.reports.splice(idx, 1);
  addLog('info', `已删除打断「${rep.id}」来源「${rep.source}」的报告。`);
  const after = recompute(state.session, state.stages, state.reports);
  logDiff('删除报告', before, after);
  commit();
}

function logDiff(cause, before, after) {
  if (!before.derivation || !after.derivation) return;
  const lines = [];
  const beforeById = new Map(before.derivation.rows.map((r) => [r.id, r]));
  for (const row of after.derivation.rows) {
    const b = beforeById.get(row.id);
    if (!b) continue;
    const d = row.countedMin - b.countedMin;
    if (d < -1e-9) lines.push(`扣减：阶段「${row.name}」计入减少 ${fmt(-d)} 分钟。`);
    else if (d > 1e-9) lines.push(`回补：阶段「${row.name}」计入增加 ${fmt(d)} 分钟。`);
  }
  if (lines.length > 0) addLog('deduct', `${cause}导致重推：\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------
$('#btn-apply-session').addEventListener('click', applySession);
$('#btn-apply-stages').addEventListener('click', applyStages);
$('#btn-add-stage').addEventListener('click', addStage);
$('#btn-add-report').addEventListener('click', submitReport);
$('#btn-clear-log').addEventListener('click', () => {
  state.log = [];
  commit();
});
$('#btn-reset').addEventListener('click', () => {
  state = seedState();
  addLog('info', '已恢复示例数据。');
  commit();
});

render();
})();
