/* ui-panels.js — 查询列表 / 查询结论 / 范围编辑面板 */
window.UI = window.UI || {};
(function () {
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
UI.esc = esc;

UI.renderQueryList = function () {
  const st = UI.state;
  const box = document.getElementById('query-list');
  box.innerHTML = st.engine.queryList().map(function (q) {
    const res = st.engine.results.get(q.id);
    const n = res ? res.hits.length : 0;
    const amb = res && res.ambiguities.length ? ' <span class="badge amb">歧义 ' + res.ambiguities.length + '</span>' : '';
    return '<div class="q-item' + (q.id === st.selectedQueryId ? ' selected' : '') +
      '" onclick="UI.selectQuery(\'' + esc(q.id) + '\')">' +
      '<span><b>' + esc(q.id) + '</b> ' + UI.shapeText(q.shape) + '</span>' +
      '<span>命中 ' + n + amb + '</span></div>';
  }).join('');
};

UI.shapeText = function (s) {
  if (s.type === 'circle') return '圆(' + s.cx + ',' + s.cy + ', r=' + s.r + ')';
  return '矩形[' + s.minX + ',' + s.minY + ' ~ ' + s.maxX + ',' + s.maxY + ']';
};

function shapeEditor(q) {
  const s = q.shape;
  if (s.type === 'circle') {
    return '圆心 x <input type="number" id="qe-cx" value="' + s.cx + '" step="0.5" style="width:60px">' +
      ' y <input type="number" id="qe-cy" value="' + s.cy + '" step="0.5" style="width:60px">' +
      ' 半径 <input type="number" id="qe-r" value="' + s.r + '" step="0.5" style="width:60px">';
  }
  return 'x <input type="number" id="qe-minx" value="' + s.minX + '" style="width:55px"> ~ ' +
    '<input type="number" id="qe-maxx" value="' + s.maxX + '" style="width:55px">' +
    ' y <input type="number" id="qe-miny" value="' + s.minY + '" style="width:55px"> ~ ' +
    '<input type="number" id="qe-maxy" value="' + s.maxY + '" style="width:55px">';
}

UI.applyQueryEdit = function (qid) {
  const st = UI.state;
  const q = JSON.parse(JSON.stringify(st.engine.queries.get(qid)));
  const v = function (id) { return parseFloat(document.getElementById(id).value); };
  if (q.shape.type === 'circle') {
    q.shape.cx = v('qe-cx'); q.shape.cy = v('qe-cy'); q.shape.r = v('qe-r');
  } else {
    q.shape.minX = v('qe-minx'); q.shape.maxX = v('qe-maxx');
    q.shape.minY = v('qe-miny'); q.shape.maxY = v('qe-maxy');
  }
  q.filters = q.filters || {};
  q.filters.categories = document.getElementById('qe-cats').value.split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  q.filters.asOf = document.getElementById('qe-asof').value || null;
  UI.applyEvent({ type: 'updateQuery', query: q }, '编辑查询条件 ' + qid);
};

UI.renderQueryDetail = function () {
  const st = UI.state;
  const box = document.getElementById('query-detail');
  const q = st.engine.queries.get(st.selectedQueryId);
  if (!q) { box.innerHTML = '请选择查询'; return; }
  const res = st.engine.results.get(q.id);
  let h = '<div class="form-grid">' + shapeEditor(q) +
    '<span>类别过滤 <input type="text" id="qe-cats" value="' + esc((q.filters.categories || []).join(',')) +
    '" placeholder="逗号分隔，空=不限" style="width:130px"></span>' +
    '<span>基准日 <input type="date" id="qe-asof" value="' + esc(q.filters.asOf || '') + '"></span>' +
    '<button onclick="UI.applyQueryEdit(\'' + esc(q.id) + '\')">应用修改</button></div>';
  h += '<h4>期望依据</h4><div class="basis">' + esc((q.expectedBasis || []).join('；') || '未声明') + '</div>';

  h += '<h4>命中对象（按邻近顺序）</h4>';
  if (!res.hits.length) h += '<div class="basis">无命中</div>';
  for (const hit of res.hits) {
    h += '<div class="hit-row" onclick="UI.selectObject(\'' + esc(hit.objectId) + '\')">' +
      '<b>#' + hit.rank + ' ' + esc(hit.objectId) + '</b> 距参照点 ' + hit.distance.toFixed(2) +
      (hit.ambiguities.length ? ' <span class="badge amb">压线</span>' : '') +
      '<div class="basis">依据：' + hit.basis.map(esc).join('；') + '</div></div>';
  }

  h += '<h4>排除对象及原因</h4>';
  for (const ex of res.excluded) {
    h += '<div class="exc-row" onclick="UI.selectObject(\'' + esc(ex.objectId) + '\')">' +
      '<b>' + esc(ex.objectId) + '</b><div class="basis">' + ex.basis.map(esc).join('；') + '</div></div>';
  }

  h += '<h4>歧义与可追溯说明</h4>';
  if (!res.ambiguities.length) h += '<div class="basis">无歧义</div>';
  for (const a of res.ambiguities) h += '<div class="amb-row">' + esc(a) + '</div>';
  box.innerHTML = h;
};

})();
