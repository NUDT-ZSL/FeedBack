/*
 * app.js — 界面层：渲染留存矩阵、两两比较、分层比较、数据录入、冲突与拒绝日志。
 * 所有计算都委托给 engine.js，界面只是状态的投影，任何数据变更后立即整体重渲染。
 */
(function () {
  'use strict';

  const LS_KEY = 'cohort-retention-workbench-v1';
  let state = load() || seed();

  // ---------- 持久化 ----------

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Engine.serialize(state))); } catch (e) { /* 忽略配额错误 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Engine.deserialize(JSON.parse(raw));
    } catch (e) { /* 数据损坏则回落到示例 */ }
    return null;
  }

  // ---------- 示例数据 ----------

  function seed() {
    const s = Engine.createState({ minCohortsPerStratum: 2 });

    Engine.addCohort(s, { id: 'IFA-05', name: '信息流·5月队列', stratum: '信息流', start: '2026-05', size: 1000 });
    Engine.addCohort(s, { id: 'IFB-06', name: '信息流·6月队列', stratum: '信息流', start: '2026-06', size: 1200 });
    Engine.addCohort(s, { id: 'NS-05', name: '自然搜索·5月队列', stratum: '自然搜索', start: '2026-05', size: 800 });
    Engine.addCohort(s, { id: 'NS-06', name: '自然搜索·6月队列', stratum: '自然搜索', start: '2026-06', size: 900 });
    Engine.addCohort(s, { id: 'OFF-07', name: '线下活动·7月队列', stratum: '线下活动', start: '2026-07', size: 300 });

    // 信息流 5 月队列：观察期长（0..5 期）——“看得久”的那个
    [1000, 620, 510, 430, 380, 350].forEach(function (v, p) {
      Engine.reportObservation(s, { cohortId: 'IFA-05', period: p, active: v, source: '数据平台' });
    });
    // 信息流 6 月队列：观察期短（0..3 期），前期略低、后期反超 —— 演示方向反转
    [1200, 700, 610, 540].forEach(function (v, p) {
      Engine.reportObservation(s, { cohortId: 'IFB-06', period: p, active: v, source: '数据平台' });
    });
    // 自然搜索 5 月队列：第 2 期两个来源给出矛盾数值 —— 演示冲突保留
    [800, 520, null, 400, 370].forEach(function (v, p) {
      if (v !== null) Engine.reportObservation(s, { cohortId: 'NS-05', period: p, active: v, source: '数据平台' });
    });
    Engine.reportObservation(s, { cohortId: 'NS-05', period: 2, active: 450, source: '数据平台' });
    Engine.reportObservation(s, { cohortId: 'NS-05', period: 2, active: 455, source: '渠道后台' });
    // 自然搜索 6 月队列
    [900, 540, 470, 420].forEach(function (v, p) {
      Engine.reportObservation(s, { cohortId: 'NS-06', period: p, active: v, source: '数据平台' });
    });
    // 线下活动：分层内只有 1 个队列 —— 演示“不可比”标记
    [300, 150, 110].forEach(function (v, p) {
      Engine.reportObservation(s, { cohortId: 'OFF-07', period: p, active: v, source: '活动签到系统' });
    });

    return s;
  }

  // ---------- 工具 ----------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function pct(r) { return (r * 100).toFixed(1) + '%'; }
  function pp(d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + 'pp'; }
  function signLabel(sign, labelA, labelB) {
    if (sign > 0) return labelA + ' 领先';
    if (sign < 0) return labelB + ' 领先';
    return '持平';
  }
  function diffCell(td, diff, sign) {
    td.textContent = pp(diff);
    td.className = sign > 0 ? 'pos' : sign < 0 ? 'neg' : 'zero';
  }
  function heatClass(rate) {
    if (rate >= 0.8) return 'heat-4';
    if (rate >= 0.6) return 'heat-3';
    if (rate >= 0.45) return 'heat-2';
    if (rate >= 0.3) return 'heat-1';
    return 'heat-0';
  }

  // ---------- 留存矩阵 ----------

  function renderMatrix() {
    const wrap = document.getElementById('matrixWrap');
    wrap.innerHTML = '';
    const m = Engine.retentionMatrix(state);
    if (m.rows.length === 0) { wrap.appendChild(el('p', 'empty-note', '暂无队列，请在下方新增。')); return; }

    const table = el('table');
    const head = el('tr');
    head.appendChild(el('th', null, '队列（分层 / 起始 / 规模）'));
    for (let p = 0; p <= m.maxPeriod; p++) head.appendChild(el('th', null, '第' + p + '期'));
    table.appendChild(head);

    m.rows.forEach(function (row) {
      const tr = el('tr');
      const c = row.cohort;
      tr.appendChild(el('td', null, c.name + '（' + c.stratum + ' / ' + (c.start || '—') + ' / ' + c.size + '人）'));
      row.cells.forEach(function (cell) {
        const td = el('td');
        if (cell.status === 'ok') {
          td.textContent = pct(cell.rate);
          td.className = 'cell-ok ' + heatClass(cell.rate);
          td.title = '活跃 ' + cell.active + ' / ' + c.size;
        } else if (cell.status === 'conflict') {
          td.textContent = '⚠ 冲突';
          td.className = 'cell-conflict';
          td.title = cell.entries.map(function (e) { return e.source + ': ' + e.active; }).join('；');
        } else {
          td.textContent = '—';
          td.className = 'cell-empty';
        }
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
  }

  // ---------- 通用比较结果渲染 ----------

  function renderCompareResult(container, result, labelA, labelB) {
    container.innerHTML = '';

    const note = el('div', 'window-note');
    if (result.window.length === 0) {
      note.textContent = '双方没有共同的观察期，无法比较。以下观测全部被排除：';
    } else {
      note.textContent = '共同观察窗口：第 ' + result.window[0] + ' 期 ~ 第 ' + result.window[result.window.length - 1] +
        ' 期（共 ' + result.window.length + ' 期）。窗口外的观测已全部排除，不以零或缺失填补。';
    }
    container.appendChild(note);

    // 排除说明（无论窗口是否为空都要列出，需求 2）
    const ex = result.excludedA.map(function (e) { return { side: labelA, e: e }; })
      .concat(result.excludedB.map(function (e) { return { side: labelB, e: e }; }));
    if (ex.length > 0) {
      container.appendChild(el('p', 'summary-line', '已排除的窗口外观测（共 ' + ex.length + ' 条）：'));
      const ul = el('ul', 'exclusion-list');
      ex.forEach(function (x) {
        ul.appendChild(el('li', null, '【' + x.side + '】第 ' + x.e.period + ' 期：' + x.e.reason));
      });
      container.appendChild(ul);
    }

    // 冲突期提示
    const confs = (result.conflictedA || []).map(function (p) { return labelA + ' 第' + p + '期'; })
      .concat((result.conflictedB || []).map(function (p) { return labelB + ' 第' + p + '期'; }));
    if (confs.length > 0) {
      container.appendChild(el('p', 'summary-line', '以下观察期存在来源冲突，未纳入比较：' + confs.join('、')));
    }

    if (result.window.length === 0) return;

    // 逐期表
    const table = el('table');
    const head = el('tr');
    ['观察期', labelA + ' 活跃', labelA + ' 留存率', labelB + ' 活跃', labelB + ' 留存率', '差额(A−B)', '方向'].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);
    result.rows.forEach(function (r) {
      const tr = el('tr');
      tr.appendChild(el('td', null, '第' + r.period + '期'));
      tr.appendChild(el('td', null, String(r.activeA)));
      tr.appendChild(el('td', null, pct(r.rateA)));
      tr.appendChild(el('td', null, String(r.activeB)));
      tr.appendChild(el('td', null, pct(r.rateB)));
      const td = el('td'); diffCell(td, r.diff, r.sign); tr.appendChild(td);
      tr.appendChild(el('td', r.sign > 0 ? 'pos' : r.sign < 0 ? 'neg' : 'zero', signLabel(r.sign, labelA, labelB)));
      table.appendChild(tr);
    });
    container.appendChild(table);

    // 方向反转
    const revTitle = el('p', 'summary-line');
    if (result.reversals.length === 0) {
      const consistent = result.rows.find(function (r) { return r.sign !== 0; });
      revTitle.textContent = '差异方向：窗口内未发生反转' +
        (consistent ? '（' + signLabel(consistent.sign, labelA, labelB) + '）' : '（各期均持平）');
      container.appendChild(revTitle);
    } else {
      revTitle.textContent = '差异方向：窗口内发生 ' + result.reversals.length + ' 次反转';
      container.appendChild(revTitle);
      const ul = el('ul', 'reversal-list');
      result.reversals.forEach(function (rv) {
        ul.appendChild(el('li', null,
          '第 ' + rv.period + ' 期方向反转：' + signLabel(rv.from, labelA, labelB) + ' → ' + signLabel(rv.to, labelA, labelB) +
          '（上一观察期为第 ' + rv.prevPeriod + ' 期）'));
      });
      container.appendChild(ul);
    }

    const mean = el('p', 'summary-line',
      '窗口内平均差额：' + pp(result.meanDiff) + '（' + signLabel(result.meanDiff > 0 ? 1 : result.meanDiff < 0 ? -1 : 0, labelA, labelB) + '）');
    container.appendChild(mean);
  }

  // ---------- 队列两两比较 ----------

  function renderPair() {
    const selA = document.getElementById('cohortASelect');
    const selB = document.getElementById('cohortBSelect');
    const prevA = selA.value, prevB = selB.value;
    [selA, selB].forEach(function (sel) {
      sel.innerHTML = '';
      state.cohortOrder.forEach(function (id) {
        const c = state.cohorts[id];
        sel.appendChild(new Option(c.name + '（' + c.stratum + '）', id));
      });
    });
    selA.value = prevA && state.cohorts[prevA] ? prevA : (state.cohortOrder[0] || '');
    selB.value = prevB && state.cohorts[prevB] ? prevB : (state.cohortOrder[1] || state.cohortOrder[0] || '');

    const out = document.getElementById('pairResult');
    const badge = document.getElementById('pairCacheBadge');
    out.innerHTML = '';
    badge.hidden = true;

    if (!selA.value || !selB.value) { out.appendChild(el('p', 'empty-note', '请先建立至少两个队列。')); return; }
    if (selA.value === selB.value) { out.appendChild(el('p', 'empty-note', '请选择两个不同的队列。')); return; }

    const result = Engine.compareCohorts(state, selA.value, selB.value);
    badge.hidden = !result.fromCache;
    renderCompareResult(out, result, state.cohorts[selA.value].name, state.cohorts[selB.value].name);
  }

  // ---------- 分层比较 ----------

  function renderStrata() {
    const wrap = document.getElementById('stratumSummaryWrap');
    wrap.innerHTML = '';
    const summary = Engine.stratumSummary(state);
    if (summary.length === 0) { wrap.appendChild(el('p', 'empty-note', '暂无分层数据。')); return; }

    const table = el('table');
    const head = el('tr');
    ['分层（渠道）', '队列数', '可比下限', '状态', '说明'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    summary.forEach(function (s) {
      const tr = el('tr');
      tr.appendChild(el('td', null, s.stratum));
      tr.appendChild(el('td', null, String(s.count)));
      tr.appendChild(el('td', null, String(s.threshold)));
      const tdStatus = el('td');
      const badge = el('span', 'badge ' + (s.comparable ? 'ok' : 'no'), s.comparable ? '可比较' : '不可比');
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);
      tr.appendChild(el('td', null, s.comparable
        ? '队列数满足下限，可参与分层比较'
        : '可用队列数 ' + s.count + ' 低于下限 ' + s.threshold + '，还差 ' + s.missing + ' 个队列；不与分层充足的一方并列得出优劣结论'));
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    // 分层比较选择器：只放可比较的分层
    const comparable = summary.filter(function (s) { return s.comparable; });
    const selA = document.getElementById('stratumASelect');
    const selB = document.getElementById('stratumBSelect');
    const prevA = selA.value, prevB = selB.value;
    [selA, selB].forEach(function (sel) {
      sel.innerHTML = '';
      comparable.forEach(function (s) { sel.appendChild(new Option(s.stratum, s.stratum)); });
    });
    selA.value = prevA || (comparable[0] && comparable[0].stratum) || '';
    selB.value = prevB || (comparable[1] && comparable[1].stratum) || selA.value;

    const out = document.getElementById('strataResultResult');
    out.innerHTML = '';
    if (comparable.length < 2) {
      out.appendChild(el('p', 'empty-note', '可比较的分层不足两个（需各自达到队列数下限），暂不能进行分层对比。'));
      return;
    }
    if (selA.value === selB.value) { out.appendChild(el('p', 'empty-note', '请选择两个不同的分层。')); return; }

    const result = Engine.compareStrata(state, selA.value, selB.value);
    if (!result.comparable) {
      const div = el('div', 'ingest-msg rejected');
      div.textContent = result.reason;
      out.appendChild(div);
      return;
    }
    renderCompareResult(out, result, selA.value, selB.value);
  }

  // ---------- 冲突与拒绝日志 ----------

  function renderConflicts() {
    const wrap = document.getElementById('conflictWrap');
    wrap.innerHTML = '';
    if (state.conflicts.length === 0) { wrap.appendChild(el('p', 'empty-note', '暂无冲突。')); return; }
    const ul = el('ul', 'conflict-list');
    state.conflicts.forEach(function (c) {
      const detail = c.values.map(function (v) {
        return '数值 ' + v.active + '（来源：' + v.sources.join('、') + '）';
      }).join('；另一方为 ');
      ul.appendChild(el('li', null,
        '队列「' + c.cohortName + '」(' + c.cohortId + ') 第 ' + c.period + ' 观察期：' + detail +
        '。双方数值均已保留，该期在冲突解决前不纳入任何比较。'));
    });
    wrap.appendChild(ul);
  }

  function renderRejections() {
    const wrap = document.getElementById('rejectWrap');
    wrap.innerHTML = '';
    if (state.rejections.length === 0) { wrap.appendChild(el('p', 'empty-note', '暂无被拒绝的数据。')); return; }
    const ul = el('ul', 'reject-list');
    state.rejections.slice().reverse().forEach(function (r) {
      ul.appendChild(el('li', null, '#' + r.at + ' [' + r.kind + '] ' + r.reason));
    });
    wrap.appendChild(ul);
  }

  // ---------- 录入表单 ----------

  function showMsg(status, text) {
    const box = document.getElementById('ingestMsg');
    box.hidden = false;
    box.className = 'ingest-msg ' + status;
    box.textContent = { accepted: '✔ 已接受：', duplicate: '↺ 幂等忽略：', rejected: '✘ 已拒绝：', conflict: '⚠ 冲突：' }[status] + text;
  }

  function refreshCohortSelects() {
    document.querySelectorAll('#obsForm select[name=cohortId], #sizeForm select[name=cohortId]').forEach(function (sel) {
      const prev = sel.value;
      sel.innerHTML = '';
      state.cohortOrder.forEach(function (id) {
        sel.appendChild(new Option(state.cohorts[id].name + '（' + id + '）', id));
      });
      if (prev && state.cohorts[prev]) sel.value = prev;
    });
    const dl = document.getElementById('stratumList');
    dl.innerHTML = '';
    Engine.stratumSummary(state).forEach(function (s) { dl.appendChild(new Option(s.stratum, s.stratum)); });
  }

  function applyAndRender(msg) {
    if (msg) showMsg(msg.status, msg.reason || '操作成功');
    save();
    renderAll();
  }

  function bindForms() {
    document.getElementById('cohortForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target;
      const r = Engine.addCohort(state, {
        name: f.name.value, stratum: f.stratum.value, start: f.start.value, size: f.size.value
      });
      if (r.status === 'accepted') f.reset();
      applyAndRender(r);
    });

    document.getElementById('obsForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target;
      const r = Engine.reportObservation(state, {
        cohortId: f.cohortId.value,
        period: f.period.value,
        active: f.active.value,
        source: f.source.value,
        reportedAt: f.reportedAt.value
      });
      if (r.status === 'accepted') { f.period.value = Number(f.period.value) + 1; f.active.value = ''; }
      applyAndRender(r);
    });

    document.getElementById('sizeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target;
      const r = Engine.correctSize(state, f.cohortId.value, f.newSize.value);
      applyAndRender(r);
    });

    document.getElementById('cohortASelect').addEventListener('change', renderPair);
    document.getElementById('cohortBSelect').addEventListener('change', renderPair);
    document.getElementById('stratumASelect').addEventListener('change', renderStrata);
    document.getElementById('stratumBSelect').addEventListener('change', renderStrata);

    document.getElementById('thresholdInput').addEventListener('change', function (e) {
      const v = Number(e.target.value);
      if (Number.isInteger(v) && v >= 1) {
        state.minCohortsPerStratum = v;
        save();
        renderStrata();
      }
    });

    document.getElementById('resetSeedBtn').addEventListener('click', function () {
      state = seed();
      document.getElementById('thresholdInput').value = state.minCohortsPerStratum;
      applyAndRender({ status: 'accepted', reason: '已重置为示例数据' });
    });
    document.getElementById('clearBtn').addEventListener('click', function () {
      state = Engine.createState({ minCohortsPerStratum: Number(document.getElementById('thresholdInput').value) || 2 });
      applyAndRender({ status: 'accepted', reason: '已清空全部数据' });
    });
  }

  // ---------- 总渲染 ----------

  function renderAll() {
    document.getElementById('thresholdInput').value = state.minCohortsPerStratum;
    renderMatrix();
    refreshCohortSelects();
    renderPair();
    renderStrata();
    renderConflicts();
    renderRejections();
  }

  bindForms();
  save();
  renderAll();
})();
