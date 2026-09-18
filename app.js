/* app.js — 界面装配：假设表、指标卡（贡献分解 + 方向扫描图）、响应编辑器、冲突面板 */
(function () {
'use strict';
const FR = window.FinReview;
let model = null;
const logs = [];

/* ---------------------------------------------------------------- 工具 */
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(x, d = 2) {
  if (typeof x !== 'number' || !isFinite(x)) return '—';
  const v = Math.round(x * 10 ** d) / 10 ** d;
  return v.toLocaleString('zh-CN', { maximumFractionDigits: d });
}
function pushLog(type, text) {
  logs.unshift({ type, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
  if (logs.length > 60) logs.pop();
  renderLog();
}
function showErrors(boxId, errors) {
  const box = $(boxId);
  box.innerHTML = (errors || []).map(e =>
    `<div class="err-item">${esc(e.message)}<span class="path">位置：${esc(e.path)}</span></div>`).join('');
}

/* ---------------------------------------------------------------- 变更驱动 */
function applyChange(changed, note) {
  const status = FR.recompute(model, changed);
  const ver = FR.verifyConsistency(model);
  renderMetrics(status, ver);
  renderConsistency(ver);
  renderConflicts();
  if (note) pushLog(note.type || 'ok', note.text);
}
function renderConsistency(ver) {
  const b = $('#consistencyBadge');
  if (ver.ok) {
    b.className = 'badge badge-ok';
    b.textContent = `增量结果 = 全量求解 ✓（${Object.keys(model.metrics).length} 项指标）`;
  } else {
    b.className = 'badge badge-bad';
    b.textContent = '✗ 增量与全量不一致';
    b.title = ver.diffs.join('\n');
  }
}

/* ---------------------------------------------------------------- 假设表 */
function conflictKeys() {
  const map = {};
  for (const c of FR.getConflicts(model)) {
    if (c.kind === 'assumption') (map[c.assumptionId] = map[c.assumptionId] || []).push(c.key);
    else (map[c.assumptionId] = map[c.assumptionId] || []).push(c.key);
  }
  return map;
}

function renderAssumptions() {
  const tbody = $('#assumptionTable tbody');
  const values = FR.currentValues(model);
  const conflicts = conflictKeys();
  const rows = Object.keys(model.assumptions).sort().map(id => {
    const a = FR.getActiveAssumption(model, id);
    const src = model.activeSource['A:' + id] || Object.keys(model.assumptions[id].variants).sort()[0];
    const step = (a.max - a.min) / 200;
    const flag = conflicts[id] ? `<span class="conflict-flag" title="存在冲突登记，见右侧面板">⚠️</span>` : '';
    return `<tr data-id="${esc(id)}">
      <td>
        <div class="a-name">${esc(a.name)}${flag}</div>
        <div class="a-meta">${esc(id)} · ${esc(a.unit || '—')}<span class="src-tag">${esc(src)}</span></div>
      </td>
      <td class="val-cell">
        <input type="range" min="${a.min}" max="${a.max}" step="${step}" value="${values[id]}" data-act="slide">
        <div class="val-read">
          <input type="number" min="${a.min}" max="${a.max}" step="any" value="${fmt(values[id], 4)}" data-act="num">
          <span class="a-meta">${esc(a.unit)}</span>
        </div>
      </td>
      <td class="num">${fmt(a.base)}</td>
      <td class="num">[${fmt(a.min)}, ${fmt(a.max)}]</td>
      <td><input class="dir-input${model.direction[id] ? ' nonzero' : ''}" type="number" step="any"
           value="${model.direction[id] || 0}" data-act="dir" title="每单位 t 的移动量（${esc(a.unit || '')}/t）"></td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');
}

$('#assumptionTable').addEventListener('input', ev => {
  const tr = ev.target.closest('tr');
  if (!tr) return;
  const id = tr.dataset.id;
  const act = ev.target.dataset.act;
  if (act === 'slide' || act === 'num') {
    const r = FR.setValue(model, id, parseFloat(ev.target.value));
    if (!r.ok) { pushLog('err', r.errors[0].message); return; }
    if (r.clamped) pushLog('err', `取值超出区间，已截断到 ${fmt(r.value, 4)}（假设 ${id}）`);
    // 拖动中只更新读数与指标卡，不重建表格
    const num = tr.querySelector('[data-act="num"]');
    const rng = tr.querySelector('[data-act="slide"]');
    if (act === 'slide') num.value = fmt(r.value, 4); else rng.value = r.value;
    applyChange({ assumptions: [id] });
  } else if (act === 'dir') {
    const w = parseFloat(ev.target.value);
    const r = FR.setDirection(model, id, isNaN(w) ? 0 : w);
    if (!r.ok) { pushLog('err', r.errors[0].message); return; }
    ev.target.classList.toggle('nonzero', !!model.direction[id]);
    applyChange({ direction: true });
  }
});

/* ---------------------------------------------------------------- 指标卡 */
function waterfallSVG(dec) {
  const rows = dec.contributions;
  const H = rows.length * 26 + 46, W = 340, cx = 150, bw = 150;
  const maxAbs = Math.max(1e-9, ...rows.map(r => Math.abs(r.contribution)));
  const sx = v => cx + (v / maxAbs) * (bw - 20);
  let y = 26;
  let bars = '';
  for (const r of rows) {
    const x0 = sx(Math.min(0, r.contribution)), x1 = sx(Math.max(0, r.contribution));
    const color = r.contribution >= 0 ? 'var(--pos)' : 'var(--neg)';
    bars += `<text x="8" y="${y + 10}" font-size="11" fill="var(--ink)">${esc(r.name)}</text>
      <rect x="${x0}" y="${y}" width="${Math.max(1, x1 - x0)}" height="14" rx="3" fill="${color}" opacity="0.85"/>
      <text x="${x1 + 5 > cx + bw - 20 ? x0 - 5 : x1 + 5}" y="${y + 11}" font-size="11" text-anchor="${x1 + 5 > cx + bw - 20 ? 'end' : 'start'}" fill="var(--ink-dim)">${r.contribution >= 0 ? '+' : ''}${fmt(r.contribution)}</text>`;
    y += 26;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="贡献分解">
    <line x1="${cx}" y1="18" x2="${cx}" y2="${H - 22}" stroke="var(--line)"/>
    ${bars}
    <text x="8" y="${H - 6}" font-size="11" fill="var(--ink-dim)">基准 ${fmt(dec.baseValue)} → 当前 ${fmt(dec.value)}（总变化 ${dec.totalChange >= 0 ? '+' : ''}${fmt(dec.totalChange)}）</text>
  </svg>`;
}

function sweepChartSVG(metric, sweep) {
  const W = 380, H = 170, pl = 44, pr = 10, pt = 12, pb = 24;
  const iw = W - pl - pr, ih = H - pt - pb;
  const lo = Math.min(sweep.reachable.min, metric.threshold);
  const hi = Math.max(sweep.reachable.max, metric.threshold);
  const pad = (hi - lo) * 0.12 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const X = t => pl + (t / sweep.tHi) * iw;
  const Y = m => pt + (1 - (m - y0) / (y1 - y0)) * ih;
  const thetaY = Y(metric.threshold);

  let shade = '';
  for (const iv of sweep.violatedIntervals) {
    shade += `<rect x="${X(iv.t0)}" y="${pt}" width="${Math.max(1, X(iv.t1) - X(iv.t0))}" height="${ih}" fill="var(--bad)" opacity="0.07"/>`;
  }
  const pts = sweep.points.map(p => `${X(p.t).toFixed(1)},${Y(p.m).toFixed(1)}`).join(' ');
  let marks = '';
  for (const c of sweep.crossings) {
    if (c.type === 'plateau') {
      marks += `<line x1="${X(c.t0)}" y1="${thetaY}" x2="${X(c.t1)}" y2="${thetaY}" stroke="#5b4bc4" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`;
    } else {
      const m = metric.threshold;
      const color = c.type === 'touch' ? 'var(--warn)' : 'var(--bad)';
      marks += `<circle cx="${X(c.t)}" cy="${Y(m)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.5"/>`;
    }
  }
  let first = '';
  if (sweep.firstCrossing && !sweep.firstCrossing.touchedOnly) {
    const t = sweep.firstCrossing.t;
    first = `<circle cx="${X(t)}" cy="${thetaY}" r="7" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text x="${Math.min(X(t) + 9, W - 60)}" y="${thetaY - 8}" font-size="11" fill="var(--accent)" font-weight="700">t*=${fmt(t, 3)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="方向扫描曲线">
    ${shade}
    <line x1="${pl}" y1="${thetaY}" x2="${W - pr}" y2="${thetaY}" stroke="var(--bad)" stroke-dasharray="5 4" stroke-width="1.2"/>
    <text x="4" y="${thetaY + 4}" font-size="10" fill="var(--bad)">决策线 ${fmt(metric.threshold)}</text>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${marks}${first}
    <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${H - pb}" stroke="var(--line)"/>
    <line x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}" stroke="var(--line)"/>
    <text x="${pl}" y="${H - 8}" font-size="10" fill="var(--ink-dim)">t=0（当前）</text>
    <text x="${W - pr}" y="${H - 8}" font-size="10" text-anchor="end" fill="var(--ink-dim)">t=${fmt(sweep.tHi, 2)}（触界）</text>
    <text x="4" y="${pt + 4}" font-size="10" fill="var(--ink-dim)">${fmt(y1)}</text>
    <text x="4" y="${H - pb}" font-size="10" fill="var(--ink-dim)">${fmt(y0)}</text>
  </svg>`;
}

function sweepSummaryHTML(metric, sweep) {
  if (sweep.empty) return `<p class="hint">${esc(sweep.reason)}</p>`;
  const parts = [];

  // 首次越线
  const fc = sweep.firstCrossing;
  if (fc && !fc.touchedOnly) {
    const moving = Object.keys(model.direction).filter(id => model.direction[id]);
    const vals = moving.map(id => {
      const a = FR.getActiveAssumption(model, id);
      return `${esc(a.name)}=<span class="num">${fmt(fc.values[id], 3)}${esc(a.unit)}</span>`;
    }).join('，');
    const tops = (fc.contributors || []).slice(0, 3)
      .map(c => `${esc(c.name)} ${c.contribution >= 0 ? '+' : ''}${fmt(c.contribution)}`).join('；');
    parts.push(`<div class="first-box${fc.note ? ' violated-now' : ''}">
      ${fc.note ? `<div><strong>${esc(fc.note)}</strong></div>` : ''}
      <div>首次越线：<span class="big">t* = ${fmt(fc.t, 4)}</span>（指标=${fmt(fc.metricValue)} ${esc(metric.unit)}）</div>
      <div class="kv">该处假设取值：${vals || '—'}</div>
      <div class="kv">越线时在起作用（贡献前三）：${tops}</div>
    </div>`);
  } else if (fc && fc.touchedOnly) {
    parts.push(`<div class="first-box"><strong>${esc(fc.note)}</strong>（t=${fmt(fc.t, 4)}）</div>`);
  } else {
    parts.push(`<div class="first-box none">沿该方向在可行范围 [0, ${fmt(sweep.tHi, 3)}] 内不越线。</div>`);
  }
  if (sweep.unreachable) parts.push(`<div class="first-box none">不可达：${esc(sweep.unreachable.message)}</div>`);
  if (sweep.valueGaps.length) {
    parts.push(`<div class="kv">值域缺口（不可达区间）：${sweep.valueGaps.map(g => `(${fmt(g.from)}, ${fmt(g.to)})`).join('，')}</div>`);
  }

  // 全部穿越点
  const items = sweep.crossings.map(c => {
    if (c.type === 'plateau') return `<li><span class="tag tag-plateau">平台重合</span><span class="t">t ∈ [${fmt(c.t0, 4)}, ${fmt(c.t1, 4)}]</span> 指标压在决策线上</li>`;
    if (c.type === 'touch') return `<li><span class="tag tag-touch">触及未穿越</span><span class="t">t = ${fmt(c.t, 4)}</span></li>`;
    const dir = { up: '上穿', down: '下穿', into: '进入越线', out: '回到合规' }[c.direction] || '穿越';
    const kind = c.kind === 'jump' ? '（跳变）' : '';
    return `<li><span class="tag tag-cross">穿越${kind}</span><span class="t">t = ${fmt(c.t, 4)}</span> ${dir}</li>`;
  });
  parts.push(`<p class="block-title">全部穿越点（${sweep.crossings.length}）</p>
    <ul class="cross-list">${items.length ? items.join('') : '<li class="hint">无</li>'}</ul>`);

  const ivs = sweep.violatedIntervals.map(iv => `<span class="tag tag-interval">越线 t∈[${fmt(iv.t0, 3)}, ${fmt(iv.t1, 3)}]</span>`).join('');
  if (ivs) parts.push(`<div class="kv">${ivs}</div>`);
  return parts.join('');
}

function renderMetrics(status, ver) {
  const host = $('#metricCards');
  const values = FR.currentValues(model);
  host.innerHTML = Object.keys(model.metrics).sort().map(mid => {
    const metric = model.metrics[mid];
    const cache = model._cache[mid] || {};
    const dec = cache.decomp || FR.computeDecomposition(model, mid, values);
    const sweep = cache.sweep || FR.sweepDirection(model, mid, values, model.direction);
    const violatedNow = metric.limit === 'min' ? dec.value < metric.threshold : dec.value > metric.threshold;
    const st = status && status[mid] === 'unchanged'
      ? '<span class="badge badge-dim">未受影响 · 结论保持</span>'
      : `<span class="badge ${ver && ver.ok ? 'badge-ok' : 'badge-bad'}">已重算 · ${ver && ver.ok ? '与全量一致 ✓' : '与全量不一致 ✗'}</span>`;
    return `<div class="metric-card">
      <div class="metric-head">
        <h3>${esc(metric.name)}</h3>
        <span class="metric-val ${violatedNow ? 'violated' : 'ok'}">${fmt(dec.value)} ${esc(metric.unit)}</span>
        <span class="badge ${violatedNow ? 'badge-bad' : 'badge-ok'}">${violatedNow ? '已越线' : '合规'}</span>
        ${st}
        <span class="metric-sub">基准 ${fmt(metric.baseValue)} · 决策线 ${metric.limit === 'min' ? '≥' : '≤'} ${fmt(metric.threshold)} ${esc(metric.unit)}</span>
      </div>
      <div class="grid2">
        <div>
          <p class="block-title">贡献分解（相对基准）</p>
          ${waterfallSVG(dec)}
          <p class="sumcheck ${dec.sumCheck.ok ? 'ok' : 'bad'}">贡献之和 ${fmt(dec.sumCheck.sumOfContributions, 6)} ${dec.sumCheck.ok ? '=' : '≠'} 总变化 ${fmt(dec.sumCheck.totalChange, 6)} ${dec.sumCheck.ok ? '✓' : '✗'}</p>
        </div>
        <div>
          <p class="block-title">沿扰动方向扫描</p>
          ${sweep.empty ? '' : sweepChartSVG(metric, sweep)}
          ${sweepSummaryHTML(metric, sweep)}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- 冲突面板 */
function renderConflicts() {
  const list = FR.getConflicts(model);
  $('#conflictCount').textContent = list.length;
  $('#conflictList').innerHTML = list.length ? list.map(c => {
    const chosen = model.activeSource[c.key] || c.entries.map(e => e.source).sort()[0];
    const radios = c.entries.map(e =>
      `<label><input type="radio" name="cf_${esc(c.key)}" value="${esc(e.source)}" ${e.source === chosen ? 'checked' : ''} data-key="${esc(c.key)}"> 采用「${esc(e.source)}」</label>`).join('');
    return `<div class="conflict-item"><p class="msg">⚠️ ${esc(c.message)}</p><div class="pick">${radios}</div></div>`;
  }).join('') : '<p class="conflict-empty">暂无冲突：各来源登记一致。</p>';
}
$('#conflictList').addEventListener('change', ev => {
  const key = ev.target.dataset.key;
  if (!key) return;
  FR.setActiveSource(model, key, ev.target.value);
  const id = key.startsWith('A:') ? key.slice(2) : key.split('/')[1];
  pushLog('ok', `冲突项 ${key} 改用来源「${ev.target.value}」`);
  renderAssumptions();
  applyChange({ assumptions: [id] });
});

/* ---------------------------------------------------------------- 日志 */
function renderLog() {
  $('#logList').innerHTML = logs.map(l =>
    `<div class="log-item ${l.type}"><span class="time">${l.time}</span>${esc(l.text)}</div>`).join('');
}

/* ---------------------------------------------------------------- 表单：假设 */
$('#af_submit').addEventListener('click', () => {
  const num = id => { const v = $(id).value.trim(); return v === '' ? NaN : parseFloat(v); };
  const a = {
    id: $('#af_id').value.trim(), name: $('#af_name').value.trim(), unit: $('#af_unit').value.trim(),
    base: num('#af_base'), min: num('#af_min'), max: num('#af_max'),
  };
  const src = $('#af_source').value.trim() || '评审修订';
  const replace = $('#af_replace').checked;
  const r = FR.registerAssumption(model, a, src, { replace });
  if (!r.ok) {
    showErrors('#af_errors', r.errors);
    pushLog('err', `假设登记被拒绝：${r.errors[0].message}`);
    return;
  }
  showErrors('#af_errors', []);
  pushLog('ok', `假设「${a.id}」已${replace ? '修改' : '登记'}（来源：${src}）`);
  renderAssumptions(); fillResponseSelects();
  applyChange({ assumptions: [a.id] });
});

/* ---------------------------------------------------------------- 表单：指标 */
$('#mf_submit').addEventListener('click', () => {
  const num = id => { const v = $(id).value.trim(); return v === '' ? NaN : parseFloat(v); };
  const m = {
    id: $('#mf_id').value.trim(), name: $('#mf_name').value.trim(), unit: $('#mf_unit').value.trim(),
    baseValue: num('#mf_base'), threshold: num('#mf_threshold'), limit: $('#mf_limit').value,
  };
  const r = FR.registerMetric(model, m);
  if (!r.ok) {
    showErrors('#mf_errors', r.errors);
    pushLog('err', `指标登记被拒绝：${r.errors[0].message}`);
    return;
  }
  showErrors('#mf_errors', []);
  pushLog('ok', `指标「${m.id}」已登记`);
  fillResponseSelects();
  applyChange({ metrics: [m.id] });
});

/* ---------------------------------------------------------------- 表单：响应段 */
function fillResponseSelects() {
  $('#rf_metric').innerHTML = Object.keys(model.metrics).sort()
    .map(id => `<option value="${esc(id)}">${esc(model.metrics[id].name)}（${esc(id)}）</option>`).join('');
  $('#rf_assumption').innerHTML = Object.keys(model.assumptions).sort()
    .map(id => `<option value="${esc(id)}">${esc(FR.getActiveAssumption(model, id).name)}（${esc(id)}）</option>`).join('');
  loadResponseText();
}
function loadResponseText() {
  const mid = $('#rf_metric').value, aid = $('#rf_assumption').value;
  const resp = FR.getActiveResponse(model, mid, aid);
  $('#rf_segments').value = resp
    ? resp.segments.map(s => `${s.x0}, ${s.y0} → ${s.x1}, ${s.y1}`).join('\n')
    : '';
}
$('#rf_metric').addEventListener('change', loadResponseText);
$('#rf_assumption').addEventListener('change', loadResponseText);

function parseSegmentsText(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const segs = [], errors = [];
  lines.forEach((line, i) => {
    const nums = line.match(/[-+]?\d+(\.\d+)?([eE][-+]?\d+)?/g);
    if (!nums || nums.length !== 4) {
      errors.push({ path: `第 ${i + 1} 行`, message: `第 ${i + 1} 行无法解析：每行需要恰好 4 个数字（x0, y0 → x1, y1），实际 ${nums ? nums.length : 0} 个` });
      return;
    }
    segs.push({ x0: +nums[0], y0: +nums[1], x1: +nums[2], y1: +nums[3] });
  });
  if (!lines.length) errors.push({ path: 'segments', message: '内容为空：请至少录入一段' });
  return { segs, errors };
}

$('#rf_submit').addEventListener('click', () => {
  const mid = $('#rf_metric').value, aid = $('#rf_assumption').value;
  const src = $('#rf_source').value.trim() || '评审修订';
  const { segs, errors } = parseSegmentsText($('#rf_segments').value);
  if (errors.length) {
    showErrors('#rf_errors', errors);
    pushLog('err', `响应登记被拒绝：${errors[0].message}`);
    return;
  }
  const r = FR.registerResponse(model, mid, aid, segs, src, { replace: true });
  if (!r.ok) {
    showErrors('#rf_errors', r.errors);
    pushLog('err', `响应登记被拒绝：${r.errors[0].message}`);
    return;
  }
  showErrors('#rf_errors', []);
  pushLog('ok', `响应「${aid} → ${mid}」已登记（来源：${src}，${segs.length} 段）`);
  renderAssumptions();
  applyChange({ assumptions: [aid] });
});

/* ---------------------------------------------------------------- 启动 */
$('#btnReset').addEventListener('click', () => { boot(); pushLog('ok', '已重置为内置示例方案'); });

function boot() {
  model = window.FinReviewSample.buildSampleModel(FR);
  FR.recompute(model, { all: true });
  renderAssumptions();
  fillResponseSelects();
  const ver = FR.verifyConsistency(model);
  renderMetrics(FR.recompute(model, { all: true }), ver);
  renderConsistency(ver);
  renderConflicts();
  renderLog();
}
boot();
pushLog('ok', '示例方案已加载：5 个假设、2 项指标、2 个来源（含 2 处冲突登记），可直接拖动滑杆评审。');
})();
