/* global FocusCore */
(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };

var state = {
  doc: null, model: null, plan: null,
  panel: 'list',          // list | tree | cons
  selEl: null,            // 列表/层级同步选中的元素 id
  selCons: null,          // 约束面板选中的约束 id
  walk: null,             // null 或 { idx }
  listRows: [], treeRows: [], consRows: []
};

function el(id) { return state.model.elements[id]; }
function label(id) { var e = el(id); return e ? e.label : id; }

function say(msg, kind) {
  var bar = $('#statusbar');
  bar.textContent = msg;
  bar.className = kind || '';
}

function reload(doc, keepSel) {
  if (!keepSel) { state.selEl = null; state.selCons = null; }
  if (!Array.isArray(doc.constraints)) doc.constraints = [];
  var seenIds = {};
  doc.constraints.forEach(function (c, i) {
    if (c.id == null || seenIds[String(c.id)]) c.id = 'j' + (i + 1);
    while (seenIds[String(c.id)]) c.id = String(c.id) + '_';
    seenIds[String(c.id)] = 1;
  });
  state.doc = doc;
  state.model = FocusCore.normalize(doc);
  state.plan = FocusCore.computePlan(state.model);
  state.walk = null;
  if (!state.selEl || !state.model.elements[state.selEl]) {
    state.selEl = state.plan.path[0] || state.model.elementIds[0] || null;
  }
  if (state.selCons && !state.doc.constraints.some(function (c) { return String(c.id) === state.selCons; })) {
    state.selCons = null;
  }
  if (!state.selCons && state.doc.constraints.length) {
    state.selCons = String(state.doc.constraints[0].id != null ? state.doc.constraints[0].id : 'j1');
  }
  render();
}

function mutate(fn, msg) {
  fn(state.doc);
  reload(state.doc, true);
  var p = state.plan;
  if (p.problems.length) {
    say(msg + '\n⚠ ' + p.problems.map(function (x) { return x.reason; }).join('\n⚠ '), 'err');
  } else {
    say(msg + '。全部必需元素均可达。', 'ok');
  }
}

/* ---------- 渲染 ---------- */

function render() {
  renderList(); renderTree(); renderCons(); renderBanner();
  ['list', 'tree', 'cons'].forEach(function (name) {
    $('#panel-' + name).classList.toggle('active', state.panel === name);
  });
  restoreFocus();
}

function badge(text, cls) {
  var s = document.createElement('span');
  s.className = 'badge ' + cls; s.textContent = text;
  return s;
}

function renderList() {
  var ul = $('#list-rows'); ul.textContent = '';
  var plan = state.plan, rows = [];
  plan.path.forEach(function (id, i) {
    rows.push({ id: id, pos: i + 1, unreachable: false });
  });
  state.model.elementIds.forEach(function (id) {
    if (!plan.visited[id]) rows.push({ id: id, pos: null, unreachable: true });
  });
  state.listRows = rows;
  rows.forEach(function (row, i) {
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.key = row.id;
    li.tabIndex = (state.panel === 'list' && row.id === state.selEl) ? 0 : -1;
    var pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = row.pos != null ? ('#' + row.pos) : '—';
    li.appendChild(pos);
    var name = document.createElement('span');
    name.textContent = label(row.id) + ' ';
    li.appendChild(name);
    var cid = document.createElement('span');
    cid.className = 'cid'; cid.textContent = row.id;
    li.appendChild(cid);
    if (state.model.elements[row.id].required) li.appendChild(badge('必需', 'req'));
    if (row.id === state.model.initialFocus) li.appendChild(badge('初始', 'init'));
    if (row.unreachable) li.appendChild(badge('不可达', 'unreach'));
    var via = document.createElement('span');
    via.className = 'via';
    if (row.pos != null && row.pos > 1) {
      var prev = plan.path[row.pos - 2];
      var edge = plan.edges[prev];
      via.textContent = edge && edge.via ? ('⇢ 约束 ' + edge.via) : '↦ 默认顺序';
    }
    li.appendChild(via);
    if (state.walk) {
      if (i < state.walk.idx) li.classList.add('walkdone');
      if (i === state.walk.idx) li.classList.add('walkcur');
    }
    ul.appendChild(li);
  });
}

function renderBanner() {
  var b = $('#banner'), p = state.plan;
  var msgs = [];
  state.model.errors.forEach(function (e) { msgs.push('结构错误：' + e); });
  p.invalid.forEach(function (x) { msgs.push('约束 ' + x.constraint.id + ' 无效：' + x.reason); });
  p.problems.forEach(function (x) { msgs.push('路径断裂：' + x.reason); });
  if (msgs.length) { b.textContent = msgs.join('\n'); b.classList.add('show'); }
  else { b.textContent = ''; b.classList.remove('show'); }
}

function renderTree() {
  var box = $('#tree-rows'); box.textContent = '';
  var plan = state.plan, rows = [];
  function walk(cid, depth) {
    var c = state.model.containers[cid];
    var head = document.createElement('div');
    head.className = 'tree-c';
    head.style.paddingLeft = (depth * 16 + 8) + 'px';
    head.textContent = (c ? c.label : cid);
    box.appendChild(head);
    (state.model.children[cid] || []).forEach(function (ch) {
      if (state.model.containers[ch]) { walk(ch, depth + 1); return; }
      rows.push(ch);
      var li = document.createElement('div');
      li.className = 'tree-el';
      li.dataset.key = ch;
      li.tabIndex = (state.panel === 'tree' && ch === state.selEl) ? 0 : -1;
      li.style.padding = '3px 8px 3px ' + (depth * 16 + 24) + 'px';
      var pos = plan.posInPath[ch];
      var posTxt = document.createElement('span');
      posTxt.className = 'pos';
      posTxt.textContent = pos != null ? ('#' + (pos + 1)) : '—';
      li.appendChild(posTxt);
      var name = document.createElement('span');
      name.textContent = ' ' + label(ch) + ' ';
      li.appendChild(name);
      if (state.model.elements[ch].required) li.appendChild(badge('必需', 'req'));
      if (ch === state.model.initialFocus) li.appendChild(badge('初始', 'init'));
      if (pos == null) li.appendChild(badge('不可达', 'unreach'));
      if (state.walk) {
        var wpos = plan.posInPath[ch];
        if (wpos != null && wpos < state.walk.idx) li.classList.add('walkdone');
        if (wpos != null && wpos === state.walk.idx) li.classList.add('walkcur');
      }
      box.appendChild(li);
    });
  }
  walk(state.model.root, 0);
  state.treeRows = rows;
}

function constraintStatus(c) {
  var id = String(c.id);
  var i, p = state.plan;
  for (i = 0; i < p.invalid.length; i++) {
    if (String(p.invalid[i].constraint.id) === id) return { cls: 'bad', text: '无效', reason: p.invalid[i].reason };
  }
  for (i = 0; i < p.overridden.length; i++) {
    if (String(p.overridden[i].constraint.id) === id) return { cls: 'over', text: '已覆盖', reason: p.overridden[i].reason };
  }
  return { cls: 'ok', text: '生效', reason: '该约束当前生效' };
}

function renderCons() {
  var ul = $('#cons-rows'); ul.textContent = '';
  var rows = [];
  state.doc.constraints.forEach(function (raw, i) {
    var c = { id: raw.id != null ? String(raw.id) : ('j' + (i + 1)), from: String(raw.from), to: String(raw.to), priority: Number(raw.priority) || 0, note: raw.note || '' };
    rows.push(c);
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.key = c.id;
    li.tabIndex = (state.panel === 'cons' && c.id === state.selCons) ? 0 : -1;
    var head = document.createElement('span');
    head.textContent = c.id + '：' + label(c.from) + ' → ' + label(c.to);
    li.appendChild(head);
    li.appendChild(badge('优先级 ' + c.priority, ''));
    var st = constraintStatus(c);
    li.appendChild(badge(st.text, st.cls));
    li.title = st.reason + (c.note ? '｜备注：' + c.note : '');
    ul.appendChild(li);
  });
  if (!rows.length) {
    var li = document.createElement('li');
    li.textContent = '（暂无约束，按 i 新增）';
    li.tabIndex = state.panel === 'cons' ? 0 : -1;
    ul.appendChild(li);
  }
  state.consRows = rows;
}

/* ---------- 焦点恢复（保证修改后焦点不丢失） ---------- */


function panelEl() { return $('#panel-' + state.panel); }

function restoreFocus() {
  var ae = document.activeElement;
  var insidePanel = ae && (ae.closest && ae.closest('section.panel'));
  // 已连接的外部控件（输入框/按钮）不抢焦点；已分离的旧节点或 body 则恢复到面板
  if (ae && ae.isConnected && ae !== document.body && !insidePanel) return;
  var key = state.panel === 'cons' ? state.selCons : state.selEl;
  var target = key ? panelEl().querySelector('[data-key="' + key + '"]') : null;
  if (!target) target = panelEl().querySelector('[tabindex="0"]');
  if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
}

function setPanel(name) {
  state.panel = name;
  render();
  var names = { list: '焦点顺序列表', tree: '层级视图', cons: '跳转约束' };
  say('已切换到：' + names[name]);
}

/* ---------- 选择移动（列表与层级同步同一元素） ---------- */

function moveElement(delta) {
  var rows = state.panel === 'tree' ? state.treeRows : state.listRows.map(function (r) { return r.id; });
  var i = rows.indexOf(state.selEl);
  if (i < 0) i = 0;
  i = Math.max(0, Math.min(rows.length - 1, i + delta));
  state.selEl = rows[i];
  render();
  var pos = state.plan.posInPath[state.selEl];
  say('「' + label(state.selEl) + '」' + (pos != null ? '位于路径第 ' + (pos + 1) + ' 位' : '不在路径中（不可达）'));
}

function moveCons(delta) {
  var rows = state.consRows;
  if (!rows.length) return;
  var i = rows.findIndex(function (c) { return c.id === state.selCons; });
  if (i < 0) i = 0;
  i = Math.max(0, Math.min(rows.length - 1, i + delta));
  state.selCons = rows[i].id;
  render();
  var st = constraintStatus(rows[i]);
  say('约束 ' + rows[i].id + '（' + st.text + '）：' + st.reason);
}

/* ---------- 约束编辑 ---------- */

function adjustPriority(delta) {
  var c = state.doc.constraints.filter(function (x) { return String(x.id) === state.selCons; })[0];
  if (!c) return;
  mutate(function (doc) {
    doc.constraints.forEach(function (x) {
      if (String(x.id) === state.selCons) x.priority = (Number(x.priority) || 0) + delta;
    });
  }, '约束 ' + state.selCons + ' 优先级调整为 ' + ((Number(c.priority) || 0) + delta));
}

function deleteCons() {
  var id = state.selCons;
  if (!id || !state.consRows.length) return;
  mutate(function (doc) {
    doc.constraints = doc.constraints.filter(function (x) { return String(x.id) !== id; });
  }, '已删除约束 ' + id);
}

function openInsert() {
  var f = $('#insert-form');
  var from = $('#ins-from'), to = $('#ins-to');
  from.textContent = ''; to.textContent = '';
  state.model.elementIds.forEach(function (id) {
    var o1 = document.createElement('option'); o1.value = id; o1.textContent = label(id) + '（' + id + '）';
    var o2 = document.createElement('option'); o2.value = id; o2.textContent = label(id) + '（' + id + '）';
    from.appendChild(o1); to.appendChild(o2);
  });
  if (state.selEl) from.value = state.selEl;
  f.hidden = false;
  from.focus();
}

function closeInsert(focusBack) {
  $('#insert-form').hidden = true;
  var ae = document.activeElement;
  if (ae && $('#insert-form').contains(ae)) ae.blur();
  if (focusBack !== false) restoreFocus();
}

function commitInsert() {
  var from = $('#ins-from').value, to = $('#ins-to').value;
  var pri = Number($('#ins-pri').value) || 0;
  var note = $('#ins-note').value || '';
  var n = 0;
  state.doc.constraints.forEach(function (c) {
    var m = /^j(\d+)$/.exec(String(c.id));
    if (m) n = Math.max(n, Number(m[1]));
  });
  var id = 'j' + (n + 1);
  state.selCons = id;
  mutate(function (doc) {
    doc.constraints.push({ id: id, from: from, to: to, priority: pri, note: note });
  }, '已新增约束 ' + id + '：' + label(from) + ' → ' + label(to));
  closeInsert(false);
  state.panel = 'cons';
  render();
}

/* ---------- 走查模式 ---------- */

function walkStart() {
  var p = state.plan;
  if (!p.path.length) { say('没有可走查的元素。', 'err'); return; }
  state.walk = { idx: 0 };
  state.selEl = p.path[0];
  render();
  var warn = p.invalid.length ? ('注意：有 ' + p.invalid.length + ' 条无效约束被忽略。\n') : '';
  say(warn + '走查开始（第 1/' + p.path.length + ' 步）：初始焦点在「' + label(p.path[0]) + '」。按 n 推进。');
}

function walkStep() {
  var p = state.plan, w = state.walk;
  if (!w) { walkStart(); return; }
  if (w.idx >= p.path.length - 1) { walkEnd(); return; }
  var from = p.path[w.idx];
  w.idx++;
  var to = p.path[w.idx];
  state.selEl = to;
  render();
  var edge = p.edges[from];
  var via = edge && edge.via ? ('按约束 ' + edge.via + ' 跳转') : '按默认顺序前进';
  say('第 ' + (w.idx + 1) + '/' + p.path.length + ' 步：从「' + label(from) + '」' + via + '到「' + label(to) + '」。');
  if (w.idx >= p.path.length - 1) walkEnd(true);
}

function walkEnd(append) {
  var p = state.plan;
  var prev = append ? $('#statusbar').textContent + '\n' : '';
  if (!p.problems.length) {
    var skipped = p.order.filter(function (id) { return !p.visited[id]; }).map(label);
    if (skipped.length) {
      say(prev + '走查完成：全部必需元素可达。以下可选元素未进入路径：' + skipped.join('、') + '。', 'ok');
    } else {
      say(prev + '走查完成：从初始焦点出发，全部 ' + p.order.length + ' 个元素按顺序可达，无断裂。', 'ok');
    }
  } else {
    var last = p.path[p.path.length - 1];
    var lines = p.problems.map(function (x) { return '⚠ ' + x.reason; });
    say(prev + '走查停在「' + label(last) + '」：路径在此断裂。\n' + lines.join('\n'), 'err');
  }
}

function walkReset() {
  if (!state.walk) { say('当前不在走查模式。'); return; }
  state.walk = { idx: 0 };
  state.selEl = state.plan.path[0];
  render();
  say('走查已重置：焦点回到「' + label(state.plan.path[0]) + '」。按 n 推进。');
}

function walkExit() {
  if (!state.walk) return;
  state.walk = null;
  render();
  say('已退出走查模式。');
}

/* ---------- 键盘路由 ---------- */

document.addEventListener('keydown', function (ev) {
  var t = ev.target;
  if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) {
    if (ev.key === 'Escape') { t.blur(); closeInsert(); }
    return;
  }
  var k = ev.key;
  if (k === '1' || k === '2' || k === '3') { setPanel({ 1: 'list', 2: 'tree', 3: 'cons' }[k]); ev.preventDefault(); return; }
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    var d = k === 'ArrowUp' ? -1 : 1;
    if (state.panel === 'cons') {
      if (ev.ctrlKey) adjustPriority(d); else moveCons(d);
    } else moveElement(d);
    ev.preventDefault(); return;
  }
  switch (k) {
    case 'i': case 'I': openInsert(); ev.preventDefault(); break;
    case 'Delete': if (state.panel === 'cons') { deleteCons(); ev.preventDefault(); } break;
    case 'w': case 'W': walkStart(); ev.preventDefault(); break;
    case 'n': case 'N': case ' ': if (state.walk) { walkStep(); ev.preventDefault(); } break;
    case 'r': case 'R': walkReset(); ev.preventDefault(); break;
    case 'Escape': walkExit(); break;
    case 'l': case 'L': $('#json-input').focus(); ev.preventDefault(); break;
  }
});
/* ---------- 导入与启动 ---------- */

function loadFromText(text, source) {
  var doc;
  try { doc = JSON.parse(text); }
  catch (e) { say(source + ' 不是有效的 JSON：' + e.message, 'err'); return; }
  reload(doc, false);
  var p = state.plan;
  var notes = [];
  if (p.overridden.length) notes.push(p.overridden.length + ' 条约束被覆盖（详见约束面板）');
  if (p.problems.length) notes.push('存在路径断裂，见上方红色提示');
  say('已加载' + source + '：' + state.model.elementIds.length + ' 个元素、' +
      state.doc.constraints.length + ' 条约束，路径覆盖 ' + p.path.length + '/' + p.order.length + '。' +
      (notes.length ? notes.join('；') : '全部必需元素可达。'),
      p.problems.length ? 'err' : 'ok');
}

$('#btn-load').addEventListener('click', function () { loadFromText($('#json-input').value, '输入的结构'); this.blur(); });
$('#btn-sample').addEventListener('click', function () { $('#json-input').value = SAMPLE_TEXT; loadFromText(SAMPLE_TEXT, '示例结构'); this.blur(); });
$('#file-input').addEventListener('change', function (ev) {
  var f = ev.target.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () { $('#json-input').value = r.result; loadFromText(r.result, '文件 ' + f.name); };
  r.readAsText(f, 'utf-8');
});
$('#ins-ok').addEventListener('click', commitInsert);
$('#ins-cancel').addEventListener('click', function () { closeInsert(); });

var SAMPLE_TEXT = JSON.stringify({
  root: 'wizard', initialFocus: 'name',
  containers: [
    { id: 'wizard', label: '注册向导' },
    { id: 'step1', label: 'step1 基本信息' }, { id: 'step2', label: 'step2 账户安全' },
    { id: 'step3', label: 'step3 偏好设置' }, { id: 'actions', label: '操作区' }
  ],
  children: {
    wizard: ['step1', 'step2', 'step3', 'actions'],
    step1: ['name', 'email', 'phone'], step2: ['password', 'confirm', 'invite'],
    step3: ['theme', 'newsletter'], actions: ['prev', 'next', 'submit']
  },
  elements: [
    { id: 'name', label: '姓名', required: true }, { id: 'email', label: '邮箱', required: true },
    { id: 'phone', label: '手机号' }, { id: 'password', label: '密码', required: true },
    { id: 'confirm', label: '确认密码', required: true }, { id: 'invite', label: '邀请码' },
    { id: 'theme', label: '主题选择' }, { id: 'newsletter', label: '订阅邮件' },
    { id: 'prev', label: '上一步' }, { id: 'next', label: '下一步', required: true },
    { id: 'submit', label: '提交', required: true }
  ],
  constraints: [
    { id: 'j1', from: 'email', to: 'password', priority: 10, note: '邮箱验证后直达账户设置' },
    { id: 'j2', from: 'email', to: 'phone', priority: 3, note: '低优先级回退方案' },
    { id: 'k1', from: 'confirm', to: 'theme', priority: 8, note: '确认密码后进入偏好' },
    { id: 'k2', from: 'newsletter', to: 'password', priority: 4, note: '循环示例：跳回密码' }
  ]
}, null, 2);

$('#json-input').value = SAMPLE_TEXT;
loadFromText(SAMPLE_TEXT, '内置示例');

})();
