'use strict';
/* 预算推演台 UI 层：全部计算在本地浏览器内完成，离线可用，无任何网络请求。 */

var STORAGE_KEY = 'budgetSandbox.v1';
var state = null;       // { budget, projects: [...] }
var prevAmounts = null; // 上一次求解结果 id -> amount，用于变化标记

var STATUS_LABEL = {
  full: '已足额', partial: '部分满足', unmet: '低于最低投入',
  blocked: '前置未满足', excluded: '已排除', locked: '已锁定', conflict: '依赖闭环'
};

function sampleState() {
  return {
    budget: 1000,
    projects: [
      { id: 'P1', name: '平台架构', requested: 300, priority: 5, min: 200, deps: [], locked: null, excluded: false },
      { id: 'P2', name: '数据接入', requested: 200, priority: 4, min: 100, deps: ['P1'], locked: null, excluded: false },
      { id: 'P3', name: '核心算法', requested: 350, priority: 5, min: 250, deps: ['P1'], locked: null, excluded: false },
      { id: 'P4', name: '可视化界面', requested: 180, priority: 3, min: 80, deps: ['P3'], locked: null, excluded: false },
      { id: 'P5', name: '测试验证', requested: 120, priority: 2, min: 60, deps: ['P2', 'P3'], locked: null, excluded: false },
      { id: 'P6', name: '运维部署', requested: 150, priority: 2, min: 50, deps: ['P5'], locked: null, excluded: false }
    ]
  };
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && Array.isArray(s.projects)) return s;
    }
  } catch (e) { /* 忽略损坏的缓存 */ }
  return sampleState();
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function fmt(x) {
  return String(Math.round((Number(x) + Number.EPSILON) * 100) / 100);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function newProjectId() {
  var n = 0;
  state.projects.forEach(function (p) {
    var m = /^P(\d+)$/.exec(p.id);
    if (m) n = Math.max(n, Number(m[1]));
  });
  return 'P' + (n + 1);
}

/* ---------- 求解与结果渲染 ---------- */

function recompute() {
  var out = budgetSolve(state);
  renderSummary(out);
  renderConflicts(out.conflicts);
  renderResults(out);
  var cur = {};
  out.results.forEach(function (r) { cur[r.id] = r.amount; });
  prevAmounts = cur;
  saveState();
}

function renderSummary(out) {
  var el = document.getElementById('summary');
  var remain = Math.round((out.budget - out.totalAllocated) * 100) / 100;
  el.textContent = '总资金 ' + fmt(out.budget) + ' ｜ 已分配 ' + fmt(out.totalAllocated) +
    ' ｜ 剩余 ' + fmt(remain) +
    (out.conflicts.length ? ' ｜ 存在 ' + out.conflicts.length + ' 项冲突' : '');
  el.className = out.conflicts.length ? 'summary has-conflict' : 'summary';
}

function renderConflicts(conflicts) {
  var box = document.getElementById('conflicts');
  box.innerHTML = '';
  conflicts.forEach(function (c) {
    var div = document.createElement('div');
    div.className = 'conflict conflict-' + c.type;
    div.textContent = '⚠ ' + c.message;
    box.appendChild(div);
  });
}

function renderResults(out) {
  var tbody = document.getElementById('resultBody');
  tbody.innerHTML = '';
  out.results.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.className = 'st-' + r.status;
    var deltaHtml = '';
    if (prevAmounts && prevAmounts[r.id] !== undefined) {
      var diff = Math.round((r.amount - prevAmounts[r.id]) * 100) / 100;
      if (diff > 0.004) {
        deltaHtml = '<span class="delta up">+' + fmt(diff) + '</span>';
        tr.className += ' changed';
      } else if (diff < -0.004) {
        deltaHtml = '<span class="delta down">-' + fmt(-diff) + '</span>';
        tr.className += ' changed';
      }
    } else if (prevAmounts) {
      tr.className += ' changed';
      deltaHtml = '<span class="delta new">新增</span>';
    }
    var pct = Math.round(r.satisfaction * 1000) / 10;
    tr.innerHTML =
      '<td>' + escapeHtml(r.id) + ' ' + escapeHtml(r.name) + '</td>' +
      '<td><span class="chip chip-' + r.status + '">' + STATUS_LABEL[r.status] + '</span></td>' +
      '<td class="num">' + fmt(r.amount) + '</td>' +
      '<td><div class="bar"><div class="bar-fill" style="width:' + Math.min(100, pct) +
        '%"></div></div><span class="pct">' + pct + '%</span></td>' +
      '<td class="num">' + deltaHtml + '</td>' +
      '<td class="constraint">' + escapeHtml(r.constraint) + '</td>';
    tbody.appendChild(tr);
  });
}

/* ---------- 编辑区渲染与事件 ---------- */

function renderEditor() {
  var tbody = document.getElementById('editorBody');
  tbody.innerHTML = '';
  state.projects.forEach(function (p) {
    var tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.innerHTML =
      '<td class="pid">' + escapeHtml(p.id) + '</td>' +
      '<td><input data-f="name" value="' + escapeHtml(p.name) + '"></td>' +
      '<td><input data-f="requested" type="number" min="0" step="10" value="' + p.requested + '"></td>' +
      '<td><input data-f="priority" type="number" min="0" max="9" step="1" value="' + p.priority + '"></td>' +
      '<td><input data-f="min" type="number" min="0" step="10" value="' + p.min + '"></td>' +
      '<td><input data-f="deps" class="deps" placeholder="如 P1,P2" value="' +
        escapeHtml(p.deps.join(',')) + '"></td>' +
      '<td><input data-f="locked" type="number" min="0" step="10" placeholder="不锁定" value="' +
        (p.locked === null || p.locked === undefined ? '' : p.locked) + '"></td>' +
      '<td class="ctr"><input data-f="excluded" type="checkbox"' + (p.excluded ? ' checked' : '') + '></td>' +
      '<td class="ctr"><button class="del" title="删除项目">×</button></td>';
    tbody.appendChild(tr);
  });
}

function findProject(id) {
  for (var i = 0; i < state.projects.length; i++) {
    if (state.projects[i].id === id) return state.projects[i];
  }
  return null;
}

function onEditorInput(e) {
  var input = e.target;
  var tr = input.closest('tr');
  if (!tr || !input.dataset.f) return;
  var p = findProject(tr.dataset.id);
  if (!p) return;
  var f = input.dataset.f;
  if (f === 'name') {
    p.name = input.value;
  } else if (f === 'requested') {
    p.requested = Math.max(0, Number(input.value) || 0);
  } else if (f === 'priority') {
    p.priority = Number(input.value) || 0;
  } else if (f === 'min') {
    p.min = Math.max(0, Number(input.value) || 0);
  } else if (f === 'locked') {
    p.locked = input.value === '' ? null : Math.max(0, Number(input.value) || 0);
  } else if (f === 'excluded') {
    p.excluded = input.checked;
  } else if (f === 'deps') {
    var ids = input.value.split(/[，,\s]+/).filter(Boolean);
    var known = {};
    state.projects.forEach(function (q) { known[q.id] = true; });
    var unknown = ids.filter(function (d) { return !known[d]; });
    p.deps = ids.filter(function (d) { return known[d]; });
    input.classList.toggle('bad', unknown.length > 0);
    input.title = unknown.length ? '未知项目 id：' + unknown.join('、') + '（已忽略）' : '';
  }
  recompute();
}

function onEditorClick(e) {
  if (!e.target.classList.contains('del')) return;
  var id = e.target.closest('tr').dataset.id;
  state.projects = state.projects.filter(function (p) { return p.id !== id; });
  state.projects.forEach(function (p) {
    p.deps = p.deps.filter(function (d) { return d !== id; });
  });
  renderEditor();
  recompute();
}

/* ---------- 启动 ---------- */

function boot() {
  state = loadState();
  var budgetInput = document.getElementById('budgetInput');
  budgetInput.value = state.budget;
  budgetInput.addEventListener('input', function () {
    state.budget = Math.max(0, Number(budgetInput.value) || 0);
    recompute();
  });
  document.getElementById('editorBody').addEventListener('input', onEditorInput);
  document.getElementById('editorBody').addEventListener('click', onEditorClick);
  document.getElementById('addBtn').addEventListener('click', function () {
    state.projects.push({
      id: newProjectId(), name: '新项目', requested: 100, priority: 1,
      min: 0, deps: [], locked: null, excluded: false
    });
    renderEditor();
    recompute();
  });
  document.getElementById('sampleBtn').addEventListener('click', function () {
    state = sampleState();
    budgetInput.value = state.budget;
    renderEditor();
    recompute();
  });
  renderEditor();
  recompute();
}

document.addEventListener('DOMContentLoaded', boot);
