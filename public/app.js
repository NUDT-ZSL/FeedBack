/* 离线工单同步台：本地队列 + 顺序提交 + 逐字段对账合并 */
const FIELDS = [
  { key: 'title', label: '标题' },
  { key: 'body', label: '正文' },
  { key: 'assignee', label: '负责人' }
];
const FIELD_LABEL = { title: '标题', body: '正文', assignee: '负责人' };

const store = {
  online: true,
  server: {},    // id -> 最近一次与服务端确认一致的工单快照
  local: {},     // id -> 本地草稿 {title, body, assignee}
  ops: [],       // 待同步操作队列：{seq, woId, field, oldValue, newValue, ts}
  conflicts: {}, // id -> [{field, baseValue, localValue, serverValue}]
  seq: 0,
  selected: null,
  log: []
};

function persist() {
  localStorage.setItem('wo-demo', JSON.stringify({
    server: store.server, local: store.local, ops: store.ops,
    seq: store.seq, selected: store.selected
  }));
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('wo-demo'));
    if (s) Object.assign(store, {
      server: s.server || {}, local: s.local || {}, ops: s.ops || [],
      seq: s.seq || 0, selected: s.selected || null
    });
  } catch (e) { /* 忽略损坏的本地缓存 */ }
}

class OfflineError extends Error {}

async function api(path, options = {}) {
  if (!store.online) throw new OfflineError('当前处于离线状态');
  let res;
  try {
    res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  } catch (e) {
    setOnline(false, '网络请求失败，已自动切换为离线');
    throw new OfflineError('网络不可达');
  }
  if (!res.ok) throw new Error('服务端错误 ' + res.status);
  return res.json();
}

function setOnline(v, msg) {
  if (store.online === v) return;
  store.online = v;
  addLog(msg || (v ? '连接已恢复，可以同步' : '已断开连接，修改将暂存本地'), v ? 'ok' : 'warn');
  render();
}

function addLog(text, kind = 'info') {
  store.log.unshift({ text, kind, ts: new Date().toLocaleTimeString() });
  if (store.log.length > 80) store.log.pop();
  renderLog();
}

function localOf(id) {
  if (!store.local[id]) {
    const s = store.server[id];
    store.local[id] = { title: s.title, body: s.body, assignee: s.assignee };
  }
  return store.local[id];
}

// 每次编辑都记录一条操作：顺序号、目标字段、旧值、新值
function onEdit(id, field, value) {
  const draft = localOf(id);
  if (draft[field] === value) return;
  store.ops.push({ seq: ++store.seq, woId: id, field, oldValue: draft[field], newValue: value, ts: Date.now() });
  draft[field] = value;
  persist();
  renderList();
  renderOps();
  markDirtyFields();
}

function pendingFields(id) {
  const set = new Set();
  for (const op of store.ops) if (op.woId === id) set.add(op.field);
  return set;
}

// 同一字段的多次修改合并为一条“最终意图”：
// baseValue 取首次修改前的值，value 取最后一次修改的值；过程操作保留在 intent.ops 供回看。
function coalesce(id) {
  const byField = {};
  for (const op of store.ops.filter(o => o.woId === id)) {
    if (!byField[op.field]) byField[op.field] = { field: op.field, baseValue: op.oldValue, value: op.newValue, ops: [] };
    byField[op.field].value = op.newValue;
    byField[op.field].ops.push(op);
  }
  return Object.values(byField);
}
// __PART2__

async function syncAll() {
  const ids = [...new Set(store.ops.map(o => o.woId))];
  if (!ids.length) { addLog('没有待同步的本地修改', 'info'); return; }
  for (const id of ids) {
    const intents = coalesce(id);
    let r;
    try {
      r = await api(`/api/workorders/${id}/sync`, {
        method: 'POST',
        body: JSON.stringify({ intents: intents.map(i => ({ field: i.field, baseValue: i.baseValue, value: i.value })) })
      });
    } catch (e) { addLog(`同步 ${id} 失败：${e.message}`, 'err'); continue; }
    const appliedFields = new Set(r.applied.map(a => a.field));
    for (const a of r.applied) {
      addLog(`${id} · ${FIELD_LABEL[a.field]}：${a.note === 'already-same' ? '服务端已是该值，无需变更' : '服务端未变，已安全应用'}`, 'ok');
    }
    store.ops = store.ops.filter(o => !(o.woId === id && appliedFields.has(o.field)));
    if (r.conflicts.length) {
      store.conflicts[id] = r.conflicts;
      for (const c of r.conflicts) addLog(`${id} · ${FIELD_LABEL[c.field]}：冲突！服务端已被改为其它值`, 'err');
    }
    store.server[id] = r.workorder;
    const draft = localOf(id);
    for (const f of appliedFields) draft[f] = r.workorder[f];
  }
  persist();
  render();
}

// 裁决：只提交受影响工单上被裁决的字段，其它已同步结果保持不动
async function submitResolution(id) {
  const conflicts = store.conflicts[id] || [];
  const resolutions = [];
  for (const c of conflicts) {
    const choice = document.querySelector(`input[name="res-${id}-${c.field}"]:checked`);
    if (!choice) { addLog(`请先为 ${id} 的「${FIELD_LABEL[c.field]}」选择裁决方式`, 'warn'); return; }
    let value;
    if (choice.value === 'local') value = c.localValue;
    else if (choice.value === 'server') value = c.serverValue;
    else value = document.getElementById(`manual-${id}-${c.field}`).value;
    resolutions.push({ field: c.field, value });
  }
  let r;
  try {
    r = await api(`/api/workorders/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolutions }) });
  } catch (e) { addLog(`提交裁决失败：${e.message}`, 'err'); return; }
  const fields = resolutions.map(x => x.field);
  store.server[id] = r.workorder;
  const draft = localOf(id);
  for (const f of fields) draft[f] = r.workorder[f];
  store.ops = store.ops.filter(o => !(o.woId === id && fields.includes(o.field)));
  delete store.conflicts[id];
  addLog(`${id}：裁决已提交，仅重算字段 [${fields.map(f => FIELD_LABEL[f]).join('、')}]，版本 → v${r.workorder.version}`, 'ok');
  persist();
  render();
}

async function refresh() {
  try {
    const s = await api('/api/state');
    for (const wo of s.workorders) {
      store.server[wo.id] = wo;
      const dirty = store.ops.some(o => o.woId === wo.id) || store.conflicts[wo.id];
      if (!dirty) store.local[wo.id] = { title: wo.title, body: wo.body, assignee: wo.assignee };
    }
    if (!store.selected && s.workorders.length) store.selected = s.workorders[0].id;
    persist();
    render();
  } catch (e) { /* 离线时保持本地状态 */ }
}

// 演示用：模拟其它终端在服务端直接改了数据，用来制造冲突
async function simulateServerEdit(id) {
  const samples = {
    title: ['（服务端）已加急', '（服务端）标题修订'],
    body: ['服务端补充：现场需携带安全帽。', '服务端更新：作业时间改到下午。'],
    assignee: ['陈晓', '刘洋']
  };
  const field = FIELDS[Math.floor(Math.random() * FIELDS.length)].key;
  const arr = samples[field];
  const value = arr[Math.floor(Math.random() * arr.length)];
  try {
    const r = await api('/api/admin/mutate', { method: 'POST', body: JSON.stringify({ id, field, value }) });
    store.server[id] = r.workorder;
    const dirty = store.ops.some(o => o.woId === id) || store.conflicts[id];
    if (!dirty) store.local[id] = { title: r.workorder.title, body: r.workorder.body, assignee: r.workorder.assignee };
    addLog(`服务端发生外部变更：${id} · ${FIELD_LABEL[field]}（v${r.workorder.version}）`, 'warn');
    persist();
    render();
  } catch (e) { addLog(`模拟服务端变更失败：${e.message}`, 'err'); }
}

async function resetDemo() {
  try { await api('/api/reset', { method: 'POST' }); } catch (e) { /* 离线也允许清本地 */ }
  localStorage.removeItem('wo-demo');
  location.reload();
}
// __PART3__

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectWO(id) { store.selected = id; persist(); render(); }

function render() {
  renderConn(); renderList(); renderEditor(); renderConflicts(); renderOps(); renderLog();
}

function renderConn() {
  document.getElementById('conn').innerHTML = store.online
    ? '<span class="dot on"></span>在线'
    : '<span class="dot off"></span>离线（修改暂存本地）';
  document.getElementById('btn-toggle').textContent = store.online ? '断开连接' : '恢复连接';
}

function sortedWOs() {
  return Object.values(store.server).sort((a, b) => a.id.localeCompare(b.id));
}

function renderList() {
  const el = document.getElementById('list');
  el.innerHTML = '<h3>工单</h3>' + sortedWOs().map(wo => {
    const pend = pendingFields(wo.id).size;
    const conf = (store.conflicts[wo.id] || []).length;
    const badge = conf ? `<span class="badge conflict">冲突 ${conf}</span>`
      : pend ? `<span class="badge pending">待同步 ${pend}</span>`
      : '<span class="badge synced">已同步</span>';
    return `<div class="wo-item ${store.selected === wo.id ? 'sel' : ''}" onclick="selectWO('${wo.id}')">
      <div class="wo-title">${esc(localOf(wo.id).title)}</div>
      <div class="wo-meta">${esc(wo.id)} · v${wo.version} · ${esc(localOf(wo.id).assignee)} ${badge}</div>
      <button class="mini" onclick="event.stopPropagation();simulateServerEdit('${wo.id}')">模拟服务端变更</button>
    </div>`;
  }).join('');
}

function renderEditor() {
  const el = document.getElementById('editor');
  const id = store.selected;
  if (!id || !store.server[id]) { el.innerHTML = '<p class="muted">请选择左侧工单开始编辑</p>'; return; }
  const wo = store.server[id];
  const draft = localOf(id);
  const pend = pendingFields(id);
  const conf = (store.conflicts[id] || []).map(c => c.field);
  const headBadge = conf.length ? '<span class="badge conflict">有冲突待裁决</span>'
    : pend.size ? '<span class="badge pending">待同步</span>'
    : '<span class="badge synced">已同步</span>';
  el.innerHTML = `
    <div class="ed-head"><h2>${esc(id)}</h2><span class="ver">服务端 v${wo.version}</span>${headBadge}</div>
    ${FIELDS.map(f => `
      <label class="fld ${pend.has(f.key) ? 'dirty' : ''}" data-fld="${f.key}">
        <span class="fld-label">${f.label}
          ${conf.includes(f.key) ? '<span class="badge conflict">冲突</span>'
            : pend.has(f.key) ? '<span class="badge pending">待同步</span>' : ''}
        </span>
        ${f.key === 'body'
          ? `<textarea data-field="body" rows="6">${esc(draft.body)}</textarea>`
          : `<input data-field="${f.key}" value="${esc(draft[f.key])}">`}
      </label>`).join('')}
    <p class="muted">离线时可直接编辑，修改会进入右侧待同步队列；恢复连接后点“立即同步”。</p>`;
  el.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('input', () => onEdit(id, inp.dataset.field, inp.value));
  });
}

// 输入过程中只更新字段边框与徽标，不重建输入框以免丢失焦点
function markDirtyFields() {
  const id = store.selected;
  if (!id) return;
  const pend = pendingFields(id);
  document.querySelectorAll('#editor .fld').forEach(f => {
    f.classList.toggle('dirty', pend.has(f.dataset.fld));
  });
}

function renderConflicts() {
  const el = document.getElementById('conflicts');
  const ids = Object.keys(store.conflicts).filter(k => (store.conflicts[k] || []).length);
  if (!ids.length) { el.innerHTML = ''; return; }
  el.innerHTML = ids.map(id => `
    <div class="conflict-card">
      <h3>冲突裁决 · ${esc(id)}</h3>
      ${store.conflicts[id].map(c => `
        <div class="conflict-row">
          <div class="conflict-field">${FIELD_LABEL[c.field]}</div>
          <div class="conflict-cols">
            <div class="col local">
              <h4>本地意图</h4>
              <pre>${esc(c.localValue)}</pre>
              <label><input type="radio" name="res-${id}-${c.field}" value="local"> 保留本地</label>
            </div>
            <div class="col server">
              <h4>服务端当前值</h4>
              <pre>${esc(c.serverValue)}</pre>
              <label><input type="radio" name="res-${id}-${c.field}" value="server"> 保留服务端</label>
            </div>
          </div>
          <div class="manual">
            <label><input type="radio" name="res-${id}-${c.field}" value="manual"> 手工合并为：</label>
            <input id="manual-${id}-${c.field}" placeholder="输入合并后的最终值">
          </div>
        </div>`).join('')}
      <button class="primary" onclick="submitResolution('${id}')">提交裁决（仅重算受影响字段）</button>
    </div>`).join('');
}

function renderOps() {
  const el = document.getElementById('ops');
  const ids = [...new Set(store.ops.map(o => o.woId))];
  if (!ids.length) { el.innerHTML = '<h3>待同步队列</h3><p class="muted">暂无待同步操作</p>'; return; }
  el.innerHTML = '<h3>待同步队列</h3>' + ids.map(id => {
    const intents = coalesce(id);
    return `<div class="ops-wo"><h4>${esc(id)} · ${intents.length} 个字段意图</h4>
      ${intents.map(it => `
        <div class="intent">
          <span class="badge pending">${FIELD_LABEL[it.field]}</span>
          <span class="final">→ ${esc(it.value)}</span>
          ${it.ops.length > 1 ? `<details><summary>过程记录：${it.ops.length} 次修改，仅最终值参与合并</summary>
            <ol>${it.ops.map(o => `<li>#${o.seq} ${new Date(o.ts).toLocaleTimeString()}：${esc(o.oldValue)} → ${esc(o.newValue)}</li>`).join('')}</ol>
          </details>` : `<span class="muted">操作 #${it.ops[0].seq}</span>`}
        </div>`).join('')}
    </div>`;
  }).join('');
}

function renderLog() {
  const el = document.getElementById('log-body');
  if (!el) return;
  el.innerHTML = store.log.map(l =>
    `<div class="entry ${l.kind}"><span class="ts">${l.ts}</span>${esc(l.text)}</div>`
  ).join('');
}

async function boot() {
  restore();
  document.getElementById('btn-toggle').addEventListener('click', async () => {
    if (store.online) { setOnline(false); return; }
    setOnline(true);
    await refresh();
    if (store.ops.length) addLog(`检测到 ${store.ops.length} 条待同步操作，点击“立即同步”提交`, 'warn');
  });
  document.getElementById('btn-sync').addEventListener('click', async () => {
    if (!store.online) { addLog('当前离线，无法同步', 'warn'); return; }
    await syncAll();
  });
  document.getElementById('btn-reset').addEventListener('click', resetDemo);
  render();
  await refresh();
  addLog('已进入工单编辑界面', 'info');
}

boot();
