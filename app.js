/* app.js — 界面层:场景、渲染与交互(依赖 core.js,全程离线) */
'use strict';
var state = Core.createState();
var camera = { target: [0, 1.5, 0], yaw: 35, pitch: 25, distance: 34 };
var viewport = { width: 800, height: 600, fov: 55 };
var selectedObject = null;
var selectedAnn = null;
var canvas = document.getElementById('view');
var ctx = canvas.getContext('2d');

/* ---------------- 演示场景 ---------------- */
function seed() {
  Core.addObject(state, { id: 'site', size: [24, 0.5, 24], position: [0, -0.25, 0] });
  Core.addObject(state, { id: 'building', parentId: 'site', size: [12, 6, 9], position: [0, 3, 0] });
  Core.addObject(state, { id: 'floor1', parentId: 'building', size: [11, 0.4, 8], position: [0, -1.5, 0] });
  Core.addObject(state, { id: 'floor2', parentId: 'building', size: [11, 0.4, 8], position: [0, 1.5, 0] });
  Core.addObject(state, { id: 'desk', parentId: 'floor1', size: [2.4, 1, 1.2], position: [-2, 0.7, 1] });
  Core.addObject(state, { id: 'cabinet', parentId: 'floor1', size: [1.2, 2, 0.8], position: [3, 1.2, -2] });
  Core.addObject(state, { id: 'tank', parentId: 'floor2', size: [1.6, 1.6, 1.6], position: [2, 1, 1.5] });
  Core.addAnnotation(state, { id: 'A-001', objectId: 'desk', anchor: [0, 0.5, 0], text: '桌面有划痕' }, '上游系统');
  Core.addAnnotation(state, { id: 'A-002', objectId: 'cabinet', anchor: [0, 1, 0.4], text: '柜门松动' }, '上游系统');
  Core.addAnnotation(state, { id: 'A-003', objectId: 'tank', anchor: [0.8, 0, 0], text: '罐体需复检' }, '审阅人甲');
  Core.addAnnotation(state, { id: 'A-004', objectId: 'building', anchor: [6, 3, 0], text: '外墙渗水' }, '审阅人甲');
  Core.addRelation(state, 'A-002', 'A-001', 'reference');
  Core.addRelation(state, 'A-003', 'A-002', 'dependency');
}

/* ---------------- 面板刷新 ---------------- */
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function refreshTree() {
  var host = document.getElementById('tree');
  host.innerHTML = '';
  function walk(id, depth) {
    var o = state.objects.get(id);
    var node = el('div', 'tree-node' + (id === selectedObject ? ' selected' : ''));
    node.style.paddingLeft = (4 + depth * 14) + 'px';
    var name = el('span', o.removed ? 'removed' : '', (o.removed ? '✝ ' : '') + id);
    node.appendChild(name);
    var annCount = 0;
    state.annotations.forEach(function (a) { if (a.objectId === id) annCount++; });
    if (annCount) node.appendChild(el('span', 'badge', '◈' + annCount));
    node.onclick = function () { selectedObject = id; refresh(); };
    host.appendChild(node);
    o.children.forEach(function (c) { walk(c, depth + 1); });
  }
  state.objects.forEach(function (o) { if (!o.parentId) walk(o.id, 0); });
  var sel = document.getElementById('reparentTarget');
  sel.innerHTML = '';
  sel.appendChild(el('option', '', '(根)'));
  state.objects.forEach(function (o) {
    if (!o.removed && o.id !== selectedObject) {
      var op = el('option', '', o.id); op.value = o.id; sel.appendChild(op);
    }
  });
}
var STATUS_TEXT = { visible: '可见', occluded: '被遮挡', outside: '视窗外', invalid: '已失效' };
function refreshAnnotations(view) {
  var host = document.getElementById('annList');
  host.innerHTML = '';
  view.annotations.forEach(function (a) {
    var ann = state.annotations.get(a.id);
    var item = el('div', 'ann-item' + (a.id === selectedAnn ? ' selected' : ''));
    var head = el('div', 'head');
    head.appendChild(el('b', '', a.id));
    head.appendChild(el('span', 'tag ' + a.status, STATUS_TEXT[a.status]));
    if (a.conflicted) head.appendChild(el('span', 'tag conflict', '冲突×' + ann.versions.length));
    item.appendChild(head);
    var pos = a.screen ? ('屏幕 (' + a.screen[0].toFixed(0) + ', ' + a.screen[1].toFixed(0) + ')')
      : '屏幕 (不可投影)';
    item.appendChild(el('div', 'pos', '对象 ' + a.objectId + ' · ' + pos +
      ' · 世界 (' + a.world.map(function (n) { return n.toFixed(1); }).join(', ') + ')'));
    item.appendChild(el('div', 'pos', '正文: ' + ann.versions[0].text +
      (ann.invalid ? ' · 失效原因: ' + ann.invalid.reason : '')));
    item.onclick = function () { selectedAnn = a.id; selectedObject = ann.objectId; refresh(); };
    host.appendChild(item);
  });
}
function refreshConflicts() {
  var host = document.getElementById('conflictList');
  host.innerHTML = '';
  if (!state.conflicts.length) { host.appendChild(el('div', 'pos', '暂无冲突')); return; }
  state.conflicts.forEach(function (c) {
    var box = el('div', 'conflict-item');
    box.appendChild(el('b', '', '标注 ' + c.annotationId + ' 存在 ' + c.versions.length + ' 个矛盾版本:'));
    c.versions.forEach(function (v) {
      box.appendChild(el('div', '', '· 来源 "' + v.source + '": 锚点 (' +
        v.anchor.join(', ') + ') 正文 "' + v.text + '"'));
    });
    host.appendChild(box);
  });
}
var lastLogCount = 0;
function refreshLog() {
  var host = document.getElementById('log');
  for (var i = lastLogCount; i < state.log.length; i++) {
    var l = state.log[i];
    host.appendChild(el('div', l.kind, '#' + l.seq + ' [' + l.kind + '] ' + l.message));
  }
  lastLogCount = state.log.length;
  host.scrollTop = host.scrollHeight;
}

/* ---------------- 3D 渲染 ---------------- */
var EDGES = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
var STATUS_COLOR = { visible: '#5fd08a', occluded: '#e8c25a', outside: '#9aa5b1', invalid: '#e07a7a' };
function drawScene(view) {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  var boxes = [];
  state.objects.forEach(function (o) {
    if (o.removed) return;
    var corners = Core.boxCornersWorld(state, o.id).map(function (p) {
      return Core.projectPoint(view.view, viewport, p);
    });
    var depth = 0, ok = true;
    corners.forEach(function (c) { if (c.behind) ok = false; depth += c.depth; });
    boxes.push({ id: o.id, corners: corners, depth: depth / 8, ok: ok });
  });
  boxes.sort(function (a, b) { return b.depth - a.depth; });
  boxes.forEach(function (b) {
    if (!b.ok) return;
    ctx.strokeStyle = b.id === selectedObject ? '#6fa8ff' : 'rgba(140,155,175,0.55)';
    ctx.lineWidth = b.id === selectedObject ? 2 : 1;
    ctx.beginPath();
    EDGES.forEach(function (e) {
      var p = b.corners[e[0]].screen, q = b.corners[e[1]].screen;
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    });
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,155,175,0.7)';
    ctx.font = '10px sans-serif';
    ctx.fillText(b.id, b.corners[0].screen[0], b.corners[0].screen[1] - 3);
  });
  /* 关系连线 */
  state.relations.forEach(function (r) {
    var a = view.annotations.find(function (x) { return x.id === r.from; });
    var b = view.annotations.find(function (x) { return x.id === r.to; });
    if (!a || !b || !a.screen || !b.screen) return;
    ctx.strokeStyle = r.type === 'reference' ? 'rgba(120,170,255,0.8)' : 'rgba(220,150,240,0.8)';
    ctx.setLineDash(r.type === 'reference' ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.screen[0], a.screen[1]);
    ctx.lineTo(b.screen[0], b.screen[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    var mx = (a.screen[0] + b.screen[0]) / 2, my = (a.screen[1] + b.screen[1]) / 2;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '9px sans-serif';
    ctx.fillText(r.type === 'reference' ? '引用' : '从属', mx + 3, my - 3);
  });
  /* 标注标记 */
  view.annotations.forEach(function (a) {
    var p = a.screen, clamped = false;
    if (!p) return;
    var x = p[0], y = p[1];
    if (a.status === 'outside') {
      x = Math.max(10, Math.min(viewport.width - 10, x));
      y = Math.max(10, Math.min(viewport.height - 10, y));
      clamped = true;
    }
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLOR[a.status];
    if (a.status === 'occluded' || clamped) { ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1; }
    else ctx.fill();
    if (a.status === 'invalid') {
      ctx.strokeStyle = '#e07a7a';
      ctx.beginPath(); ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8); ctx.stroke();
    }
    if (a.conflicted) {
      ctx.strokeStyle = '#e08ad0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
    }
    if (a.id === selectedAnn) {
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#e6ebf0';
    ctx.font = '11px sans-serif';
    ctx.fillText(a.id + (clamped ? '(视窗外)' : ''), x + 9, y - 7);
  });
}
function resize() {
  var r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  viewport.width = r.width; viewport.height = r.height;
}
function refresh() {
  var view = Core.computeView(state, camera, viewport);
  drawScene(view);
  refreshTree();
  refreshAnnotations(view);
  refreshConflicts();
  refreshLog();
}

/* ---------------- 交互 ---------------- */
var dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', function () { dragging = false; });
window.addEventListener('mousemove', function (e) {
  if (!dragging) return;
  camera.yaw += (e.clientX - lastX) * 0.4;
  camera.pitch = Math.max(-85, Math.min(85, camera.pitch + (e.clientY - lastY) * 0.3));
  lastX = e.clientX; lastY = e.clientY;
  refresh();
});
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  camera.distance = Math.max(5, Math.min(120, camera.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
  refresh();
}, { passive: false });
canvas.addEventListener('dblclick', function (e) {
  /* 拾取最近的标注标记 */
  var view = Core.computeView(state, camera, viewport);
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top, best = null, bd = 18;
  view.annotations.forEach(function (a) {
    if (!a.screen) return;
    var d = Math.hypot(a.screen[0] - mx, a.screen[1] - my);
    if (d < bd) { bd = d; best = a; }
  });
  if (best) { selectedAnn = best.id; selectedObject = best.objectId; refresh(); }
});
window.addEventListener('resize', function () { resize(); refresh(); });
document.getElementById('btnResetCam').onclick = function () {
  camera = { target: [0, 1.5, 0], yaw: 35, pitch: 25, distance: 34 };
  refresh();
};
function needObject() {
  if (selectedObject && state.objects.has(selectedObject) && !state.objects.get(selectedObject).removed) return true;
  state.log.push({ seq: ++state.seq, kind: 'reject', message: '请先在左侧层级树中选中一个未删除的对象' });
  refreshLog();
  return false;
}
document.querySelectorAll('[data-move]').forEach(function (b) {
  b.onclick = function () {
    if (!needObject()) return;
    var d = b.dataset.move.split(',').map(Number);
    var o = state.objects.get(selectedObject);
    Core.transformObject(state, selectedObject,
      { position: [o.position[0] + d[0], o.position[1] + d[1], o.position[2] + d[2]] });
    refresh();
  };
});
document.querySelectorAll('[data-rot]').forEach(function (b) {
  b.onclick = function () {
    if (!needObject()) return;
    var d = b.dataset.rot.split(',').map(Number);
    var o = state.objects.get(selectedObject);
    Core.transformObject(state, selectedObject,
      { rotation: [o.rotation[0] + d[0], o.rotation[1] + d[1], o.rotation[2] + d[2]] });
    refresh();
  };
});
document.querySelectorAll('[data-scale]').forEach(function (b) {
  b.onclick = function () {
    if (!needObject()) return;
    var f = Number(b.dataset.scale);
    var o = state.objects.get(selectedObject);
    Core.transformObject(state, selectedObject,
      { scale: [o.scale[0] * f, o.scale[1] * f, o.scale[2] * f] });
    refresh();
  };
});
document.getElementById('btnDelete').onclick = function () {
  if (!needObject()) return;
  Core.deleteObject(state, selectedObject);
  refresh();
};
document.getElementById('btnReparent').onclick = function () {
  if (!needObject()) return;
  var v = document.getElementById('reparentTarget').value;
  Core.reparentObject(state, selectedObject, v === '(根)' ? null : v);
  refresh();
};
document.getElementById('btnAddAnn').onclick = function () {
  if (!needObject()) return;
  var anchor = document.getElementById('annAnchor').value.split(',').map(Number);
  Core.addAnnotation(state, {
    id: document.getElementById('annId').value.trim(),
    objectId: selectedObject,
    anchor: anchor,
    text: document.getElementById('annText').value
  }, document.getElementById('annSource').value.trim() || '审阅人A');
  refresh();
};
document.getElementById('btnConflict').onclick = function () {
  if (!selectedAnn || !state.annotations.has(selectedAnn)) {
    state.log.push({ seq: ++state.seq, kind: 'reject', message: '请先在右侧标注列表中选中一条标注' });
    refreshLog(); return;
  }
  var ann = state.annotations.get(selectedAnn);
  var v = ann.versions[0];
  Core.addAnnotation(state, {
    id: selectedAnn, objectId: ann.objectId,
    anchor: [v.anchor[0] + 0.5, v.anchor[1], v.anchor[2]],
    text: v.text + '(另一来源的修改)'
  }, '审阅人B');
  refresh();
};
document.getElementById('btnAddRel').onclick = function () {
  Core.addRelation(state,
    document.getElementById('relFrom').value.trim(),
    document.getElementById('relTo').value.trim(),
    document.getElementById('relType').value);
  refresh();
};

/* ---------------- 启动 ---------------- */
seed();
resize();
refresh();
