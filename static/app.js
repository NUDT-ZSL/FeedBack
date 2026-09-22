/* 前端主逻辑：Canvas 地图、围栏编辑、轨迹导入、推演与时间轴展示 */
(function () {
'use strict';
const E = window.GeoEngine;
const $ = function (id) { return document.getElementById(id); };
const canvas = $('map');
const ctx = canvas.getContext('2d');

const state = {
  fences: [],          // {id,name,color,priority,polygon,rules}
  rawPoints: [],       // 原始导入的轨迹记录
  result: null,        // 推演结果 {events,skipped,points}
  selectedFenceId: null,
  mode: 'pan',         // pan | draw
  drawing: [],         // 正在绘制的顶点
  view: { lat: 31.23, lng: 121.47, scale: 8000 }, // scale: px/度
  highlightEvent: null
};

let uid = 1;
function nextId() { return 'F' + (uid++) + '_' + Date.now().toString(36); }

/* ---------- 投影（等距圆柱，局部范围足够精确） ---------- */
function toScreen(lat, lng) {
  const v = state.view;
  const w = canvas.width, h = canvas.height;
  const x = w / 2 + (lng - v.lng) * v.scale * Math.cos(v.lat * Math.PI / 180);
  const y = h / 2 - (lat - v.lat) * v.scale;
  return [x, y];
}
function toLatLng(x, y) {
  const v = state.view;
  const w = canvas.width, h = canvas.height;
  return [
    v.lat - (y - h / 2) / v.scale,
    v.lng + (x - w / 2) / (v.scale * Math.cos(v.lat * Math.PI / 180))
  ];
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  render();
}
window.addEventListener('resize', resize);

/* ---------- 渲染 ---------- */
const EVENT_COLORS = { enter: '#2e9e4f', exit: '#c0392b', dwell: '#e67e22', overspeed: '#8e44ad' };

function render() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawGrid();
  for (const f of state.fences) drawFence(f);
  drawDrawing();
  drawTrack();
  drawEvents();
}

function drawGrid() {
  const v = state.view;
  const stepDeg = Math.pow(10, Math.ceil(Math.log10(80 / v.scale))) / 10;
  ctx.strokeStyle = '#d5dde4'; ctx.fillStyle = '#8899aa'; ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  const tl = toLatLng(0, 0), br = toLatLng(canvas.width, canvas.height);
  for (let lat = Math.floor(br[0] / stepDeg) * stepDeg; lat <= tl[0]; lat += stepDeg) {
    const y = toScreen(lat, 0)[1];
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    ctx.fillText(lat.toFixed(4) + '°', 4, y - 2);
  }
  for (let lng = Math.floor(tl[1] / stepDeg) * stepDeg; lng <= br[1]; lng += stepDeg) {
    const x = toScreen(0, lng)[0];
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    ctx.fillText(lng.toFixed(4) + '°', x + 2, canvas.height - 4);
  }
}

function drawFence(f) {
  const pts = f.polygon.map(function (p) { return toScreen(p[0], p[1]); });
  ctx.beginPath();
  pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
  ctx.closePath();
  ctx.fillStyle = f.color + '33';
  ctx.fill();
  ctx.strokeStyle = f.color;
  ctx.lineWidth = (f.id === state.selectedFenceId) ? 3 : 1.5;
  ctx.stroke();
  if (f.id === state.selectedFenceId) {
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  const c = pts.reduce(function (a, p) { return [a[0] + p[0], a[1] + p[1]]; }, [0, 0]);
  ctx.fillStyle = f.color; ctx.font = 'bold 12px sans-serif';
  ctx.fillText(f.name + ' (P' + f.priority + ')', c[0] / pts.length - 20, c[1] / pts.length);
}

function drawDrawing() {
  if (!state.drawing.length) return;
  const pts = state.drawing.map(function (p) { return toScreen(p[0], p[1]); });
  ctx.beginPath();
  pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
  ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke();
  ctx.setLineDash([]);
  for (const p of pts) {
    ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb020'; ctx.fill();
  }
}

function drawTrack() {
  const pts = state.result ? state.result.points : [];
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach(function (p, i) {
    const s = toScreen(p.lat, p.lng);
    i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
  });
  ctx.strokeStyle = '#2266cc'; ctx.lineWidth = 1.5; ctx.stroke();
  pts.forEach(function (p, i) {
    const s = toScreen(p.lat, p.lng);
    ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#2e9e4f' : (i === pts.length - 1 ? '#c0392b' : '#2266cc');
    ctx.fill();
  });
}

function drawEvents() {
  const events = state.result ? state.result.events : [];
  for (const ev of events) {
    const s = toScreen(ev.lat, ev.lng);
    ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = EVENT_COLORS[ev.type] || '#333';
    ctx.fill();
    ctx.lineWidth = state.highlightEvent === ev ? 4 : 2;
    ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif';
    ctx.fillText(ev.type[0].toUpperCase(), s[0] - 3, s[1] + 3);
  }
}

/* ---------- 鼠标交互 ---------- */
let drag = null; // {kind:'pan'} | {kind:'vertex',fence,idx}

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function hitVertex(x, y) {
  const f = state.fences.find(function (g) { return g.id === state.selectedFenceId; });
  if (!f) return null;
  for (let i = 0; i < f.polygon.length; i++) {
    const s = toScreen(f.polygon[i][0], f.polygon[i][1]);
    if (Math.hypot(s[0] - x, s[1] - y) < 8) return { fence: f, idx: i };
  }
  return null;
}

canvas.addEventListener('mousedown', function (e) {
  const pos = canvasPos(e);
  if (state.mode === 'draw') {
    state.drawing.push(toLatLng(pos[0], pos[1]));
    render(); return;
  }
  const hit = hitVertex(pos[0], pos[1]);
  if (hit) { drag = { kind: 'vertex', fence: hit.fence, idx: hit.idx }; return; }
  // 点击围栏内部则选中
  const ll = toLatLng(pos[0], pos[1]);
  const f = state.fences.find(function (g) {
    return E.pointInPolygon(ll[0], ll[1], g.polygon);
  });
  if (f) { selectFence(f.id); }
  drag = { kind: 'pan', x: pos[0], y: pos[1] };
});

canvas.addEventListener('mousemove', function (e) {
  if (!drag) return;
  const pos = canvasPos(e);
  if (drag.kind === 'pan') {
    const v = state.view;
    v.lng -= (pos[0] - drag.x) / (v.scale * Math.cos(v.lat * Math.PI / 180));
    v.lat += (pos[1] - drag.y) / v.scale;
    drag.x = pos[0]; drag.y = pos[1];
  } else if (drag.kind === 'vertex') {
    drag.fence.polygon[drag.idx] = toLatLng(pos[0], pos[1]);
    scheduleReplay();
  }
  render();
});

window.addEventListener('mouseup', function () { drag = null; });

canvas.addEventListener('dblclick', function () {
  if (state.mode === 'draw' && state.drawing.length >= 3) finishDrawing();
});

canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  state.view.scale = Math.min(5e7, Math.max(50, state.view.scale * factor));
  render();
}, { passive: false });

window.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && state.mode === 'draw' && state.drawing.length >= 3) finishDrawing();
  if (e.key === 'Escape') { state.drawing = []; render(); }
});

function finishDrawing() {
  const palette = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0'];
  const f = {
    id: nextId(),
    name: '围栏' + (state.fences.length + 1),
    color: palette[state.fences.length % palette.length],
    priority: state.fences.length + 1,
    polygon: state.drawing.slice(),
    rules: E.defaultRules()
  };
  state.fences.push(f);
  state.drawing = [];
  setMode('pan');
  selectFence(f.id);
  scheduleReplay();
}

/* ---------- 围栏列表与编辑器 ---------- */
function selectedFence() {
  return state.fences.find(function (f) { return f.id === state.selectedFenceId; }) || null;
}

function selectFence(id) {
  state.selectedFenceId = id;
  renderFenceList();
  renderEditor();
  render();
}

function renderFenceList() {
  const box = $('fenceList');
  box.innerHTML = '';
  for (const f of state.fences) {
    const div = document.createElement('div');
    div.className = 'fence-item' + (f.id === state.selectedFenceId ? ' selected' : '');
    const sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = f.color;
    const label = document.createElement('span');
    label.textContent = f.name + ' · 优先级' + f.priority + ' · ' + f.polygon.length + '顶点';
    div.appendChild(sw); div.appendChild(label);
    div.onclick = function () { selectFence(f.id); };
    box.appendChild(div);
  }
}

function renderEditor() {
  const f = selectedFence();
  $('fenceEditor').classList.toggle('hidden', !f);
  if (!f) return;
  $('fName').value = f.name;
  $('fColor').value = f.color;
  $('fPriority').value = f.priority;
  $('rEnter').checked = !!f.rules.enter.enabled;
  $('rExit').checked = !!f.rules.exit.enabled;
  $('rDwell').checked = !!f.rules.dwell.enabled;
  $('rDwellSec').value = f.rules.dwell.timeoutSec;
  $('rOverspeed').checked = !!f.rules.overspeed.enabled;
  $('rSpeed').value = f.rules.overspeed.maxSpeedKmh;
  $('rMinDwell').value = f.rules.minDwellSec;
  $('rMinExit').value = f.rules.minExitSec;
}

function bindEditor() {
  function upd(fn) {
    return function () {
      const f = selectedFence();
      if (!f) return;
      fn(f);
      renderFenceList();
      scheduleReplay();
      render();
    };
  }
  $('fName').oninput = upd(function (f) { f.name = $('fName').value; });
  $('fColor').oninput = upd(function (f) { f.color = $('fColor').value; });
  $('fPriority').oninput = upd(function (f) { f.priority = Number($('fPriority').value) || 0; });
  $('rEnter').onchange = upd(function (f) { f.rules.enter.enabled = $('rEnter').checked; });
  $('rExit').onchange = upd(function (f) { f.rules.exit.enabled = $('rExit').checked; });
  $('rDwell').onchange = upd(function (f) { f.rules.dwell.enabled = $('rDwell').checked; });
  $('rDwellSec').oninput = upd(function (f) { f.rules.dwell.timeoutSec = Number($('rDwellSec').value) || 1; });
  $('rOverspeed').onchange = upd(function (f) { f.rules.overspeed.enabled = $('rOverspeed').checked; });
  $('rSpeed').oninput = upd(function (f) { f.rules.overspeed.maxSpeedKmh = Number($('rSpeed').value) || 1; });
  $('rMinDwell').oninput = upd(function (f) { f.rules.minDwellSec = Number($('rMinDwell').value) || 0; });
  $('rMinExit').oninput = upd(function (f) { f.rules.minExitSec = Number($('rMinExit').value) || 0; });
  $('btnDeleteFence').onclick = function () {
    state.fences = state.fences.filter(function (f) { return f.id !== state.selectedFenceId; });
    state.selectedFenceId = null;
    renderFenceList(); renderEditor(); scheduleReplay(); render();
  };
}

function setMode(m) {
  state.mode = m;
  state.drawing = [];
  $('btnPan').classList.toggle('active', m === 'pan');
  $('btnDraw').classList.toggle('active', m === 'draw');
  canvas.classList.toggle('drawing', m === 'draw');
  $('mapHint').textContent = m === 'draw'
    ? '单击添加顶点，双击或回车完成绘制，Esc 取消'
    : '拖拽平移，滚轮缩放；点击围栏选中，拖动顶点编辑形状';
  render();
}

/* ---------- 推演与时间轴 ---------- */
let replayTimer = null;
function scheduleReplay() {
  clearTimeout(replayTimer);
  replayTimer = setTimeout(replay, 250);
  saveState();
}

function replay() {
  state.result = E.simulate(state.fences, state.rawPoints);
  renderTimeline();
  renderSkipped();
  render();
}

const TYPE_NAMES = { enter: '进入', exit: '离开', dwell: '停留超时', overspeed: '超速' };

function renderTimeline() {
  const box = $('timeline');
  box.innerHTML = '';
  const events = state.result.events;
  $('eventCount').textContent = '(' + events.length + ' 条)';
  for (const ev of events) {
    const div = document.createElement('div');
    div.className = 'event ' + ev.type;
    const time = new Date(ev.t).toLocaleString('zh-CN', { hour12: false });
    let html = '<div class="head"><span class="badge ' + ev.type + '">' +
      TYPE_NAMES[ev.type] + '</span><span>' + time + '</span></div>' +
      '<div>围栏：' + ev.fenceName + ' @ ' + ev.lat.toFixed(5) + ',' + ev.lng.toFixed(5) + '</div>' +
      '<div class="reason">' + ev.reason + '</div>';
    if (ev.suppressed && ev.suppressed.length) {
      html += '<div class="suppressed">被压制的候选事件：' +
        ev.suppressed.map(function (s) {
          return '<div>· ' + s.fenceName + ' / ' + TYPE_NAMES[s.type] +
            ' — ' + s.suppressedReason + '</div>';
        }).join('') + '</div>';
    }
    div.innerHTML = html;
    div.onclick = function () {
      state.highlightEvent = ev;
      state.view.lat = ev.lat; state.view.lng = ev.lng;
      render();
    };
    box.appendChild(div);
  }
  const cascaded = state.result.suppressedCascade || [];
  if (cascaded.length) {
    const h = document.createElement('h3');
    h.textContent = '级联压制（不进入事件流）';
    box.appendChild(h);
    for (const ev of cascaded) {
      const div = document.createElement('div');
      div.className = 'event ' + ev.type;
      div.style.opacity = '0.55';
      div.innerHTML = '<div class="head"><span class="badge ' + ev.type + '">' +
        TYPE_NAMES[ev.type] + '</span><span>' +
        new Date(ev.t).toLocaleString('zh-CN', { hour12: false }) + '</span></div>' +
        '<div>围栏：' + ev.fenceName + '</div>' +
        '<div class="reason">' + ev.cascadeReason + '</div>';
      box.appendChild(div);
    }
  }
}

function renderSkipped() {
  const skipped = state.result.skipped;
  $('skippedBox').classList.toggle('hidden', !skipped.length);
  const ul = $('skippedList');
  ul.innerHTML = '';
  for (const s of skipped) {
    const li = document.createElement('li');
    li.textContent = '第 ' + (s.index + 1) + ' 条：' + s.reason;
    ul.appendChild(li);
  }
}

/* ---------- 轨迹导入 ---------- */
function parseTrackText(text) {
  text = text.trim();
  if (!text) return [];
  if (text[0] === '[') {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('JSON 顶层必须是数组');
    return arr;
  }
  return text.split(/\r?\n/).filter(function (l) { return l.trim(); })
    .map(function (line) {
      const c = line.split(',').map(function (s) { return s.trim(); });
      if (c.length < 3) return { raw: line }; // 触发“记录不是对象”类提示
      return { time: c[0], lat: c[1], lng: c[2] };
    });
}

function importTrack(text) {
  try {
    state.rawPoints = parseTrackText(text);
  } catch (err) {
    alert('导入失败：' + err.message);
    return;
  }
  replay();
  fitToTrack();
  saveState();
}

function fitToTrack() {
  const pts = state.result && state.result.points;
  if (!pts || !pts.length) return;
  const lats = pts.map(function (p) { return p.lat; });
  const lngs = pts.map(function (p) { return p.lng; });
  state.view.lat = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
  state.view.lng = (Math.min.apply(null, lngs) + Math.max.apply(null, lngs)) / 2;
  const span = Math.max(
    Math.max.apply(null, lats) - Math.min.apply(null, lats),
    Math.max.apply(null, lngs) - Math.min.apply(null, lngs), 0.005);
  state.view.scale = Math.min(canvas.width, canvas.height) / span * 0.7;
}

/* ---------- 示例数据 ---------- */
function loadSample() {
  state.fences = [
    { id: nextId(), name: '园区A', color: '#e6194b', priority: 1,
      polygon: [[31.232, 121.470], [31.232, 121.478], [31.238, 121.478], [31.238, 121.470]],
      rules: { enter: { enabled: true }, exit: { enabled: true },
        dwell: { enabled: true, timeoutSec: 30 },
        overspeed: { enabled: true, maxSpeedKmh: 30 },
        minDwellSec: 5, minExitSec: 5 } },
    { id: nextId(), name: '园区B(重叠)', color: '#4363d8', priority: 2,
      polygon: [[31.234, 121.470], [31.234, 121.483], [31.242, 121.483], [31.242, 121.470]],
      rules: E.defaultRules() }
  ];
  const t0 = Date.parse('2026-09-22T08:00:00Z');
  // 轨迹脚本：边界抖动 -> 稳定进入A/B(A优先，B进入被压制) -> 停留超时
  // -> 超速冲刺 -> 离开A -> 离开B(级联压制)。按 2~3s 间隔插值生成。
  const pts = [];
  let t = 0;
  function jump(lat, lng) {
    pts.push({ time: new Date(t0 + t * 1000).toISOString(), lat: lat, lng: lng });
  }
  function moveTo(lat, lng, durSec) {
    const last = pts[pts.length - 1];
    const steps = Math.max(1, Math.round(durSec / 2));
    for (let i = 1; i <= steps; i++) {
      const tt = t + durSec * i / steps;
      pts.push({ time: new Date(t0 + tt * 1000).toISOString(),
        lat: last.lat + (lat - last.lat) * i / steps,
        lng: last.lng + (lng - last.lng) * i / steps });
    }
    t += durSec;
  }
  jump(31.2350, 121.4685);                       // t=0 围栏外
  t = 4;  jump(31.2350, 121.4702);               // 边界抖动：短暂入内
  t = 6;  jump(31.2350, 121.4697);
  t = 9;  jump(31.2350, 121.4703);
  t = 11; jump(31.2350, 121.4696);
  moveTo(31.2352, 121.4720, 30);                 // 稳定走入 A（~17km/h）
  moveTo(31.2355, 121.4735, 30);                 // 园区内移动，触发停留超时
  moveTo(31.2357, 121.4755, 6);                  // 冲刺（~115km/h）触发超速
  moveTo(31.2358, 121.4757, 10);                 // 减速，结束超速段
  moveTo(31.2365, 121.4768, 30);                 // 驶向重叠区
  moveTo(31.2370, 121.4790, 40);                 // 离开 A，仍在 B 内
  moveTo(31.2375, 121.4810, 20);                 // B 独占区
  moveTo(31.2380, 121.4840, 20);                 // 离开 B（级联压制演示）
  moveTo(31.2385, 121.4850, 10);
  state.rawPoints = pts;
  state.rawPoints.push({ lat: 31.25, lng: 121.49 }); // 缺时间戳的无效点示例
  state.selectedFenceId = state.fences[0].id;
  renderFenceList(); renderEditor();
  replay(); fitToTrack(); saveState();
}

/* ---------- 持久化 ---------- */
function saveState() {
  try {
    localStorage.setItem('geofence-demo', JSON.stringify({
      fences: state.fences, rawPoints: state.rawPoints, view: state.view
    }));
  } catch (e) { /* 忽略存储失败 */ }
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem('geofence-demo') || 'null');
    if (!s) return false;
    state.fences = s.fences || [];
    state.rawPoints = s.rawPoints || [];
    if (s.view) state.view = s.view;
    state.selectedFenceId = state.fences.length ? state.fences[0].id : null;
    return state.fences.length > 0;
  } catch (e) { return false; }
}

/* ---------- 初始化 ---------- */
$('btnPan').onclick = function () { setMode('pan'); };
$('btnDraw').onclick = function () { setMode('draw'); };
$('btnImport').onclick = function () { importTrack($('trackInput').value); };
$('btnSample').onclick = loadSample;
$('btnReplay').onclick = replay;
$('btnClearTrack').onclick = function () {
  state.rawPoints = []; replay(); saveState();
};
$('fileInput').onchange = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = function () { $('trackInput').value = rd.result; importTrack(rd.result); };
  rd.readAsText(file);
};

bindEditor();
setMode('pan');
if (!loadState()) loadSample();
else { renderFenceList(); renderEditor(); replay(); }
resize();
})();
