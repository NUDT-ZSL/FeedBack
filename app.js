/* 界面与状态层：依赖 scheduler.js 的确定性纯函数核心 */
(function () {
  'use strict';
  const STORE_KEY = 'mpq-state-v1';
  const STATUS_LABEL = { pending: '待调度', scheduled: '已排程', done: '已完成', failed: '失败', blocked: '待重试' };
  const TYPES = ['转码', '剪辑', '字幕', '混流', '压制'];

  let state = load() || null;

  function blankState() { return { assets: [], channels: 3, tasks: [], log: [], seq: 1 }; }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function log(msg) {
    state.log.unshift({ time: new Date().toLocaleTimeString(), msg });
    if (state.log.length > 100) state.log.length = 100;
  }
  function taskById(id) { return state.tasks.find(t => t.id === id); }

  // —— 调度 ——
  function schedulableTasks() {
    return state.tasks.filter(t => t.status === 'pending' || t.status === 'scheduled');
  }
  function fixedSlots() {
    return state.tasks.filter(t => t.status === 'done')
      .map(t => ({ taskId: t.id, channel: t.channel, start: t.start, end: t.end }));
  }
  // 重排：仅未完成任务参与重算，已完成任务槽位保留。
  // 调度核心是同输入必同输出的纯函数，因此重算结果与整批从头调度一致。
  function replan() {
    const errors = Scheduler.validate(state.tasks, state.assets);
    if (errors.length) { showErrors(errors); return false; }
    showErrors([]);
    const plan = Scheduler.schedule(schedulableTasks(), state.channels, fixedSlots());
    const byId = new Map(plan.map(p => [p.taskId, p]));
    for (const t of schedulableTasks()) {
      const p = byId.get(t.id);
      t.channel = p.channel; t.start = p.start; t.end = p.end; t.status = 'scheduled';
    }
    return true;
  }

  function markDone(id) {
    const t = taskById(id);
    if (!t || t.status !== 'scheduled') return;
    t.status = 'done';
    log('任务 ' + t.id + ' 完成，通道 ' + (t.channel + 1) + ' 的 [' + t.start + '-' + t.end + '] 槽位释放');
    replan(); render();
  }

  function markFailed(id) {
    const t = taskById(id);
    if (!t || (t.status !== 'scheduled' && t.status !== 'pending')) return;
    t.status = 'failed'; t.channel = t.start = t.end = null;
    const affected = Scheduler.downstreamClosure(state.tasks, [id]);
    const names = [];
    for (const o of state.tasks) {
      if (affected.has(o.id) && (o.status === 'scheduled' || o.status === 'pending')) {
        o.status = 'blocked'; o.channel = o.start = o.end = null; names.push(o.id);
      }
    }
    log('任务 ' + id + ' 失败；按依赖关系推出下游 ' + names.length + ' 项标记为待重试' + (names.length ? ': ' + names.join(', ') : ''));
    replan(); render();
  }

  function retry(srcIds) {
    const src = srcIds && srcIds.length ? srcIds : state.tasks.filter(t => t.status === 'failed').map(t => t.id);
    if (!src.length) return;
    const closure = Scheduler.downstreamClosure(state.tasks, src);
    let n = 0;
    for (const t of state.tasks) {
      if ((src.includes(t.id) && t.status === 'failed') || (closure.has(t.id) && t.status === 'blocked')) {
        t.status = 'pending'; n++;
      }
    }
    log('重试 ' + n + ' 项任务（' + src.join(', ') + ' 及其下游），仅受影响任务参与重算');
    if (replan()) log('重排完成；与整批从头调度结果一致（可点「一致性校验」核对）');
    render();
  }

  function setPriority(id, value) {
    const t = taskById(id);
    const p = Math.max(1, Math.min(9, parseInt(value, 10) || 1));
    if (!t || t.priority === p) return;
    t.priority = p;
    log('任务 ' + id + ' 优先级调整为 ' + p + '，重算受影响安排');
    replan(); render();
  }

  function removeTask(id) {
    const dependents = state.tasks.filter(t => t.deps.includes(id) && t.status !== 'done');
    if (dependents.length) {
      log('无法删除 ' + id + '：仍被 ' + dependents.map(t => t.id).join(', ') + ' 依赖');
      render(); return;
    }
    state.tasks = state.tasks.filter(t => t.id !== id);
    log('已删除任务 ' + id);
    replan(); render();
  }

  // 一致性校验：当前安排 vs 整批从头调度（所有未完成任务重新参与、仅保留已完成槽位）
  function consistencyCheck() {
    const errors = Scheduler.validate(state.tasks, state.assets);
    if (errors.length) { showErrors(errors); return; }
    const fresh = Scheduler.schedule(schedulableTasks(), state.channels, fixedSlots());
    const byId = new Map(fresh.map(p => [p.taskId, p]));
    const diffs = [];
    for (const t of schedulableTasks()) {
      const p = byId.get(t.id);
      if (t.channel !== p.channel || t.start !== p.start || t.end !== p.end) {
        diffs.push(t.id + '(当前 通道' + (t.channel + 1) + ' [' + t.start + '-' + t.end + ']，整批 通道' + (p.channel + 1) + ' [' + p.start + '-' + p.end + '])');
      }
    }
    if (diffs.length) log('一致性校验失败：' + diffs.join('；'));
    else log('一致性校验通过：' + fresh.length + ' 项未完成任务的安排与整批从头调度完全一致');
    render();
  }

  // —— 录入 ——
  function addAsset(id) {
    id = (id || '').trim();
    if (!id || state.assets.includes(id)) return false;
    state.assets.push(id); state.assets.sort();
    log('登记素材 ' + id);
    return true;
  }

  function addTask(spec) {
    if (taskById(spec.id)) { log('任务 ' + spec.id + ' 已存在，未重复录入'); return false; }
    state.tasks.push({
      id: spec.id, assetId: spec.assetId, type: spec.type,
      duration: spec.duration, priority: spec.priority,
      deps: spec.deps.slice(), status: 'pending',
      channel: null, start: null, end: null
    });
    log('录入任务 ' + spec.id + '（' + spec.type + ' / 素材 ' + spec.assetId + ' / 耗时 ' + spec.duration + ' / 优先级 ' + spec.priority + (spec.deps.length ? ' / 依赖 ' + spec.deps.join(',') : '') + '）');
    return true;
  }

  // —— 示例数据 ——
  function loadDemo() {
    state = blankState();
    ['V-101', 'V-102', 'V-103', 'V-104', 'V-105', 'V-106'].forEach(a => state.assets.push(a));
    const rows = [
      ['T01', 'V-101', '转码', 4, 5, []],
      ['T02', 'V-102', '转码', 3, 3, []],
      ['T03', 'V-103', '剪辑', 6, 4, ['T01']],
      ['T04', 'V-104', '字幕', 2, 2, ['T01']],
      ['T05', 'V-105', '混流', 5, 5, ['T03', 'T04']],
      ['T06', 'V-106', '压制', 3, 1, ['T05']],
      ['T07', 'V-101', '剪辑', 4, 3, ['T02']],
      ['T08', 'V-103', '字幕', 2, 4, ['T03']],
      ['T09', 'V-104', '混流', 3, 2, ['T07', 'T08']],
      ['T10', 'V-105', '压制', 2, 1, ['T09']]
    ];
    for (const r of rows) {
      addTask({ id: r[0], assetId: r[1], type: r[2], duration: r[3], priority: r[4], deps: r[5] });
    }
    log('载入示例批次：10 项任务 / 6 个素材 / 3 条通道');
    replan(); render();
  }

  function loadBadDemo() {
    addTask({ id: 'X1', assetId: 'V-101', type: '转码', duration: 2, priority: 3, deps: ['X3'] });
    addTask({ id: 'X2', assetId: 'V-102', type: '剪辑', duration: 2, priority: 3, deps: ['X1'] });
    addTask({ id: 'X3', assetId: 'V-103', type: '字幕', duration: 2, priority: 3, deps: ['X2'] });
    addTask({ id: 'X4', assetId: 'V-999', type: '压制', duration: 2, priority: 3, deps: [] });
    log('载入异常示例：X1/X2/X3 构成循环依赖，X4 引用未登记素材 V-999；调度已被阻止');
    replan(); render();
  }

  // —— 渲染 ——
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function showErrors(errors) {
    const box = el('errors');
    if (!errors.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = '<strong>调度已被阻止，发现 ' + errors.length + ' 个问题：</strong><ul>' +
      errors.map(e => '<li><code>' + esc(e.type) + '</code> ' + esc(e.message) + '</li>').join('') + '</ul>';
  }

  function renderTasks() {
    el('task-rows').innerHTML = state.tasks.map(t => {
      const slot = t.channel === null ? '—' : '通道' + (t.channel + 1) + ' [' + t.start + '–' + t.end + ']';
      const ops = [];
      if (t.status === 'scheduled') {
        ops.push('<button data-act="done" data-id="' + t.id + '">完成</button>');
        ops.push('<button class="danger" data-act="fail" data-id="' + t.id + '">失败</button>');
      }
      if (t.status === 'failed' || t.status === 'blocked') {
        ops.push('<button class="primary" data-act="retry" data-id="' + t.id + '">重试</button>');
      }
      ops.push('<button data-act="remove" data-id="' + t.id + '">删除</button>');
      return '<tr class="st-' + t.status + '"><td>' + esc(t.id) + '</td><td>' + esc(t.assetId) +
        '</td><td>' + esc(t.type) + '</td><td>' + t.duration + '</td><td>' +
        '<input type="number" min="1" max="9" value="' + t.priority + '" data-prio="' + t.id + '" title="修改后自动重算">' +
        '</td><td>' + (t.deps.map(esc).join(', ') || '—') + '</td>' +
        '<td><span class="badge st-' + t.status + '">' + STATUS_LABEL[t.status] + '</span></td>' +
        '<td>' + slot + '</td><td class="ops">' + ops.join('') + '</td></tr>';
    }).join('');
  }

  function renderGantt() {
    const placed = state.tasks.filter(t => t.channel !== null);
    const maxEnd = Math.max(10, ...placed.map(t => t.end));
    let html = '';
    for (let c = 0; c < state.channels; c++) {
      html += '<div class="lane"><span class="lane-label">通道 ' + (c + 1) + '</span><div class="lane-track">';
      for (const t of placed.filter(t => t.channel === c)) {
        const left = t.start / maxEnd * 100;
        const width = (t.end - t.start) / maxEnd * 100;
        html += '<div class="block st-' + t.status + '" style="left:' + left + '%;width:' + width + '%" title="' +
          esc(t.id) + ' ' + esc(t.type) + ' [' + t.start + '-' + t.end + ']">' + esc(t.id) + '</div>';
      }
      html += '</div></div>';
    }
    const step = Math.max(1, Math.ceil(maxEnd / 12));
    html += '<div class="lane"><span class="lane-label"></span><div class="lane-track scale">';
    for (let m = 0; m <= maxEnd; m += step) {
      html += '<span class="tick" style="left:' + (m / maxEnd * 100) + '%">' + m + '</span>';
    }
    html += '</div></div>';
    el('gantt').innerHTML = html;
  }

  function renderFailures() {
    const failed = state.tasks.filter(t => t.status === 'failed');
    const blocked = state.tasks.filter(t => t.status === 'blocked');
    const box = el('failures');
    if (!failed.length && !blocked.length) {
      box.innerHTML = '<p class="muted">当前没有失败或待重试任务。</p>';
      return;
    }
    let html = '';
    if (failed.length) {
      html += '<h4>失败任务</h4>' + failed.map(t =>
        '<div class="fail-item"><span class="badge st-failed">失败</span> ' + esc(t.id) +
        '（' + esc(t.type) + ' / ' + esc(t.assetId) + '）' +
        '<button class="primary" data-act="retry" data-id="' + t.id + '">重试</button></div>').join('');
    }
    if (blocked.length) {
      html += '<h4>受影响的下游（待重试）</h4>' + blocked.map(t =>
        '<div class="fail-item"><span class="badge st-blocked">待重试</span> ' + esc(t.id) +
        '（依赖 ' + t.deps.map(esc).join(', ') + '）</div>').join('');
    }
    html += '<button class="primary" id="retry-all">重试全部失败链</button>';
    box.innerHTML = html;
  }

  function renderStats() {
    const counts = { pending: 0, scheduled: 0, done: 0, failed: 0, blocked: 0 };
    for (const t of state.tasks) counts[t.status]++;
    el('stats').innerHTML = Object.keys(counts).map(k =>
      '<span class="badge st-' + k + '">' + STATUS_LABEL[k] + ' ' + counts[k] + '</span>').join(' ');
  }

  function renderLog() {
    el('log').innerHTML = state.log.map(e =>
      '<div class="log-line"><span class="muted">' + esc(e.time) + '</span> ' + esc(e.msg) + '</div>').join('');
  }

  function renderForm() {
    el('asset-list').textContent = state.assets.join('、') || '（尚未登记素材）';
    el('f-asset').innerHTML = state.assets.map(a => '<option>' + esc(a) + '</option>').join('');
    el('f-deps').innerHTML = state.tasks.map(t =>
      '<label class="dep"><input type="checkbox" value="' + esc(t.id) + '"> ' + esc(t.id) + '</label>').join('') || '<span class="muted">暂无任务</span>';
    el('f-id').value = 'T' + String(state.seq).padStart(2, '0');
    el('channel-count').value = state.channels;
  }

  function render() {
    renderTasks(); renderGantt(); renderFailures(); renderStats(); renderLog(); renderForm();
    save();
  }

  // —— 事件 ——
  function wire() {
    el('task-rows').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'done') markDone(id);
      else if (b.dataset.act === 'fail') markFailed(id);
      else if (b.dataset.act === 'retry') retry([id]);
      else if (b.dataset.act === 'remove') removeTask(id);
    });
    el('task-rows').addEventListener('change', e => {
      if (e.target.dataset.prio) setPriority(e.target.dataset.prio, e.target.value);
    });
    el('failures').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'retry-all') retry(null);
      else if (b.dataset.act === 'retry') retry([b.dataset.id]);
    });
    el('btn-schedule').addEventListener('click', () => {
      if (replan()) log('手动触发重排完成');
      render();
    });
    el('btn-check').addEventListener('click', consistencyCheck);
    el('btn-demo').addEventListener('click', loadDemo);
    el('btn-baddemo').addEventListener('click', loadBadDemo);
    el('btn-clear').addEventListener('click', () => {
      state = blankState(); log('已清空全部数据'); showErrors([]); render();
    });
    el('channel-count').addEventListener('change', e => {
      const n = Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 3));
      state.channels = n;
      log('通道数调整为 ' + n + '，重算安排');
      replan(); render();
    });
    el('asset-form').addEventListener('submit', e => {
      e.preventDefault();
      if (addAsset(el('f-new-asset').value)) { el('f-new-asset').value = ''; render(); }
    });
    el('task-form').addEventListener('submit', e => {
      e.preventDefault();
      const deps = [...el('f-deps').querySelectorAll('input:checked')].map(c => c.value);
      const ok = addTask({
        id: el('f-id').value.trim(),
        assetId: el('f-asset').value,
        type: el('f-type').value,
        duration: Math.max(1, parseInt(el('f-duration').value, 10) || 1),
        priority: Math.max(1, Math.min(9, parseInt(el('f-priority').value, 10) || 3)),
        deps
      });
      if (ok) { state.seq++; replan(); }
      render();
    });
  }

  // —— 启动：首次进入直接载入示例批次并给出可用编排界面 ——
  if (!state) {
    state = blankState();
    loadDemo();
  } else {
    replan();
  }
  wire();
  render();
  // 演示场景参数：?scenario=fail 模拟 T03 失败；?scenario=bad 演示异常批次
  if (typeof location !== 'undefined') {
    const scenario = new URLSearchParams(location.search).get('scenario');
    if (scenario === 'fail') markFailed('T03');
    else if (scenario === 'bad') loadBadDemo();
  }
})();
