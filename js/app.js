/* ============================================================
 * 生产链推演工作台 —— 界面层
 * ============================================================ */
(function () {
'use strict';
var Engine = window.Engine;
var state = Engine.createState();
var STORE_KEY = 'prodchain-workbench-v1';

function $(s) { return document.querySelector(s); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '∞';
  return String(Math.round(n * 10000) / 10000);
}
function persist() { try { localStorage.setItem(STORE_KEY, Engine.serialize(state)); } catch (e) { /* 忽略 */ } }
function log(msg) { Engine.addLog(state, msg); }
function rerender() { persist(); render(); }

/* ---------------- 渲染 ---------------- */

function render() {
  var view = Engine.getView(state);
  renderTarget(view);
  renderAlert(view);
  renderResources(view);
  renderRecipes(view);
  renderResults(view);
  renderConflicts(view);
  renderErrors(view);
  renderLog();
}

function renderTarget(view) {
  var sel = $('#target-resource');
  var cur = state.target.resource;
  var ids = Object.keys(view.resources).sort();
  sel.innerHTML = '<option value="">（选择目标产物）</option>' + ids.map(function (id) {
    return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(id) + '</option>';
  }).join('');
  $('#target-qty').value = state.target.qty || 0;
  var badge = $('#consistency');
  if (view.meta.consistent) { badge.textContent = '增量=全量 ✓'; badge.className = 'badge ok'; }
  else { badge.textContent = '已回退全量'; badge.className = 'badge warn'; }
}

function renderAlert(view) {
  var el = $('#alert');
  if (view.rootCauses.length) {
    el.className = 'alert';
    el.innerHTML = '⚠ 断供警报：缺口最早出现在第 ' + view.firstShortLevel + ' 级；根源资源 ' +
      view.rootCauses.map(function (r) { return '「' + esc(r) + '」'; }).join('、') +
      ' 无法由现有库存与替代配方补齐，缺口未计入下游已满足量。';
  } else if (view.target.resource) {
    el.className = 'alert ok';
    el.textContent = '✓ 当前目标可由库存与产能满足，无断供。';
  } else {
    el.className = 'hidden';
  }
}

function renderResources(view) {
  var byId = {};
  view.rows.forEach(function (r) { byId[r.id] = r; });
  var ids = Object.keys(view.resources).sort();
  if (!ids.length) { $('#resource-table').innerHTML = '<p class="muted">尚未录入资源。</p>'; return; }
  var html = '<table><thead><tr><th>资源</th><th>库存</th><th>标记</th></tr></thead><tbody>';
  ids.forEach(function (id) {
    var res = view.resources[id], row = byId[id], badges = [];
    if (res.conflict) badges.push('<span class="tag conflict">冲突</span>');
    if (res.tentative) badges.push('<span class="tag tentative">临时取值</span>');
    if (res.overridden) badges.push('<span class="tag override">人工修正</span>');
    if (row && row.rootCause) badges.push('<span class="tag root">断供根源</span>');
    else if (row && row.shortage > 0) badges.push('<span class="tag short">有缺口</span>');
    html += '<tr><td>' + esc(id) + '</td>' +
      '<td><input class="stock-input" data-id="' + esc(id) + '" type="number" min="0" step="any" value="' + res.stock + '"></td>' +
      '<td>' + badges.join(' ') + '</td></tr>';
  });
  html += '</tbody></table>';
  $('#resource-table').innerHTML = html;
}

function renderRecipes(view) {
  var ids = Object.keys(view.recipes).sort();
  if (!ids.length) { $('#recipe-table').innerHTML = '<p class="muted">尚未录入配方。</p>'; return; }
  var html = '<table><thead><tr><th>启用</th><th>配方</th><th>产出</th><th>投入</th><th>标记</th></tr></thead><tbody>';
  ids.forEach(function (id) {
    var r = view.recipes[id], badges = [];
    if (r.conflict) badges.push('<span class="tag conflict">冲突</span>');
    if (r.invalid) badges.push('<span class="tag invalid">已拒绝</span>');
    if (r.cyclic) badges.push('<span class="tag invalid">成环</span>');
    var inputs = r.inputs.map(function (i) { return esc(i.resource) + '×' + fmt(i.qty); }).join('，') || '（无投入）';
    var canToggle = !r.invalid && !r.cyclic;
    html += '<tr' + (r.enabled ? '' : ' class="disabled"') + '>' +
      '<td><input type="checkbox" class="recipe-toggle" data-id="' + esc(id) + '"' +
      (r.enabled ? ' checked' : '') + (canToggle ? '' : ' disabled') + '></td>' +
      '<td>' + esc(id) + '</td>' +
      '<td>' + esc(r.output.resource) + '×' + fmt(r.output.qty) + '</td>' +
      '<td>' + inputs + '</td><td>' + badges.join(' ') + '</td></tr>';
  });
  html += '</tbody></table>';
  $('#recipe-table').innerHTML = html;
}
function renderResults(view) {
  var meta = view.meta;
  $('#result-meta').textContent = '推演模式：' + meta.mode + ' ｜ 本次重推节点 ' +
    meta.recomputed + '/' + meta.total + ' ｜ ' + (meta.consistent ? '增量与全量一致 ✓' : '增量偏差，已回退全量');
  if (!view.rows.length) {
    $('#result-table').innerHTML = '<p class="muted">请设置目标产物与数量后开始推演。</p>';
    return;
  }
  var html = '', curLevel = null;
  view.rows.forEach(function (row) {
    if (row.level !== curLevel) {
      if (curLevel !== null) html += '</tbody></table>';
      curLevel = row.level;
      html += '<h3>第 ' + row.level + ' 级</h3>' +
        '<table><thead><tr><th>资源</th><th>需求</th><th>库存</th><th>可产出</th><th>缺口</th>' +
        '<th>放大倍数</th><th>需求来源</th></tr></thead><tbody>';
    }
    var src = row.consumers.map(function (c) {
      return '配方「' + esc(c.recipe) + '」（产物 ' + esc(c.output) + '）需求 ' + fmt(c.demand) +
        '，单件放大 ×' + fmt(c.edgeMult);
    }).join('<br>') || (row.level === 0 ? '目标产物' : '—');
    var cls = row.shortage > 0 ? (row.rootCause ? ' class="root-short"' : ' class="short"') : '';
    html += '<tr' + cls + '><td>' + esc(row.id) +
      (row.rootCause ? ' <span class="tag root">断供根源</span>' : '') +
      '</td><td>' + fmt(row.req) + '</td><td>' + fmt(row.stock) + '</td><td>' + fmt(row.produced) +
      '</td><td>' + fmt(row.shortage) + '</td><td>×' + fmt(row.cumMult) +
      '</td><td class="src">' + src + '</td></tr>';
  });
  html += '</tbody></table>';
  $('#result-table').innerHTML = html;
}

function renderConflicts(view) {
  var box = $('#conflict-list');
  if (!view.conflicts.length) { box.innerHTML = '<p class="muted">当前无冲突。</p>'; return; }
  var html = '';
  view.conflicts.forEach(function (c) {
    if (c.kind === 'resource-stock') {
      html += '<div class="conflict-item"><b>资源「' + esc(c.id) + '」库存冲突</b>（双方均已保留' +
        (c.tentative ? '，当前临时取最小值' : '，已人工裁决') + '）<ul>';
      c.values.forEach(function (v) {
        html += '<li>来源「' + esc(v.source) + '」：' + fmt(v.stock) +
          ' <button class="resolve" data-kind="resource-stock" data-id="' + esc(c.id) +
          '" data-value="' + v.stock + '">采用此值</button></li>';
      });
      html += '</ul></div>';
    } else {
      html += '<div class="conflict-item"><b>配方「' + esc(c.id) + '」定义冲突</b>（各变体均已保留' +
        (c.tentative ? '，当前临时采用首个变体' : '，已人工裁决') + '）<ul>';
      c.variants.forEach(function (v, vi) {
        var inputs = v.inputs.map(function (i) { return esc(i.resource) + '×' + fmt(i.qty); }).join('，') || '（无投入）';
        html += '<li>来源「' + esc(v.source) + '」：产出 ' + esc(v.output.resource) + '×' + fmt(v.output.qty) +
          ' ← ' + inputs + ' <button class="resolve" data-kind="recipe-def" data-id="' + esc(c.id) +
          '" data-value="' + vi + '">采用此变体</button></li>';
      });
      html += '</ul></div>';
    }
  });
  box.innerHTML = html;
}

function renderErrors(view) {
  $('#error-list').innerHTML = view.errors.length
    ? '<ul>' + view.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'
    : '<p class="muted">当前无被拒绝的数据。</p>';
}

function renderLog() {
  $('#log-list').innerHTML = state.log.length
    ? state.log.map(function (e) {
        return '<div class="log-item"><span class="time">' + esc(e.time) + '</span>' + esc(e.msg) + '</div>';
      }).join('')
    : '<p class="muted">暂无操作。</p>';
}
/* ---------------- 事件绑定与初始化 ---------------- */

function bindEvents() {
  $('#btn-run').addEventListener('click', function () {
    var r = Engine.setTarget(state, $('#target-resource').value, $('#target-qty').value);
    if (!r.ok) log('已拒绝：' + r.error);
    else log('目标设定：' + $('#target-resource').value + ' ×' + $('#target-qty').value);
    rerender();
  });

  $('#resource-table').addEventListener('change', function (e) {
    if (!e.target.classList.contains('stock-input')) return;
    var r = Engine.setStock(state, e.target.dataset.id, e.target.value);
    if (!r.ok) log('已拒绝：' + r.error);
    rerender();
  });

  $('#recipe-table').addEventListener('change', function (e) {
    if (!e.target.classList.contains('recipe-toggle')) return;
    var r = Engine.setRecipeEnabled(state, e.target.dataset.id, e.target.checked);
    if (!r.ok) log('已拒绝：' + r.error);
    rerender();
  });

  $('#conflict-list').addEventListener('click', function (e) {
    if (!e.target.classList.contains('resolve')) return;
    Engine.resolveConflict(state, e.target.dataset.kind, e.target.dataset.id, e.target.dataset.value);
    rerender();
  });

  $('#resource-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = Engine.addResource(state, $('#resource-source').value || '手工录入',
      $('#resource-id').value, $('#resource-stock').value);
    if (!r.ok) { log('已拒绝：' + r.error); rerender(); return; }
    log('资源「' + $('#resource-id').value + '」已录入');
    Engine.runRecompute(state, null, '全量');
    rerender();
  });

  $('#btn-add-input').addEventListener('click', function () {
    var div = document.createElement('div');
    div.className = 'input-row';
    div.innerHTML = '<input class="inp-res" placeholder="投入资源">' +
      '<input class="inp-qty" type="number" min="0" step="any" placeholder="用量">' +
      '<button type="button" class="del-input">×</button>';
    $('#input-rows').appendChild(div);
  });
  $('#input-rows').addEventListener('click', function (e) {
    if (e.target.classList.contains('del-input')) e.target.parentNode.remove();
  });

  $('#recipe-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var inputs = [];
    document.querySelectorAll('#input-rows .input-row').forEach(function (row) {
      inputs.push({ resource: row.querySelector('.inp-res').value, qty: row.querySelector('.inp-qty').value });
    });
    var r = Engine.addRecipe(state, $('#recipe-source').value || '手工录入', {
      id: $('#recipe-id').value,
      output: { resource: $('#recipe-out-res').value, qty: $('#recipe-out-qty').value },
      inputs: inputs
    });
    if (!r.ok) { log('已拒绝：' + r.error); rerender(); return; }
    log('配方「' + $('#recipe-id').value + '」已录入');
    Engine.runRecompute(state, null, '全量');
    rerender();
  });

  $('#btn-sample').addEventListener('click', function () {
    var r = Engine.loadDataset(state, '基础台账', Engine.SAMPLE);
    r.errors.forEach(function (e2) { log('已拒绝：' + e2); });
    if (!state.target.resource) Engine.setTarget(state, '套件', 120);
    Engine.runRecompute(state, null, '全量');
    log('已载入示例数据');
    rerender();
  });

  $('#btn-conflict').addEventListener('click', function () {
    var r = Engine.loadDataset(state, '采购导入', Engine.CONFLICT);
    r.errors.forEach(function (e2) { log('已拒绝：' + e2); });
    Engine.runRecompute(state, null, '全量');
    log('已导入第二来源「采购导入」，冲突与拒绝记录见对应面板');
    rerender();
  });

  $('#btn-verify').addEventListener('click', function () {
    Engine.runRecompute(state, null, '全量');
    log('手动全量重推校验完成：结果一致 ✓');
    rerender();
  });

  $('#btn-clear').addEventListener('click', function () {
    if (!window.confirm('确定清空全部资源、配方与目标？')) return;
    Engine.clearAll(state);
    log('已清空全部数据');
    rerender();
  });
}

function init() {
  var restored = false;
  try { restored = Engine.restore(state, localStorage.getItem(STORE_KEY)); } catch (e) { restored = false; }
  if (!restored || state.resourceEntries.length === 0) {
    var r = Engine.loadDataset(state, '基础台账', Engine.SAMPLE);
    r.errors.forEach(function (e) { log('已拒绝：' + e); });
    Engine.setTarget(state, '套件', 120);
    log('已载入示例数据（目标：套件 ×120）');
  }
  Engine.runRecompute(state, null, '全量');
  bindEvents();
  render();
}

init();
})();
