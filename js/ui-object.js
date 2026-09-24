/* ui-object.js — 对象列表 / 来源留痕 / 人工裁决 / 修正与撤回 */
window.UI = window.UI || {};
(function () {
'use strict';
const esc = function (s) { return UI.esc(s); };

UI.renderObjectList = function () {
  const st = UI.state;
  const box = document.getElementById('object-list');
  const rows = [];
  for (const res of st.engine.resolutions.values()) {
    const badge = res.trusted ? '<span class="badge ok">可信</span>'
      : '<span class="badge bad">不可信 ' + res.untrustedReasons.length + '</span>';
    rows.push('<div class="o-item' + (res.id === st.selectedObjectId ? ' selected' : '') +
      '" onclick="UI.selectObject(\'' + esc(res.id) + '\')"><span>' + esc(res.id) + '</span>' + badge + '</div>');
  }
  box.innerHTML = rows.join('');
};

function coordText(c) { return c ? '(' + c.x + ',' + c.y + ')' : '—'; }

function adjudicateRow(res, field, label) {
  const f = res.fields[field];
  if (f.status !== 'contested') return '';
  const opts = f.candidates.filter(function (g) { return g.value != null; }).map(function (g, i) {
    return '<option value="' + i + '">' + esc(JSON.stringify(g.value)) + ' ← ' + esc(g.sources.join(',')) + '</option>';
  }).join('');
  return '<div class="adj-row">' + label + '矛盾：<select id="adj-' + field + '">' + opts + '</select>' +
    ' <button onclick="UI.adjudicate(\'' + esc(res.id) + '\',\'' + field + '\')">裁决采用</button></div>';
}

UI.adjudicate = function (objId, field) {
  const res = UI.state.engine.resolutions.get(objId);
  const idx = parseInt(document.getElementById('adj-' + field).value, 10);
  const cand = res.fields[field].candidates.filter(function (g) { return g.value != null; })[idx];
  UI.applyEvent({ type: 'adjudicate', objectId: objId, field: field, value: cand.value, by: '界面人工裁决' },
    '裁决 ' + objId + '.' + field + ' = ' + JSON.stringify(cand.value));
};

UI.withdrawSource = function (objId, source) {
  UI.applyEvent({ type: 'withdraw', objectId: objId, source: source }, '撤回来源 ' + objId + '/' + source);
};

UI.submitCorrection = function (objId) {
  const v = function (id) { return document.getElementById(id).value.trim(); };
  const rec = {
    objectId: objId,
    source: v('cf-source') || ('manual-' + Date.now()),
    category: v('cf-category') || null,
    validFrom: v('cf-from') || null,
    validTo: v('cf-to') || null,
    note: '界面修正录入'
  };
  const x = parseFloat(v('cf-x')), y = parseFloat(v('cf-y'));
  if (!isNaN(x) && !isNaN(y)) rec.coord = { x: x, y: y };
  UI.applyEvent({ type: 'correct', record: rec }, '修正/补充来源 ' + objId + '/' + rec.source);
};

UI.renderObjectDetail = function () {
  const st = UI.state;
  const box = document.getElementById('object-detail');
  const res = st.engine.resolutions.get(st.selectedObjectId);
  if (!res) { box.innerHTML = '请选择对象'; return; }
  let h = '<div><b>' + esc(res.id) + '</b> ' +
    (res.trusted ? '<span class="badge ok">可信，参与邻近排序</span>'
                 : '<span class="badge bad">不可信，不参与邻近排序</span>') + '</div>';
  if (res.untrustedReasons.length) {
    h += '<h4>不可信原因</h4>' + res.untrustedReasons.map(function (r) {
      return '<div class="conflict">⚠ ' + esc(r) + '</div>'; }).join('');
  }
  if (res.conflicts.length) {
    h += '<h4>来源冲突（全部保留，未静默择一）</h4>' + res.conflicts.map(function (c) {
      return '<div class="amb-row">' + esc(c) + '</div>'; }).join('');
  }
  const adjRows = adjudicateRow(res, 'coord', '坐标') + adjudicateRow(res, 'category', '类别') +
    adjudicateRow(res, 'validFrom', '有效期起') + adjudicateRow(res, 'validTo', '有效期止');
  if (adjRows) h += '<h4>人工裁决</h4>' + adjRows;
  const adjKeys = Object.keys(res.adjudications || {});
  if (adjKeys.length) {
    h += '<h4>已生效裁决</h4>' + adjKeys.map(function (k) {
      const a = res.adjudications[k];
      return '<div class="basis">' + esc(k) + ' = ' + esc(JSON.stringify(a.value)) +
        '（' + esc(a.by) + ' @ ' + esc(a.at) + '）</div>';
    }).join('');
  }
  h += '<h4>来源记录（' + res.activeRecords.length + ' 在册 / ' + res.withdrawnRecords.length + ' 已撤回）</h4>';
  for (const r of res.activeRecords) {
    h += '<div class="rec"><b>' + esc(r.source) + '</b> 坐标 ' + coordText(r.coord) +
      ' 类别 ' + esc(r.category || '—') + ' 有效期 ' + esc(r.validFrom || '?') + '~' + esc(r.validTo || '?') +
      ' <span class="basis">' + esc(r.note || '') + '</span>' +
      ' <button onclick="UI.withdrawSource(\'' + esc(res.id) + '\',\'' + esc(r.source) + '\')">撤回</button></div>';
  }
  for (const r of res.withdrawnRecords) {
    h += '<div class="rec withdrawn"><b>' + esc(r.source) + '</b>（已撤回，仅留痕）坐标 ' + coordText(r.coord) +
      ' 类别 ' + esc(r.category || '—') + '</div>';
  }
  h += '<h4>修正 / 补充来源</h4><div class="form-grid">' +
    '<span>来源名 <input type="text" id="cf-source" placeholder="如 manual-2"></span>' +
    '<span>坐标 x <input type="number" id="cf-x" step="0.5" style="width:60px"> y <input type="number" id="cf-y" step="0.5" style="width:60px"></span>' +
    '<span>类别 <input type="text" id="cf-category" style="width:80px"></span>' +
    '<span>有效期 <input type="date" id="cf-from"> ~ <input type="date" id="cf-to"></span>' +
    '<button onclick="UI.submitCorrection(\'' + esc(res.id) + '\')">提交修正</button></div>';
  box.innerHTML = h;
};

})();
