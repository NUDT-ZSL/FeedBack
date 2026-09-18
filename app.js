'use strict';
/* 界面层：负责渲染与交互，所有计算委托给 Engine。 */
(function () {
  let state = Engine.makeSeedState();
  let profileCache = newCache();
  let prevConc = {};            /* 上次结论，用于“改一条假设后哪些结论还成立”的对比 */
  const LOG = [];
  const respEdit = { aid: null, mid: null, points: [] };

  function newCache() { return { map: new Map(), hits: 0, misses: 0, rebuilt: [] }; }
  function log(kind, msg) {
    LOG.unshift({ kind, msg, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
    if (LOG.length > 60) LOG.pop();
    renderLog();
  }
  const fmt = (x, d = 3) => {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    const v = Math.abs(x) < 1e-12 ? 0 : x;
    return v.toLocaleString('zh-CN', { maximumFractionDigits: d });
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = sel => document.querySelector(sel);

  /* ============ 渲染：假设面板 ============ */
  function renderAssumptions() {
    const act = Engine.activeAssumptions(state);
    const conflicted = state.conflicts.filter(c => c.kind === 'assumption');
    let html = '';
    for (const a of act) {
      const v = state.values[a.id] !== undefined ? state.values[a.id] : a.base;
      const step = (a.max - a.min) / 400;
      html += `
      <div class="arow" data-aid="${esc(a.id)}">
        <div class="ahead">
          <b>${esc(a.name)}</b><code>${esc(a.id)}</code>
          <span class="src">${esc(a.source)}</span>
        </div>
        <div class="abody">
          <input type="range" min="${a.min}" max="${a.max}" step="${step}" value="${v}"
                 data-role="slider" data-aid="${esc(a.id)}">
          <input type="number" min="${a.min}" max="${a.max}" step="${step}" value="${fmt(v, 4)}"
                 data-role="valnum" data-aid="${esc(a.id)}">
          <span class="unit">${esc(a.unit)}</span>
        </div>
        <div class="ameta">基准 ${fmt(a.base)}${esc(a.unit)} · 区间 [${fmt(a.min)}, ${fmt(a.max)}] · Δ ${fmt(v - a.base)}</div>
      </div>`;
    }
    for (const c of conflicted) {
      html += `
      <div class="arow conflicted">
        <div class="ahead"><b>${esc(c.options[0].data.name)}</b><code>${esc(c.aid)}</code>
          <span class="badge badge-conflict">冲突未决</span></div>
        <div class="ameta">存在 ${c.options.length} 个互相矛盾的登记（见⑤冲突记录），解决前不参与计算。</div>
      </div>`;
    }
    $('#assump-list').innerHTML = html;
  }

  /* ============ 渲染：方向编辑器 ============ */
  function renderDirection() {
    const act = Engine.activeAssumptions(state);
    let html = '<div class="dir-grid">';
    for (const a of act) {
      const w = state.direction[a.id] || 0;
      html += `
      <label class="dir-row" title="t 每推进 1，${esc(a.id)} 移动该权重个单位">
        <span>${esc(a.name)}</span>
        <input type="number" step="0.1" value="${w}" data-role="dirw" data-aid="${esc(a.id)}">
        <span class="unit">${esc(a.unit)}/步</span>
      </label>`;
    }
    html += `</div>
      <div class="row-actions">
        <button data-action="dir-clear">方向清零</button>
        <button data-action="dir-stress">预设：恶化方向</button>
      </div>`;
    $('#dir-editor').innerHTML = html;
  }

  /* ============ 渲染：指标卡片骨架 ============ */
  function renderMetrics() {
    let html = '';
    for (const m of state.metrics) {
      html += `
      <div class="mcard" id="mc-${esc(m.id)}">
        <div class="mhead">
          <b>${esc(m.name)}</b><code>${esc(m.id)}</code><span class="unit">${esc(m.unit)}</span>
          <span class="thr">决策线 ${m.violate === 'below' ? '≥' : '≤'} ${fmt(m.threshold)}</span>
          <span class="badge" id="mstatus-${esc(m.id)}"></span>
        </div>
        <div class="mvals">
          <span>当前 <b id="mv-${esc(m.id)}"></b></span>
          <span>基准 ${fmt(m.base)}</span>
          <span>Δ <b id="md-${esc(m.id)}"></b></span>
        </div>
        <div class="mbar" id="mbar-${esc(m.id)}"></div>
        <div class="mcontrib" id="mcontrib-${esc(m.id)}"></div>
      </div>`;
    }
    $('#metric-list').innerHTML = html;
  }

  /* ============ 输出刷新（拖动/改方向时只动这里） ============ */
  function updateOutputs() {
    profileCache.rebuilt = [];
    for (const m of state.metrics) {
      const dec = Engine.decompose(state, m.id, state.values);
      const violated = m.violate === 'below' ? dec.total < m.threshold : dec.total > m.threshold;
      const near = !violated && Math.abs(dec.total - m.threshold) <= 0.05 * Math.max(1, Math.abs(m.threshold));

      $('#mv-' + m.id).textContent = fmt(dec.total);
      $('#md-' + m.id).textContent = fmt(dec.total - dec.base);
      const st = $('#mstatus-' + m.id);
      st.textContent = violated ? '越线' : (near ? '接近决策线' : '安全');
      st.className = 'badge ' + (violated ? 'badge-bad' : (near ? 'badge-warn' : 'badge-ok'));

      /* 指标 vs 决策线 位置条 */
      const lo = Math.min(dec.base, m.threshold, dec.total), hi = Math.max(dec.base, m.threshold, dec.total);
      const span = hi - lo || 1;
      const pct = x => (100 * (x - lo) / span).toFixed(2) + '%';
      $('#mbar-' + m.id).innerHTML = `
        <div class="mbar-track">
          <span class="mbar-base" style="left:${pct(dec.base)}" title="基准 ${fmt(dec.base)}"></span>
          <span class="mbar-thr" style="left:${pct(m.threshold)}" title="决策线 ${fmt(m.threshold)}"></span>
          <span class="mbar-cur ${violated ? 'bad' : ''}" style="left:${pct(dec.total)}" title="当前 ${fmt(dec.total)}"></span>
        </div>
        <div class="mbar-legend"><span>◆当前</span><span>▲基准</span><span>│决策线</span></div>`;

      /* 贡献分解 */
      const maxAbs = Math.max(1e-12, ...dec.parts.map(p => Math.abs(p.c)));
      let ch = '';
      for (const p of dec.parts) {
        const w = (50 * Math.abs(p.c) / maxAbs).toFixed(2);
        ch += `
        <div class="crow">
          <span class="cname">${esc(p.name)}</span>
          <span class="cbar"><span class="cbar-fill ${p.c < 0 ? 'neg' : 'pos'}" style="width:${w}%"></span></span>
          <span class="cval">${p.c >= 0 ? '+' : ''}${fmt(p.c)}</span>
        </div>`;
      }
      if (!dec.parts.length) ch = '<div class="dim">（无生效响应：相关假设可能冲突未决或未登记响应）</div>';
      ch += `<div class="csum">贡献合计 ${dec.sum >= 0 ? '+' : ''}${fmt(dec.sum)} ＝ 总变化 ${fmt(dec.total - dec.base)} ✓</div>`;
      $('#mcontrib-' + m.id).innerHTML = ch;

      renderSweep(m, dec.total, violated);
    }
    renderConflicts();
  }

  /* ============ 渲染：扫描结果与结论对比 ============ */
  function renderSweep(m, value, violated) {
    const sw = Engine.sweep(state, m.id, state.direction, profileCache);
    const box = $('#sw-' + m.id);
    let html = '';
    if (!sw.ok) {
      html = `<div class="dim">${esc(sw.reason)}</div>`;
    } else {
      const dirName = d => d === 'up' ? '上穿' : d === 'down' ? '下穿' : '触及';
      if (sw.first === null) {
        html += `<div class="sw-line">可达范围 t∈[0, ${fmt(sw.tMax)}] 内<b>不越线</b></div>`;
      } else {
        const vals = Object.entries(sw.firstValues)
          .filter(([aid]) => (state.direction[aid] || 0) !== 0)
          .map(([aid, v]) => { const a = state.assumptions.find(x => x.id === aid); return `${esc(a ? a.name : aid)} ${fmt(a ? a.base : 0)}→<b>${fmt(v)}</b>`; })
          .join('，');
        html += `<div class="sw-line">首次越线 <b>t*=${fmt(sw.first)}</b>（越线假设取值：${vals}）</div>`;
      }
      html += `<div class="sw-line">全部穿越点：${sw.crossings.length
        ? sw.crossings.map(c => `t=${fmt(c.t)}(${dirName(c.dir)})`).join('，')
        : '无'}</div>`;
      html += `<div class="sw-line">贴线平台：${sw.plateaus.length
        ? sw.plateaus.map(p => `[${fmt(p.t0)}, ${fmt(p.t1)}]`).join('，')
        : '无'}</div>`;
      html += `<div class="sw-line">不可达区间：${sw.unreachable.length
        ? sw.unreachable.map(u => `[${fmt(u.t0)}, ${fmt(u.t1)}] 在线${u.side === 'above' ? '上' : '下'}方`).join('；')
        : '无'}</div>`;

      /* 结论对比：本次编辑后哪些结论还成立 */
      const conc = {
        first: sw.first === null ? null : +sw.first.toFixed(6),
        nCross: sw.crossings.length, nPlat: sw.plateaus.length, violated
      };
      const prev = prevConc[m.id];
      if (prev) {
        const chips = [];
        chips.push(conc.first === prev.first ? '首次越线位置：保持'
          : `首次越线位置：变化 ${prev.first === null ? '无' : fmt(prev.first)} → ${conc.first === null ? '无' : fmt(conc.first)}`);
        chips.push(conc.nCross === prev.nCross && conc.nPlat === prev.nPlat
          ? '穿越点/平台数量：保持'
          : `穿越点 ${prev.nCross}→${conc.nCross}，平台 ${prev.nPlat}→${conc.nPlat}`);
        chips.push(conc.violated === prev.violated ? '越线状态：保持' : `越线状态：翻转（${prev.violated ? '越线' : '安全'}→${conc.violated ? '越线' : '安全'}）`);
        const allKept = conc.first === prev.first && conc.nCross === prev.nCross && conc.nPlat === prev.nPlat && conc.violated === prev.violated;
        html += `<div class="sw-conc ${allKept ? 'kept' : 'changed'}">结论对比（相对上次修改）：${chips.map(esc).join(' ｜ ')}</div>`;
      }
      prevConc[m.id] = conc;
    }
    box.innerHTML = `<h3>${esc(m.name)} · 沿当前方向扫描</h3>` + html;
  }

  /* ============ 渲染：响应段编辑器 ============ */
  function renderRespEditor() {
    const act = Engine.activeAssumptions(state);
    if (!respEdit.aid || !act.some(a => a.id === respEdit.aid)) respEdit.aid = act[0] ? act[0].id : null;
    if (!respEdit.mid || !state.metrics.some(m => m.id === respEdit.mid)) respEdit.mid = state.metrics[0] ? state.metrics[0].id : null;

    $('#resp-aid').innerHTML = act.map(a => `<option value="${esc(a.id)}" ${a.id === respEdit.aid ? 'selected' : ''}>${esc(a.name)} (${esc(a.id)})</option>`).join('');
    $('#resp-mid').innerHTML = state.metrics.map(m => `<option value="${esc(m.id)}" ${m.id === respEdit.mid ? 'selected' : ''}>${esc(m.name)} (${esc(m.id)})</option>`).join('');

    const resp = respEdit.aid && respEdit.mid ? Engine.responseFor(state, respEdit.aid, respEdit.mid) : null;
    const conflicted = state.conflicts.some(c => c.kind === 'response' && c.aid === respEdit.aid && c.mid === respEdit.mid);
    if (resp && !respEdit.loaded) respEdit.points = resp.points.map(p => ({ ...p }));
    if (!resp && !respEdit.loaded && respEdit.aid) {
      const a = act.find(x => x.id === respEdit.aid);
      respEdit.points = [{ x: a.min, y: 0 }, { x: a.max, y: 0 }];
    }
    respEdit.loaded = true;

    let rows = '';
    respEdit.points.forEach((p, i) => {
      rows += `<div class="prow">
        <span class="pidx">#${i + 1}</span>
        <label>x <input type="number" step="any" value="${p.x}" data-role="px" data-i="${i}"></label>
        <label>y <input type="number" step="any" value="${p.y}" data-role="py" data-i="${i}"></label>
        <button data-action="resp-delrow" data-i="${i}" title="删除断点">✕</button>
      </div>`;
    });
    $('#resp-rows').innerHTML = rows;

    const a = act.find(x => x.id === respEdit.aid);
    $('#resp-note').innerHTML = conflicted
      ? '<span class="badge badge-conflict">该 (假设, 指标) 的响应存在冲突，解决前不参与计算</span>'
      : (resp
        ? `当前生效响应：来源「${esc(resp.source)}」，版本 v${resp._ver}。修改后未涉及的区间与边界保持不变。`
        : `尚未登记响应。断点须恰好覆盖假设区间 [${fmt(a ? a.min : 0)}, ${fmt(a ? a.max : 0)}]。`);

    /* 派生区间预览 */
    const pts = [...respEdit.points].sort((p, q) => p.x - q.x);
    let segs = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const slope = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x);
      segs += `<span class="seg">[${fmt(pts[i].x)}, ${fmt(pts[i + 1].x)}] 斜率 ${fmt(slope)}</span>`;
    }
    $('#resp-segs').innerHTML = segs || '<span class="dim">至少两个断点构成一段</span>';
  }

  /* ============ 渲染：冲突记录 ============ */
  function renderConflicts() {
    const box = $('#conflict-list');
    if (!state.conflicts.length) {
      box.innerHTML = '<div class="dim">当前无冲突。同一假设/响应被不同来源给出矛盾内容时，双方都会保留在此。</div>';
      return;
    }
    box.innerHTML = state.conflicts.map(c => {
      const title = c.kind === 'assumption'
        ? `假设取值冲突：${esc(c.aid)}`
        : `响应段冲突：(${esc(c.aid)}, ${esc(c.mid)})`;
      const opts = c.options.map((o, i) => {
        const content = c.kind === 'assumption'
          ? `基准 ${fmt(o.data.base)}，区间 [${fmt(o.data.min)}, ${fmt(o.data.max)}]，单位 ${esc(o.data.unit || '—')}`
          : `断点 ${o.data.points.map(p => `(${fmt(p.x)}, ${fmt(p.y)})`).join(' ')}`;
        return `<div class="copt">
          <div class="copt-head"><span class="src">来源「${esc(o.source)}」</span>
            <button data-action="resolve" data-cid="${c.cid}" data-idx="${i}">采用此来源</button></div>
          <div class="copt-body">${esc(content)}</div>
        </div>`;
      }).join('');
      return `<div class="ccard"><div class="chead"><span class="badge badge-conflict">冲突</span>${title}</div><div class="copts">${opts}</div></div>`;
    }).join('');
  }

  /* ============ 渲染：日志 ============ */
  function renderLog() {
    $('#log-list').innerHTML = LOG.map(l =>
      `<div class="lrow ${l.kind}"><span class="ltime">${l.time}</span>${esc(l.msg)}</div>`).join('');
  }

  /* ============ 全量重绘 ============ */
  function renderAll() {
    renderAssumptions();
    renderDirection();
    renderMetrics();
    $('#sweep-results').innerHTML = state.metrics.map(m => `<div class="swcard" id="sw-${esc(m.id)}"></div>`).join('');
    respEdit.loaded = false;
    renderRespEditor();
    updateOutputs();
  }

  /* ============ 事件 ============ */
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.role === 'slider') {
      state.values[el.dataset.aid] = +el.value;
      const row = el.closest('.arow');
      row.querySelector('input[data-role="valnum"]').value = +el.value;
      updateOutputs();
    } else if (el.dataset.role === 'dirw') {
      state.direction[el.dataset.aid] = +el.value || 0;
      updateOutputs();
    } else if (el.dataset.role === 'px' || el.dataset.role === 'py') {
      const i = +el.dataset.i;
      respEdit.points[i][el.dataset.role === 'px' ? 'x' : 'y'] = +el.value;
      renderRespSegmentsOnly();
    }
  });
  function renderRespSegmentsOnly() {
    const pts = [...respEdit.points].sort((p, q) => p.x - q.x);
    let segs = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const slope = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x);
      segs += `<span class="seg">[${fmt(pts[i].x)}, ${fmt(pts[i + 1].x)}] 斜率 ${fmt(isFinite(slope) ? slope : NaN)}</span>`;
    }
    $('#resp-segs').innerHTML = segs || '<span class="dim">至少两个断点构成一段</span>';
  }

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.role === 'valnum') {
      const a = state.assumptions.find(x => x.id === el.dataset.aid);
      if (!a) return;
      let v = +el.value;
      if (!isFinite(v)) { log('reject', `拒绝：${a.id} 的取值非法（${el.value}）`); el.value = fmt(state.values[a.id], 4); return; }
      if (v < a.min || v > a.max) {
        log('reject', `拒绝：${a.id} 取值 ${v} 越出区间 [${a.min}, ${a.max}]，已截断`);
        v = Math.min(a.max, Math.max(a.min, v));
      }
      state.values[a.id] = v;
      el.closest('.arow').querySelector('input[data-role="slider"]').value = v;
      updateOutputs();
    } else if (el.id === 'resp-aid' || el.id === 'resp-mid') {
      respEdit[el.id === 'resp-aid' ? 'aid' : 'mid'] = el.value;
      respEdit.loaded = false;
      $('#resp-errors').innerHTML = '';
      renderRespEditor();
    }
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'dir-clear') {
      for (const k of Object.keys(state.direction)) state.direction[k] = 0;
      renderDirection(); updateOutputs();
    } else if (act === 'dir-stress') {
      state.direction = { rev_growth: -2, gross_margin: -0.5, opex_ratio: 0.5, tax_rate: 0 };
      renderDirection(); updateOutputs();
      log('info', '已载入预设恶化方向');
    } else if (act === 'resp-addrow') {
      respEdit.points.push({ x: 0, y: 0 });
      renderRespEditor();
    } else if (act === 'resp-delrow') {
      respEdit.points.splice(+btn.dataset.i, 1);
      renderRespEditor();
    } else if (act === 'resp-apply') {
      const a = state.assumptions.find(x => x.id === respEdit.aid);
      const points = respEdit.points.map(p => ({ x: +p.x, y: +p.y }));
      const source = ($('#resp-source').value || '').trim() || '界面编辑';
      const existing = Engine.responseFor(state, respEdit.aid, respEdit.mid);
      /* 来源不同且内容不同 → 走冲突登记；否则直接编辑 */
      let r;
      if (existing && existing.source !== source) {
        r = Engine.addResponse(state, respEdit.aid, respEdit.mid, points, source);
      } else {
        r = Engine.setResponsePoints(state, respEdit.aid, respEdit.mid, points, source);
      }
      if (!r.ok) {
        $('#resp-errors').innerHTML = r.errs.map(x =>
          `<div class="err">拒绝 @${esc(x.field)}：${esc(x.msg)}</div>`).join('');
        log('reject', `响应 (${respEdit.aid}, ${respEdit.mid}) 被拒绝：` + r.errs.map(x => x.msg).join('；'));
        return;
      }
      $('#resp-errors').innerHTML = '';
      if (r.conflict) log('conflict', `响应 (${respEdit.aid}, ${respEdit.mid}) 与来源「${existing ? existing.source : '已有登记'}」矛盾，已生成冲突记录 #${r.conflict}`);
      else log('info', `响应 (${respEdit.aid}, ${respEdit.mid}) 已更新（来源「${source}」）`);
      respEdit.loaded = false;
      renderAll();
    } else if (act === 'resolve') {
      const cid = +btn.dataset.cid, idx = +btn.dataset.idx;
      const c = state.conflicts.find(x => x.cid === cid);
      if (c && Engine.resolveConflict(state, cid, idx)) {
        log('info', `冲突 #${cid}（${c.kind === 'assumption' ? c.aid : c.aid + ', ' + c.mid}）已采用来源「${c.options[idx].source}」解决`);
        renderAll();
      }
    } else if (act === 'add-assump') {
      const g = id => $(id).value;
      const num = id => { const v = parseFloat(g(id)); return isFinite(v) ? v : NaN; };
      const input = {
        id: g('#na-id').trim(), name: g('#na-name').trim(), unit: g('#na-unit').trim(),
        source: g('#na-source').trim() || '未标注',
        base: num('#na-base'), min: num('#na-min'), max: num('#na-max')
      };
      const r = Engine.addAssumption(state, input);
      if (!r.ok) {
        $('#na-errors').innerHTML = r.errs.map(x => `<div class="err">拒绝 @${esc(x.field)}：${esc(x.msg)}</div>`).join('');
        log('reject', `新增假设 '${input.id}' 被拒绝：` + r.errs.map(x => x.msg).join('；'));
        return;
      }
      $('#na-errors').innerHTML = '';
      if (r.conflict) log('conflict', `假设 '${input.id}' 与已有登记矛盾，已生成冲突记录 #${r.conflict}，双方均保留`);
      else log('info', `假设 '${input.id}' 已登记`);
      renderAll();
    } else if (act === 'selftest') {
      const results = Tests.runSelfTests();
      $('#p-test').classList.remove('hidden');
      $('#test-results').innerHTML = results.map(r =>
        `<div class="trow ${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓' : '✗'} ${esc(r.name)}${r.ok ? '' : `<pre>${esc(r.detail)}</pre>`}</div>`).join('');
      const fails = results.filter(r => !r.ok).length;
      log(fails ? 'reject' : 'info', `自检完成：${results.length - fails}/${results.length} 通过`);
    } else if (act === 'reset') {
      state = Engine.makeSeedState();
      profileCache = newCache();
      prevConc = {};
      respEdit.aid = respEdit.mid = null; respEdit.loaded = false;
      renderAll();
      log('info', '已重置为示例数据');
    }
  });

  /* ============ 启动 ============ */
  renderAll();
  log('info', '工具已就绪：全部为本地假设数据，离线运行。预置一条 tax_rate 冲突用于演示。');
})();
