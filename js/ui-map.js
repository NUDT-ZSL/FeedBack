/* ui-map.js — 画布渲染与范围图形拖拽 */
window.UI = window.UI || {};
(function () {
'use strict';
const MARGIN = 30, SIZE = 560, SCALE = (SIZE - 2 * MARGIN) / 100;
const PALETTE = ['#2f6db3', '#e07b00', '#2e9e5b', '#8e44ad', '#c0392b'];

function toCanvas(p) { return { x: MARGIN + p.x * SCALE, y: SIZE - MARGIN - p.y * SCALE }; }
function toWorld(p) { return { x: (p.x - MARGIN) / SCALE, y: (SIZE - MARGIN - p.y) / SCALE }; }
function qColor(idx) { return PALETTE[idx % PALETTE.length]; }

function handleOf(shape) {
  if (shape.type === 'circle') return { x: shape.cx + shape.r, y: shape.cy };
  return { x: shape.maxX, y: shape.minY };
}

UI.drawMap = function () {
  const cv = document.getElementById('map');
  const ctx = cv.getContext('2d');
  const st = UI.state;
  ctx.clearRect(0, 0, SIZE, SIZE);
  // 网格与世界边界
  ctx.strokeStyle = '#eee'; ctx.fillStyle = '#999'; ctx.font = '10px sans-serif';
  for (let g = 0; g <= 100; g += 10) {
    const a = toCanvas({ x: g, y: 0 }), b = toCanvas({ x: g, y: 100 });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = toCanvas({ x: 0, y: g }), d = toCanvas({ x: 100, y: g });
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    ctx.fillText(g, a.x - 4, SIZE - MARGIN + 12);
    ctx.fillText(g, 6, toCanvas({ x: 0, y: g }).y + 3);
  }
  const w = st.engine.world;
  const p1 = toCanvas({ x: w.minX, y: w.maxY }), p2 = toCanvas({ x: w.maxX, y: w.minY });
  ctx.strokeStyle = '#333'; ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

  // 查询范围
  const queries = st.engine.queryList();
  queries.forEach(function (q, i) {
    const col = qColor(i); const sel = q.id === st.selectedQueryId;
    ctx.strokeStyle = col; ctx.lineWidth = sel ? 3 : 1.5;
    ctx.fillStyle = col + '22';
    const s = q.shape;
    ctx.beginPath();
    if (s.type === 'circle') {
      const c = toCanvas({ x: s.cx, y: s.cy });
      ctx.arc(c.x, c.y, s.r * SCALE, 0, Math.PI * 2);
    } else {
      const a = toCanvas({ x: s.minX, y: s.maxY });
      ctx.rect(a.x, a.y, (s.maxX - s.minX) * SCALE, (s.maxY - s.minY) * SCALE);
    }
    ctx.fill(); ctx.stroke();
    const cc = toCanvas(GeoEngine._internal.shapeCenter(s));
    ctx.fillStyle = col; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(q.id, cc.x - 8, cc.y - 6);
    // 手柄
    const h = toCanvas(handleOf(s));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1;
  });

  // 对象
  const result = st.selectedQueryId ? st.engine.results.get(st.selectedQueryId) : null;
  const hitIds = result ? new Set(result.hits.map(function (h) { return h.objectId; })) : new Set();
  for (const res of st.engine.resolutions.values()) {
    const c = res.fields.coord.value;
    if (!c) { continue; }
    const p = toCanvas(c);
    ctx.beginPath(); ctx.arc(p.x, p.y, res.trusted ? 5 : 6, 0, Math.PI * 2);
    if (!res.trusted) { ctx.fillStyle = '#e74c3c'; }
    else if (hitIds.has(res.id)) { ctx.fillStyle = '#27ae60'; }
    else { ctx.fillStyle = '#95a5a6'; }
    ctx.fill();
    if (res.id === st.selectedObjectId) { ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    ctx.fillStyle = '#333'; ctx.font = '10px sans-serif';
    ctx.fillText(res.id.replace('obj-', ''), p.x + 7, p.y + 3);
    if (!res.trusted) { ctx.fillStyle = '#e74c3c'; ctx.fillText('⚠', p.x - 3, p.y - 9); }
  }
};
// 鼠标交互：拖动移动范围、拖手柄调整大小、点击对象选中
UI.bindMapEvents = function () {
  const cv = document.getElementById('map');
  let drag = null; // {queryId, mode:'move'|'resize', dx, dy}

  function pos(e) {
    const r = cv.getBoundingClientRect();
    return toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  }
  function near(a, b, t) { return Math.hypot(a.x - b.x, a.y - b.y) <= t; }

  cv.addEventListener('mousedown', function (e) {
    const w = pos(e); const st = UI.state;
    const queries = st.engine.queryList();
    for (const q of queries) {
      if (near(w, handleOf(q.shape), 2.5)) { drag = { queryId: q.id, mode: 'resize' }; return; }
    }
    for (const q of queries) {
      if (GeoEngine._internal.containsPoint(q.shape, w)) {
        const c = GeoEngine._internal.shapeCenter(q.shape);
        drag = { queryId: q.id, mode: 'move', dx: w.x - c.x, dy: w.y - c.y };
        UI.selectQuery(q.id);
        return;
      }
    }
    let best = null, bd = 3;
    for (const res of st.engine.resolutions.values()) {
      const c = res.fields.coord.value;
      if (c && near(w, c, bd)) { best = res.id; bd = Math.hypot(w.x - c.x, w.y - c.y); }
    }
    if (best) UI.selectObject(best);
  });

  cv.addEventListener('mousemove', function (e) {
    if (!drag) return;
    drag.moved = true;
    const w = pos(e); const st = UI.state;
    const q = st.engine.queries.get(drag.queryId);
    const s = q.shape;
    if (drag.mode === 'move') {
      if (s.type === 'circle') { s.cx = +(w.x - drag.dx).toFixed(1); s.cy = +(w.y - drag.dy).toFixed(1); }
      else {
        const hw = (s.maxX - s.minX) / 2, hh = (s.maxY - s.minY) / 2;
        const nx = +(w.x - drag.dx).toFixed(1), ny = +(w.y - drag.dy).toFixed(1);
        s.minX = +(nx - hw).toFixed(1); s.maxX = +(nx + hw).toFixed(1);
        s.minY = +(ny - hh).toFixed(1); s.maxY = +(ny + hh).toFixed(1);
      }
    } else {
      if (s.type === 'circle') {
        s.r = Math.max(1, +Math.hypot(w.x - s.cx, w.y - s.cy).toFixed(1));
      } else {
        s.maxX = Math.max(s.minX + 1, +w.x.toFixed(1));
        s.minY = Math.min(s.maxY - 1, +w.y.toFixed(1));
      }
    }
    UI.drawMap();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    if (!drag.moved) { drag = null; return; }
    const q = UI.state.engine.queries.get(drag.queryId);
    drag = null;
    UI.applyEvent({ type: 'updateQuery', query: JSON.parse(JSON.stringify(q)) },
      '拖动调整范围 ' + q.id);
  });
};

})();
