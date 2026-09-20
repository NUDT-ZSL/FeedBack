/* UI 层：状态管理、增量重推、渲染。依赖 engine.js 的 Engine。 */
(function () {
  'use strict';
  const LS_KEY = 'coordtool.state.v1';
  let uidCounter = 1;
  function uid(prefix) { return prefix + Date.now().toString(36) + (uidCounter++); }

  function seedState() {
    const chain1 = {
      id: 'c-seed-1', name: 'WGS84 -> GCJ02 -> BD09',
      datumCorrections: { 'CGCS2000': { dEast: 0.4, dNorth: -0.3, loss: 0.2 } },
      steps: [
        { id: 's-seed-1', name: 'WGS84转GCJ02', src: 'WGS84', dst: 'GCJ02', loss: 0.3 },
        { id: 's-seed-2', name: 'GCJ02转BD09', src: 'GCJ02', dst: 'BD09', loss: 0.5 }
      ]
    };
    const chain2 = {
      id: 'c-seed-2', name: 'WGS84 -> Web墨卡托',
      datumCorrections: {},
      steps: [
        { id: 's-seed-3', name: 'WGS84转Web墨卡托', src: 'WGS84', dst: 'WEBMERC', loss: 0.1 }
      ]
    };
    return {
      points: [
        { id: 'p-seed-1', name: '北京某测点', rep: 'WGS84', datum: 'CGCS2000', lat: 39.9042, lng: 116.4074, accuracy: 1.0, chainId: 'c-seed-1' },
        { id: 'p-seed-2', name: '上海某测点', rep: 'WGS84', datum: 'WGS84', lat: 31.2304, lng: 121.4737, accuracy: 2.5, chainId: 'c-seed-1' },
        { id: 'p-seed-3', name: '广州某测点', rep: 'WGS84', datum: 'WGS84', lat: 23.1291, lng: 113.2644, accuracy: 0.8, chainId: 'c-seed-2' }
      ],
      chains: [chain1, chain2],
      selectedPointId: 'p-seed-1',
      selectedChainId: 'c-seed-1'
    };
  }

  let state = null;
  let traces = {};

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { state = JSON.parse(raw); return; }
    } catch (e) { /* 损坏则重建 */ }
    state = seedState();
    save();
  }
  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function log(msg) {
    document.getElementById('log').textContent = msg;
  }

  /* 全量重推（初始化/兜底用）。 */
  function fullRecompute() {
    traces = Engine.recomputeAll(state.points, state.chains);
  }

  /* 增量重推：只重算受影响点，并校验与全量一致。 */
  function applyChange(change, desc) {
    const v = Engine.verifyConsistent(state.points, state.chains, change);
    v.affectedIds.forEach(function (id) { traces[id] = v.traces[id]; });
    save();
    renderAll();
    log((desc || '变更') + '：增量重推 ' + v.affectedIds.length +
        ' 个点（' + v.affectedIds.join(', ') + '），与全量重推' + (v.ok ? '一致' : '不一致！'));
  }

  function pointById(id) {
    return state.points.filter(function (p) { return p.id === id; })[0] || null;
  }
  function chainById(id) {
    return state.chains.filter(function (c) { return c.id === id; })[0] || null;
  }

  function fmtCoord(v, rep) {
    return rep === 'WEBMERC' ? v.toFixed(2) : v.toFixed(7);
  }
  function coordText(coord, rep) {
    return fmtCoord(coord.lat, rep) + ', ' + fmtCoord(coord.lng, rep);
  }
  function fmtAcc(v) { return v.toFixed(3); }

  /* ---------- 渲染：点列表 ---------- */
  function renderPoints() {
    const tbody = document.querySelector('#points-table tbody');
    tbody.innerHTML = '';
    state.points.forEach(function (p) {
      const t = traces[p.id];
      const tr = document.createElement('tr');
      if (p.id === state.selectedPointId) tr.className = 'selected';
      let result;
      if (!t || t.status !== 'ok') {
        tr.className += (tr.className ? ' ' : '') + 'broken';
        result = '断链@' + (t && t.breakIndex >= 0 ? '第' + (t.breakIndex + 1) + '步' : '-');
      } else {
        result = t.final.rep + ' ±' + fmtAcc(t.final.accuracy) + 'm';
      }
      const chain = chainById(p.chainId);
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
      const cells = tr.children;
      cells[0].textContent = p.name;
      cells[1].textContent = p.rep;
      cells[2].textContent = p.datum;
      cells[3].textContent = p.accuracy;
      cells[4].textContent = chain ? chain.name : '(无链)';
      cells[5].textContent = result;
      tr.addEventListener('click', function () {
        state.selectedPointId = p.id;
        save();
        renderAll();
      });
      tbody.appendChild(tr);
    });
  }

  /* ---------- 渲染：点编辑表单 ---------- */
  const pointForm = document.getElementById('point-form');
  function fillRepSelect(sel, value) {
    sel.innerHTML = '';
    Engine.REPS.forEach(function (r) {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      sel.appendChild(o);
    });
    if (value) sel.value = value;
  }
  function fillChainSelect(sel, value) {
    sel.innerHTML = '';
    state.chains.forEach(function (c) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    if (value && chainById(value)) sel.value = value;
  }
  function renderPointForm() {
    const p = pointById(state.selectedPointId);
    document.getElementById('point-form-title').textContent = p ? '编辑点：' + p.name : '新增点';
    fillRepSelect(pointForm.elements.rep, p ? p.rep : 'WGS84');
    fillChainSelect(pointForm.elements.chainId, p ? p.chainId : (state.chains[0] && state.chains[0].id));
    pointForm.elements.name.value = p ? p.name : '';
    pointForm.elements.datum.value = p ? p.datum : 'WGS84';
    pointForm.elements.lat.value = p ? p.lat : '';
    pointForm.elements.lng.value = p ? p.lng : '';
    pointForm.elements.accuracy.value = p ? p.accuracy : 1.0;
    const dl = document.getElementById('datum-list');
    dl.innerHTML = '';
    const datums = {};
    state.points.forEach(function (q) { datums[q.datum] = 1; });
    state.chains.forEach(function (c) {
      Object.keys(c.datumCorrections || {}).forEach(function (d) { datums[d] = 1; });
    });
    Object.keys(datums).forEach(function (d) {
      const o = document.createElement('option');
      o.value = d;
      dl.appendChild(o);
    });
  }

  /* ---------- 渲染：链编辑器 ---------- */
  function renderChainEditor() {
    const sel = document.getElementById('chain-select');
    sel.innerHTML = '';
    state.chains.forEach(function (c) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    const chain = chainById(state.selectedChainId) || state.chains[0];
    if (!chain) {
      document.getElementById('chain-name').value = '';
      return;
    }
    state.selectedChainId = chain.id;
    sel.value = chain.id;
    document.getElementById('chain-name').value = chain.name;

    const issuesBox = document.getElementById('chain-issues');
    issuesBox.innerHTML = '';
    Engine.validateChain(chain).forEach(function (msg) {
      const d = document.createElement('div');
      d.textContent = '⚠ ' + msg;
      issuesBox.appendChild(d);
    });

    const tbody = document.querySelector('#steps-table tbody');
    tbody.innerHTML = '';
    chain.steps.forEach(function (st, i) {
      const tr = document.createElement('tr');
      const tdIdx = document.createElement('td');
      tdIdx.textContent = i + 1;
      tr.appendChild(tdIdx);
      tr.appendChild(inputCell(st.name, function (v) {
        st.name = v;
        applyChange({ type: 'step', chainId: chain.id }, '步骤改名');
      }));
      tr.appendChild(selectCell(st.src, function (v) {
        st.src = v;
        applyChange({ type: 'step', chainId: chain.id }, '步骤源表示修改');
      }));
      tr.appendChild(selectCell(st.dst, function (v) {
        st.dst = v;
        applyChange({ type: 'step', chainId: chain.id }, '步骤目标表示修改');
      }));
      tr.appendChild(inputCell(st.loss, function (v) {
        st.loss = parseFloat(v) || 0;
        applyChange({ type: 'step', chainId: chain.id }, '步骤损失修改');
      }, 'number'));
      const tdOps = document.createElement('td');
      const up = document.createElement('button');
      up.textContent = '↑'; up.className = 'small';
      up.addEventListener('click', function () {
        if (i === 0) return;
        chain.steps.splice(i - 1, 0, chain.steps.splice(i, 1)[0]);
        applyChange({ type: 'step', chainId: chain.id }, '步骤顺序调整');
      });
      const del = document.createElement('button');
      del.textContent = '删'; del.className = 'small danger';
      del.addEventListener('click', function () {
        chain.steps.splice(i, 1);
        applyChange({ type: 'step', chainId: chain.id }, '步骤删除');
      });
      tdOps.appendChild(up); tdOps.appendChild(del);
      tr.appendChild(tdOps);
      tbody.appendChild(tr);
    });

    const dtbody = document.querySelector('#datum-table tbody');
    dtbody.innerHTML = '';
    Object.keys(chain.datumCorrections || {}).forEach(function (datum) {
      const dc = chain.datumCorrections[datum];
      const tr = document.createElement('tr');
      tr.appendChild(inputCell(datum, function (v) {
        v = v.trim();
        if (!v || v === datum || chain.datumCorrections[v]) return;
        chain.datumCorrections[v] = dc;
        delete chain.datumCorrections[datum];
        applyChange({ type: 'step', chainId: chain.id }, '基准改名');
      }));
      ['dEast', 'dNorth', 'loss'].forEach(function (k) {
        tr.appendChild(inputCell(dc[k] || 0, function (v) {
          dc[k] = parseFloat(v) || 0;
          applyChange({ type: 'datum', chainId: chain.id, datum: datum }, '基准参数修改[' + datum + ']');
        }, 'number'));
      });
      const tdOps = document.createElement('td');
      const del = document.createElement('button');
      del.textContent = '删'; del.className = 'small danger';
      del.addEventListener('click', function () {
        delete chain.datumCorrections[datum];
        applyChange({ type: 'datum', chainId: chain.id, datum: datum }, '基准校正删除[' + datum + ']');
      });
      tdOps.appendChild(del);
      tr.appendChild(tdOps);
      dtbody.appendChild(tr);
    });
  }

  function inputCell(value, onCommit, type) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = type || 'text';
    if (type === 'number') inp.step = 'any';
    inp.value = value;
    inp.addEventListener('change', function () { onCommit(inp.value); });
    td.appendChild(inp);
    return td;
  }
  function selectCell(value, onCommit) {
    const td = document.createElement('td');
    const sel = document.createElement('select');
    Engine.REPS.forEach(function (r) {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      sel.appendChild(o);
    });
    sel.value = value;
    sel.addEventListener('change', function () { onCommit(sel.value); });
    td.appendChild(sel);
    return td;
  }

  /* ---------- 渲染：换算轨迹 ---------- */
  function renderTrace() {
    const summary = document.getElementById('trace-summary');
    const tbody = document.querySelector('#trace-table tbody');
    tbody.innerHTML = '';
    const p = pointById(state.selectedPointId);
    if (!p) {
      summary.textContent = '请选择左侧任一点。';
      return;
    }
    const t = traces[p.id];
    if (!t) { summary.textContent = '无推演结果。'; return; }

    let html = '点「' + escapeHtml(p.name) + '」 原始 ' + p.rep + ' (' +
      coordText(t.origin, p.rep) + ')，基准 ' + escapeHtml(p.datum) +
      '，源精度 ±' + fmtAcc(p.accuracy) + ' m。';
    if (t.status === 'ok') {
      html += ' <span class="final">最终 ' + t.final.rep + ' (' +
        coordText(t.final, t.final.rep) + ') ±' + fmtAcc(t.final.accuracy) + ' m</span>';
    } else {
      html += ' <span class="refused">断链，已拒绝输出最终坐标：' + escapeHtml(t.breakReason) + '</span>';
    }
    summary.innerHTML = html;

    addTraceRow(tbody, '起点（原始输入）', p.rep, '-', coordText(t.origin, p.rep),
      '±' + fmtAcc(p.accuracy), false, p.rep);
    t.steps.forEach(function (s) {
      addTraceRow(tbody, s.name, s.srcRep + ' → ' + s.dstRep,
        coordText(s.input, s.srcRep), coordText(s.output, s.dstRep),
        '±' + fmtAcc(s.accBefore) + ' ⊕ ' + fmtAcc(s.loss) + ' → ±' + fmtAcc(s.accAfter),
        s.kind === 'datum', s.dstRep);
    });
    if (t.status === 'broken') {
      const tr = document.createElement('tr');
      tr.className = 'break-row';
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '✕ 断点：' + t.breakReason;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }
  function addTraceRow(tbody, name, rep, input, output, acc, isDatum, coordRep) {
    const tr = document.createElement('tr');
    if (isDatum) tr.className = 'datum-row';
    [name, rep, input, output, acc].forEach(function (txt, i) {
      const td = document.createElement('td');
      td.textContent = txt;
      if (i >= 2) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderAll() {
    renderPoints();
    renderPointForm();
    renderChainEditor();
    renderTrace();
  }

  /* ---------- 事件 ---------- */
  pointForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const el = pointForm.elements;
    const existing = pointById(state.selectedPointId);
    const data = {
      name: el.name.value.trim(),
      rep: el.rep.value,
      datum: el.datum.value.trim(),
      lat: parseFloat(el.lat.value),
      lng: parseFloat(el.lng.value),
      accuracy: parseFloat(el.accuracy.value) || 0,
      chainId: el.chainId.value
    };
    if (!data.name || isNaN(data.lat) || isNaN(data.lng)) return;
    if (existing) {
      Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
      applyChange({ type: 'point', pointId: existing.id }, '点修改[' + existing.name + ']');
    } else {
      data.id = uid('p');
      state.points.push(data);
      state.selectedPointId = data.id;
      applyChange({ type: 'point', pointId: data.id }, '新增点[' + data.name + ']');
    }
  });
  document.getElementById('point-delete').addEventListener('click', function () {
    const p = pointById(state.selectedPointId);
    if (!p) return;
    state.points = state.points.filter(function (q) { return q.id !== p.id; });
    delete traces[p.id];
    state.selectedPointId = state.points.length ? state.points[0].id : null;
    save();
    renderAll();
    log('已删除点[' + p.name + ']');
  });
  document.getElementById('point-reset').addEventListener('click', function () {
    state.selectedPointId = null;
    renderPointForm();
  });

  document.getElementById('chain-select').addEventListener('change', function (e) {
    state.selectedChainId = e.target.value;
    save();
    renderChainEditor();
  });
  document.getElementById('chain-add').addEventListener('click', function () {
    const c = { id: uid('c'), name: '新转换链', datumCorrections: {}, steps: [] };
    state.chains.push(c);
    state.selectedChainId = c.id;
    save();
    renderChainEditor();
    log('已新建链，请添加步骤');
  });
  document.getElementById('chain-del').addEventListener('click', function () {
    const c = chainById(state.selectedChainId);
    if (!c) return;
    const affected = state.points.filter(function (p) { return p.chainId === c.id; });
    state.chains = state.chains.filter(function (q) { return q.id !== c.id; });
    state.selectedChainId = state.chains.length ? state.chains[0].id : null;
    affected.forEach(function (p) {
      traces[p.id] = Engine.computeTrace(p, null);
    });
    save();
    renderAll();
    log('已删除链[' + c.name + ']，其下 ' + affected.length + ' 个点标记为无链断链');
  });
  document.getElementById('chain-name').addEventListener('change', function (e) {
    const c = chainById(state.selectedChainId);
    if (!c) return;
    c.name = e.target.value.trim() || c.name;
    save();
    renderAll();
    log('链已重命名');
  });
  document.getElementById('step-add').addEventListener('click', function () {
    const c = chainById(state.selectedChainId);
    if (!c) return;
    const last = c.steps.length ? c.steps[c.steps.length - 1].dst : 'WGS84';
    c.steps.push({ id: uid('s'), name: '新步骤', src: last, dst: last === 'WGS84' ? 'GCJ02' : 'WGS84', loss: 0.1 });
    applyChange({ type: 'step', chainId: c.id }, '添加步骤');
  });
  document.getElementById('datum-add').addEventListener('click', function () {
    const c = chainById(state.selectedChainId);
    if (!c) return;
    let name = '新基准', n = 1;
    while (c.datumCorrections[name]) { name = '新基准' + (++n); }
    c.datumCorrections[name] = { dEast: 0, dNorth: 0, loss: 0 };
    save();
    renderChainEditor();
    log('已添加基准校正[' + name + ']，请修改名称与参数');
  });

  /* ---------- 初始化 ---------- */
  load();
  fullRecompute();
  renderAll();
  log('已加载 ' + state.points.length + ' 个点、' + state.chains.length + ' 条链（全量重推完成）');
})();
