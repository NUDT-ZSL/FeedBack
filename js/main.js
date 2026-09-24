/* main.js — 启动、状态、事件应用、导入导出、一致性校验 */
window.UI = window.UI || {};
(function () {
'use strict';

UI.state = { engine: null, selectedQueryId: null, selectedObjectId: null };

UI.renderAll = function () {
  UI.drawMap();
  UI.renderQueryList();
  UI.renderQueryDetail();
  UI.renderObjectList();
  UI.renderObjectDetail();
};

UI.selectQuery = function (qid) {
  UI.state.selectedQueryId = qid;
  UI.renderAll();
};

UI.selectObject = function (oid) {
  UI.state.selectedObjectId = oid;
  UI.renderAll();
};

function logEvent(text, affected) {
  const li = document.createElement('li');
  li.textContent = text + ' → 受影响查询：' + (affected.length ? affected.join(', ') : '无');
  const list = document.getElementById('event-list');
  list.insertBefore(li, list.firstChild);
}

// 应用事件：引擎增量重推，界面立即刷新
UI.applyEvent = function (evt, label) {
  try {
    const r = UI.state.engine.applyEvent(evt);
    logEvent(label || evt.type, r.affectedQueries);
    UI.renderAll();
  } catch (err) {
    logEvent('事件失败：' + err.message, []);
  }
};

UI.loadData = function (data) {
  UI.state.engine = new GeoEngine.Engine(data.world);
  UI.state.engine.importData(data);
  UI.state.selectedQueryId = UI.state.engine.queryList()[0] ? UI.state.engine.queryList()[0].id : null;
  UI.state.selectedObjectId = null;
  document.getElementById('event-list').innerHTML = '';
  logEvent('导入数据：对象 ' + new Set(data.objects.map(function (o) { return o.objectId; })).size +
    ' 个，查询 ' + data.queries.length + ' 个', UI.state.engine.queryList().map(function (q) { return q.id; }));
  UI.renderAll();
};

// 一致性校验：当前增量结果 vs 整体重推
UI.verifyConsistency = function () {
  const eng = UI.state.engine;
  const before = JSON.stringify(Array.from(eng.results.entries()).sort());
  eng.fullRecompute();
  const after = JSON.stringify(Array.from(eng.results.entries()).sort());
  const ok = before === after;
  const el = document.getElementById('verify-result');
  el.textContent = ok ? '✔ 增量结果与整体重推一致' : '✘ 不一致，已整体重推纠正';
  el.style.color = ok ? '#7CFC90' : '#ff8080';
  UI.renderAll();
};

UI.exportState = function () {
  const eng = UI.state.engine;
  const data = {
    world: eng.world,
    objects: Array.from(eng.objects.values()).reduce(function (a, o) { return a.concat(o.records); }, []),
    queries: eng.queryList(),
    adjudications: Array.from(eng.objects.values()).filter(function (o) {
      return Object.keys(o.adjudications).length;
    }).map(function (o) { return { objectId: o.id, adjudications: o.adjudications }; }),
    events: eng.events
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'geo-state.json';
  a.click();
};

window.addEventListener('DOMContentLoaded', function () {
  UI.bindMapEvents();
  document.getElementById('btn-sample').onclick = function () { UI.loadData(window.SAMPLE_DATA); };
  document.getElementById('btn-export').onclick = UI.exportState;
  document.getElementById('btn-verify').onclick = UI.verifyConsistency;
  document.getElementById('file-import').addEventListener('change', function (e) {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = function () {
      try { UI.loadData(JSON.parse(rd.result)); }
      catch (err) { logEvent('导入失败：' + err.message, []); }
    };
    rd.readAsText(f);
  });
  UI.loadData(window.SAMPLE_DATA); // 启动即进入可操作界面
});

})();
