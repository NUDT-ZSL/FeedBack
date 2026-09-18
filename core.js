/* ============================================================================
 * core.js — 财务方案评审工具核心逻辑
 * 纯逻辑、无 DOM 依赖：浏览器 <script> 与 Node require 均可加载。
 *
 * 模型概念：
 *   - 假设 assumption：{ id, name, unit, base, min, max }，按来源(source)登记，
 *     同一来源重复登记同一 id 拒绝；不同来源给出矛盾内容时双方保留并生成冲突记录。
 *   - 指标 metric：{ id, name, unit, baseValue, threshold, limit }
 *     limit='min' 表示 M < threshold 越线；'max' 表示 M > threshold 越线。
 *   - 响应 response：某假设对某指标的分段线性函数（其它假设取基准时该指标的取值），
 *     段区间必须首尾相接、不重叠、完整覆盖 [min, max]。
 *   - 指标值 = baseValue + Σ_a ( f_a(x_a) − f_a(base_a) )，
 *     因此各假设贡献之和恒等于总变化（构造保证）。
 * ========================================================================== */
(function (global) {
'use strict';

const EPS = 1e-9;

function nearlyEq(a, b) { return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b)); }
function sortedKeys(obj) { return Object.keys(obj).sort(); }
function isNum(x) { return typeof x === 'number' && isFinite(x); }

/* ---------------------------------------------------------------- 模型创建 */

function createModel() {
  return {
    metrics: {},      // id -> {id,name,unit,baseValue,threshold,limit}
    assumptions: {},  // id -> { variants: { source: {id,name,unit,base,min,max} } }
    responses: {},    // metricId -> assumptionId -> { variants: { source: {segments:[...]} } }
    activeSource: {}, // 'A:<id>' 或 'R:<metric>/<assumption>' -> source（冲突时采用哪一方）
    values: {},       // assumptionId -> 当前取值（用户拖动）
    direction: {},    // assumptionId -> 方向权重（每单位 t 的移动量）
    versions: {},     // 变更戳，供缓存失效与调试
    _cache: {},       // metricId -> { decomp, sweep }（增量结果）
  };
}

function bump(model, key) { model.versions[key] = (model.versions[key] || 0) + 1; }

function pickSource(model, key, variants) {
  const chosen = model.activeSource[key];
  if (chosen && variants[chosen]) return chosen;
  return Object.keys(variants).sort()[0]; // 确定性默认：字典序最小来源，与登记顺序无关
}

function getActiveAssumption(model, id) {
  const e = model.assumptions[id];
  if (!e) return null;
  return e.variants[pickSource(model, 'A:' + id, e.variants)] || null;
}

function getActiveResponse(model, metricId, assumptionId) {
  const e = (model.responses[metricId] || {})[assumptionId];
  if (!e) return null;
  return e.variants[pickSource(model, 'R:' + metricId + '/' + assumptionId, e.variants)] || null;
}

function setActiveSource(model, key, source) {
  model.activeSource[key] = source;
  bump(model, key);
}

/* ---------------------------------------------------------------- 登记：指标 */

function registerMetric(model, m) {
  const errors = [];
  if (!m || typeof m.id !== 'string' || !m.id.trim()) {
    errors.push({ path: 'metrics.<id>', message: '指标标识为空：每个指标需要唯一标识 id' });
    return { ok: false, errors };
  }
  const id = m.id.trim();
  if (model.metrics[id]) {
    errors.push({ path: 'metrics.' + id, message: `标识重复：指标「${id}」已存在（位置：metrics.${id}）` });
    return { ok: false, errors };
  }
  if (!isNum(m.baseValue)) errors.push({ path: `metrics.${id}.baseValue`, message: `指标「${id}」基准值缺失或不是有限数值` });
  if (!isNum(m.threshold)) errors.push({ path: `metrics.${id}.threshold`, message: `指标「${id}」决策阈值缺失或不是有限数值` });
  if (m.limit !== 'min' && m.limit !== 'max') errors.push({ path: `metrics.${id}.limit`, message: `指标「${id}」越线方向 limit 只能是 'min'（低于阈值越线）或 'max'（高于阈值越线）` });
  if (errors.length) return { ok: false, errors };
  model.metrics[id] = {
    id, name: m.name || id, unit: m.unit || '',
    baseValue: m.baseValue, threshold: m.threshold, limit: m.limit,
  };
  bump(model, 'M:' + id);
  return { ok: true };
}

/* ---------------------------------------------------------------- 登记：假设 */

function validateAssumption(a) {
  const errors = [];
  const at = (f) => `assumptions.${a && a.id ? a.id : '?'}.${f}`;
  if (!a || typeof a.id !== 'string' || !a.id.trim()) {
    return [{ path: 'assumptions.<id>', message: '假设标识为空：每个假设需要唯一标识 id' }];
  }
  for (const f of ['base', 'min', 'max']) {
    if (!isNum(a[f])) errors.push({ path: at(f), message: `假设「${a.id}」字段 ${f} 缺失或不是有限数值` });
  }
  if (errors.length) return errors;
  if (!(a.min < a.max)) {
    errors.push({ path: at('min') + '/' + at('max'), message: `区间非法：假设「${a.id}」下限 ${a.min} 必须小于上限 ${a.max}` });
  }
  if (a.base < a.min - EPS || a.base > a.max + EPS) {
    errors.push({ path: at('base'), message: `基准值越界：假设「${a.id}」基准 ${a.base} 不在扰动区间 [${a.min}, ${a.max}] 内` });
  }
  return errors;
}

/** opts.replace=true 表示“修订同来源已有登记”；否则同来源同 id 拒绝。 */
function registerAssumption(model, a, source, opts) {
  source = (source && String(source).trim()) || '默认来源';
  const errors = validateAssumption(a);
  if (errors.length) return { ok: false, errors };
  const id = a.id.trim();
  const record = { id, name: a.name || id, unit: a.unit || '', base: a.base, min: a.min, max: a.max };
  let entry = model.assumptions[id];
  if (!entry) { entry = model.assumptions[id] = { variants: {} }; }
  if (entry.variants[source] && !(opts && opts.replace)) {
    return { ok: false, errors: [{ path: 'assumptions.' + id, message: `标识重复：来源「${source}」已登记过假设「${id}」（位置：assumptions.${id}；若为修订请使用“修改/覆盖”操作）` }] };
  }
  entry.variants[source] = record;
  bump(model, 'A:' + id);
  // 当前取值保持在新边界内；首次登记时取基准
  const active = getActiveAssumption(model, id);
  if (model.values[id] === undefined) model.values[id] = active.base;
  else model.values[id] = Math.min(Math.max(model.values[id], active.min), active.max);
  if (model.direction[id] === undefined) model.direction[id] = 0;
  return { ok: true };
}

/* ---------------------------------------------------------------- 登记：响应段 */

/** 校验分段：首尾相接、不重叠、完整覆盖 [lo,hi]。返回错误数组（含段位置）。 */
function validateSegments(segs, lo, hi) {
  const errors = [];
  if (!Array.isArray(segs) || segs.length === 0) {
    return [{ path: 'segments', message: '响应段为空：至少需要一段分段线性区间' }];
  }
  segs.forEach((s, i) => {
    for (const f of ['x0', 'y0', 'x1', 'y1']) {
      if (!isNum(s[f])) errors.push({ path: `segments[${i}].${f}`, message: `第 ${i + 1} 段字段 ${f} 缺失或不是有限数值` });
    }
    if (isNum(s.x0) && isNum(s.x1) && !(s.x1 > s.x0)) {
      errors.push({ path: `segments[${i}]`, message: `第 ${i + 1} 段非法：终点 x1=${s.x1} 必须大于起点 x0=${s.x0}` });
    }
  });
  if (errors.length) return errors;

  const sorted = segs.map((s, i) => ({ ...s, _i: i }))
    .sort((p, q) => (p.x0 - q.x0) || (p.x1 - q.x1));

  for (const s of sorted) {
    if (s.x0 < lo - EPS || s.x1 > hi + EPS) {
      errors.push({ path: `segments[${s._i}]`, message: `第 ${s._i + 1} 段 [${s.x0}, ${s.x1}] 越界：超出假设取值区间 [${lo}, ${hi}]` });
    }
  }
  if (!nearlyEq(sorted[0].x0, lo) && sorted[0].x0 > lo) {
    errors.push({ path: `segments[${sorted[0]._i}]`, message: `断点缺失：首段起点 x0=${sorted[0].x0} 未衔接区间下限 ${lo}，[${lo}, ${sorted[0].x0}] 无响应定义` });
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i], nxt = sorted[i + 1];
    if (nxt.x0 > cur.x1 + EPS) {
      errors.push({ path: `segments[${cur._i}]/segments[${nxt._i}]`, message: `断点缺失：第 ${cur._i + 1} 段终点 ${cur.x1} 与第 ${nxt._i + 1} 段起点 ${nxt.x0} 之间存在缺口 (${cur.x1}, ${nxt.x0})` });
    } else if (nxt.x0 < cur.x1 - EPS) {
      errors.push({ path: `segments[${cur._i}]/segments[${nxt._i}]`, message: `区间重叠：第 ${cur._i + 1} 段终点 ${cur.x1} 与第 ${nxt._i + 1} 段起点 ${nxt.x0} 重叠于 [${nxt.x0}, ${cur.x1}]` });
    }
  }
  const last = sorted[sorted.length - 1];
  if (!nearlyEq(last.x1, hi) && last.x1 < hi) {
    errors.push({ path: `segments[${last._i}]`, message: `断点缺失：末段终点 x1=${last.x1} 未覆盖区间上限 ${hi}，[${last.x1}, ${hi}] 无响应定义` });
  }
  if (errors.length) return errors;
  // 校验通过：返回规范化（按 x0 排序）的段
  return { ok: true, sorted: sorted.map(({ _i, ...s }) => s) };
}

function registerResponse(model, metricId, assumptionId, segments, source, opts) {
  source = (source && String(source).trim()) || '默认来源';
  const errors = [];
  if (!model.metrics[metricId]) {
    errors.push({ path: 'responses.' + metricId, message: `指标不存在：「${metricId}」尚未登记，无法挂接响应` });
  }
  const aEntry = model.assumptions[assumptionId];
  if (!aEntry) {
    errors.push({ path: 'responses.' + assumptionId, message: `假设不存在：「${assumptionId}」尚未登记，无法挂接响应` });
  }
  if (errors.length) return { ok: false, errors };

  // 用同来源假设变体的边界校验；该来源未登记假设则用当前生效变体
  const av = aEntry.variants[source] || getActiveAssumption(model, assumptionId);
  const check = validateSegments(segments, av.min, av.max);
  if (Array.isArray(check)) return { ok: false, errors: check };

  if (!model.responses[metricId]) model.responses[metricId] = {};
  if (!model.responses[metricId][assumptionId]) model.responses[metricId][assumptionId] = { variants: {} };
  const slot = model.responses[metricId][assumptionId];
  if (slot.variants[source] && !(opts && opts.replace)) {
    return { ok: false, errors: [{ path: `responses.${metricId}.${assumptionId}`, message: `标识重复：来源「${source}」已登记过响应「${assumptionId} → ${metricId}」（若为修订请使用“修改/覆盖”操作）` }] };
  }
  slot.variants[source] = { segments: check.sorted };
  bump(model, 'R:' + metricId + '/' + assumptionId);
  return { ok: true };
}

/* ---------------------------------------------------------------- 求值 */

function findSegment(segs, x) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (x < s.x1 - EPS || i === segs.length - 1) {
      if (x >= s.x0 - EPS) return s;
    }
  }
  return null;
}

/** 分段线性求值；x 超出定义域时截断到端点（右连续）。 */
function evaluateSegments(segs, x) {
  const lo = segs[0].x0, hi = segs[segs.length - 1].x1;
  const xc = Math.min(Math.max(x, lo), hi);
  const s = findSegment(segs, xc);
  if (!s) return segs[segs.length - 1].y1;
  const r = (xc - s.x0) / (s.x1 - s.x0);
  return s.y0 + r * (s.y1 - s.y0);
}

function currentValues(model) {
  const v = {};
  for (const id of sortedKeys(model.assumptions)) {
    const a = getActiveAssumption(model, id);
    if (!a) continue;
    const raw = model.values[id] !== undefined ? model.values[id] : a.base;
    v[id] = Math.min(Math.max(raw, a.min), a.max);
  }
  return v;
}

/** 指标值与贡献分解：贡献之和恒等于总变化。 */
function computeDecomposition(model, metricId, values) {
  const metric = model.metrics[metricId];
  const resps = model.responses[metricId] || {};
  const contributions = [];
  let total = 0;
  for (const aid of sortedKeys(resps)) {
    const a = getActiveAssumption(model, aid);
    const resp = getActiveResponse(model, metricId, aid);
    if (!a || !resp) continue;
    const v = values[aid] !== undefined ? values[aid] : a.base;
    const c = evaluateSegments(resp.segments, v) - evaluateSegments(resp.segments, a.base);
    contributions.push({ assumptionId: aid, name: a.name, unit: a.unit, value: v, base: a.base, contribution: c });
    total += c;
  }
  const value = metric.baseValue + total;
  return {
    metricId, baseValue: metric.baseValue, value, totalChange: total,
    contributions,
    sumCheck: { sumOfContributions: total, totalChange: total, ok: nearlyEq(total, value - metric.baseValue) },
  };
}

/* ---------------------------------------------------------------- 方向扫描 */

/**
 * 沿方向 direction（assumptionId -> 权重）从 origin（当前取值）出发扫描 t ∈ [0, tHi]。
 * 返回全部穿越点（cross/touch/plateau）、越线/合规/线上区间、不可达信息。
 * 结果仅依赖排序后的键与数值，与登记顺序无关。
 */
function sweepDirection(model, metricId, origin, direction) {
  const metric = model.metrics[metricId];
  const theta = metric.threshold;
  const limit = metric.limit;
  const resps = model.responses[metricId] || {};
  const tol = 1e-9 * Math.max(1, Math.abs(metric.baseValue), Math.abs(theta));

  const moving = sortedKeys(direction).filter(id => Math.abs(direction[id]) > EPS && model.assumptions[id]);
  if (!moving.length) return { metricId, empty: true, reason: '扰动方向为空：所有假设的方向权重均为 0' };

  // 可行 t 上界：任一移动假设触界即停
  let tHi = Infinity;
  for (const id of moving) {
    const a = getActiveAssumption(model, id);
    const w = direction[id], v = origin[id];
    const t1 = (a.min - v) / w, t2 = (a.max - v) / w;
    tHi = Math.min(tHi, Math.max(t1, t2));
  }
  if (!(tHi > 0)) return { metricId, empty: true, reason: '沿该方向无可行步长：起点已贴在某个假设的边界上', tHi: 0 };

  // 断点：任一移动假设的响应段边界映射到 t
  const bpSet = new Set([0, tHi]);
  for (const id of moving) {
    const resp = getActiveResponse(model, metricId, id);
    if (!resp) continue;
    const w = direction[id], v = origin[id];
    for (const s of resp.segments) {
      for (const xb of [s.x0, s.x1]) {
        const t = (xb - v) / w;
        if (t > EPS && t < tHi - EPS) bpSet.add(t);
      }
    }
  }
  const T = [];
  for (const t of [...bpSet].sort((a, b) => a - b)) {
    if (!T.length || t - T[T.length - 1] > EPS * Math.max(1, t)) T.push(t);
  }

  const valueAt = (t) => {
    let m = metric.baseValue;
    for (const aid of sortedKeys(resps)) {
      const a = getActiveAssumption(model, aid);
      const resp = getActiveResponse(model, metricId, aid);
      if (!a || !resp) continue;
      const w = direction[aid] || 0;
      m += evaluateSegments(resp.segments, origin[aid] + t * w) - evaluateSegments(resp.segments, a.base);
    }
    return m;
  };
  const slopeOn = (t0, t1) => {
    const tm = (t0 + t1) / 2;
    let s = 0;
    for (const id of moving) {
      const resp = getActiveResponse(model, metricId, id);
      if (!resp) continue;
      const seg = findSegment(resp.segments, origin[id] + tm * direction[id]);
      if (seg) s += direction[id] * (seg.y1 - seg.y0) / (seg.x1 - seg.x0);
    }
    return s;
  };
  const valuesAtT = (t) => {
    const out = {};
    for (const id of sortedKeys(model.assumptions)) {
      const a = getActiveAssumption(model, id);
      const w = direction[id] || 0;
      out[id] = Math.min(Math.max(origin[id] + t * w, a.min), a.max);
    }
    return out;
  };

  const violated = g => (limit === 'min' ? g < -tol : g > tol);
  const stateOf = g => (violated(g) ? 'violated' : 'ok');
  const pts = T.map(t => ({ t, m: valueAt(t) }));

  // 逐初等区间：内部穿越处一分为二再分别定态；断点处处理跳变穿越
  const intervals = [];
  const crossings = [];
  const allM = [];
  let prevGR = null;
  for (let i = 0; i < T.length - 1; i++) {
    const t0 = T[i], t1 = T[i + 1];
    const gL = pts[i].m - theta;
    const slope = slopeOn(t0, t1);
    const gR = gL + slope * (t1 - t0); // t1 处左极限
    allM.push(gL + theta, gR + theta);

    if (prevGR !== null && ((prevGR < -tol && gL > tol) || (prevGR > tol && gL < -tol))) {
      crossings.push({ type: 'cross', kind: 'jump', t: t0, direction: gL > prevGR ? 'up' : 'down' });
    }

    const isLine = Math.abs(gL) <= tol && Math.abs(gR) <= tol;
    if (isLine) {
      intervals.push({ t0, t1, state: 'line' });
    } else if ((gL < -tol && gR > tol) || (gL > tol && gR < -tol)) {
      // 区间内穿越：tc 必为内点（端点异号且都非零）
      const tc = t0 - gL * (t1 - t0) / (gR - gL);
      crossings.push({ type: 'cross', kind: 'linear', t: tc, direction: gR > gL ? 'up' : 'down' });
      intervals.push({ t0, t1: tc, state: stateOf(gL) });
      intervals.push({ t0: tc, t1, state: stateOf(gR) });
    } else {
      const gEff = Math.abs(gL) <= tol ? gR : (Math.abs(gR) <= tol ? gL : (gL + gR) / 2);
      intervals.push({ t0, t1, state: stateOf(gEff) });
    }
    prevGR = gR;
  }

  // 原始断点处的触及(touch)/穿越补判：比较该点两侧子区间状态
  for (let i = 1; i < T.length - 1; i++) {
    const t = T[i];
    let L = null, R = null;
    for (const iv of intervals) {
      if (Math.abs(iv.t1 - t) <= tol * 10) L = iv;
      if (!R && Math.abs(iv.t0 - t) <= tol * 10) R = iv;
    }
    if (!L || !R || L.state === 'line' || R.state === 'line') continue;
    if (L.state !== R.state) {
      if (!crossings.some(c => Math.abs(c.t - t) <= tol * 10)) {
        crossings.push({ type: 'cross', kind: 'kink', t, direction: R.state === 'violated' ? 'into' : 'out' });
      }
    } else if (Math.abs(pts[i].m - theta) <= tol) {
      crossings.push({ type: 'touch', t });
    }
  }

  // 合并相邻同态区间；平台区间
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.state === iv.state && nearlyEq(last.t1, iv.t0)) last.t1 = iv.t1;
    else merged.push({ ...iv });
  }
  const plateauIntervals = merged.filter(iv => iv.state === 'line').map(iv => ({ t0: iv.t0, t1: iv.t1 }));
  for (const p of plateauIntervals) crossings.push({ type: 'plateau', t0: p.t0, t1: p.t1 });
  crossings.sort((a, b) => ((a.t !== undefined ? a.t : a.t0) - (b.t !== undefined ? b.t : b.t0)));

  const violatedIntervals = merged.filter(iv => iv.state === 'violated').map(iv => ({ t0: iv.t0, t1: iv.t1 }));
  const okIntervals = merged.filter(iv => iv.state === 'ok').map(iv => ({ t0: iv.t0, t1: iv.t1 }));

  // 首次越线
  let firstCrossing = null;
  const firstV = merged.find(iv => iv.state === 'violated');
  if (firstV) {
    const note = firstV.t0 <= tol ? '起点（当前取值组合）已越过决策线' : null;
    firstCrossing = { t: firstV.t0, note, values: valuesAtT(firstV.t0), metricValue: valueAt(firstV.t0) };
  } else if (plateauIntervals.length) {
    const p = plateauIntervals[0];
    firstCrossing = { t: p.t0, note: '触及决策线但未穿越（落在平台上）', touchedOnly: true, values: valuesAtT(p.t0), metricValue: theta };
  }
  if (firstCrossing) {
    const dec = computeDecomposition(model, metricId, firstCrossing.values);
    firstCrossing.contributors = dec.contributions
      .slice().sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.assumptionId.localeCompare(b.assumptionId))
      .map(c => ({ assumptionId: c.assumptionId, name: c.name, contribution: c.contribution }));
  }

  // 可达值域与不可达区间（响应段允许 y 跳变，值域可能有缺口）
  const mMin = Math.min(...allM), mMax = Math.max(...allM);
  const ranges = [];
  for (let i = 0; i < T.length - 1; i++) {
    const gL = pts[i].m, slope = slopeOn(T[i], T[i + 1]);
    const gR = gL + slope * (T[i + 1] - T[i]);
    ranges.push([Math.min(gL, gR), Math.max(gL, gR)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const mergedRanges = [];
  for (const r of ranges) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (last && r[0] <= last[1] + tol) last[1] = Math.max(last[1], r[1]);
    else mergedRanges.push([r[0], r[1]]);
  }
  const valueGaps = [];
  for (let i = 0; i < mergedRanges.length - 1; i++) {
    valueGaps.push({ from: mergedRanges[i][1], to: mergedRanges[i + 1][0] });
  }
  let unreachable = null;
  if (!violatedIntervals.length && !crossings.length) {
    if (limit === 'min' && mMin > theta + tol) {
      unreachable = { side: 'below', gap: [theta, mMin], message: `沿该方向指标最低仅达 ${mMin}，始终高于决策线 ${theta}，[${theta}, ${mMin}) 不可达` };
    } else if (limit === 'max' && mMax < theta - tol) {
      unreachable = { side: 'above', gap: [mMax, theta], message: `沿该方向指标最高仅达 ${mMax}，始终低于决策线 ${theta}，(${mMax}, ${theta}] 不可达` };
    }
  }

  return {
    metricId, empty: false, tHi, breakpoints: T,
    points: pts,
    crossings, intervals: merged, violatedIntervals, okIntervals, plateauIntervals,
    firstCrossing,
    reachable: { min: mMin, max: mMax },
    valueGaps, unreachable,
  };
}

/* ---------------------------------------------------------------- 增量重算 + 全量校验 */

/**
 * 增量重算：只重算受影响的指标；未受影响指标的缓存对象原样保留（引用不变）。
 * changed: { assumptions:[id], metrics:[id], direction:bool, all:bool }
 * 返回每个指标的处理状态：'recomputed' | 'unchanged'
 */
function recompute(model, changed) {
  changed = changed || {};
  const A = new Set(changed.assumptions || []);
  const M = new Set(changed.metrics || []);
  const dirChanged = !!changed.direction || !!changed.all;
  const status = {};
  for (const mid of sortedKeys(model.metrics)) {
    const deps = Object.keys(model.responses[mid] || {});
    const affected = !!changed.all || M.has(mid) || deps.some(a => A.has(a));
    const cache = model._cache[mid] || (model._cache[mid] = {});
    if (affected) {
      cache.decomp = computeDecomposition(model, mid, currentValues(model));
    }
    if (affected || dirChanged) {
      cache.sweep = sweepDirection(model, mid, currentValues(model), model.direction);
    }
    status[mid] = (affected || dirChanged) ? 'recomputed' : 'unchanged';
  }
  return status;
}

function fullRecompute(model) {
  const out = {};
  for (const mid of sortedKeys(model.metrics)) {
    out[mid] = {
      decomp: computeDecomposition(model, mid, currentValues(model)),
      sweep: sweepDirection(model, mid, currentValues(model), model.direction),
    };
  }
  return out;
}

function deepEq(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return nearlyEq(a, b);
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEq(a[k], b[k]));
  }
  return false;
}

/** 用从头全量求解校验当前增量缓存：受影响部分必须与全量完全一致。 */
function verifyConsistency(model) {
  const full = fullRecompute(model);
  const diffs = [];
  for (const mid of sortedKeys(full)) {
    const c = model._cache[mid];
    if (!c || !c.decomp || !c.sweep) { diffs.push(`${mid}：缓存缺失`); continue; }
    if (!deepEq(c.decomp, full[mid].decomp)) diffs.push(`${mid}：贡献分解与全量求解不一致`);
    if (!deepEq(c.sweep, full[mid].sweep)) diffs.push(`${mid}：方向扫描与全量求解不一致`);
  }
  return { ok: diffs.length === 0, diffs };
}

/* ---------------------------------------------------------------- 冲突记录 */

function assumptionEq(a, b) {
  return a.name === b.name && a.unit === b.unit &&
    nearlyEq(a.base, b.base) && nearlyEq(a.min, b.min) && nearlyEq(a.max, b.max);
}
function segmentsEq(s1, s2) {
  return s1.length === s2.length && s1.every((s, i) =>
    nearlyEq(s.x0, s2[i].x0) && nearlyEq(s.y0, s2[i].y0) &&
    nearlyEq(s.x1, s2[i].x1) && nearlyEq(s.y1, s2[i].y1));
}

/** 双方内容均保留在 variants 中；此处生成可读冲突记录。 */
function getConflicts(model) {
  const out = [];
  for (const id of sortedKeys(model.assumptions)) {
    const vars = model.assumptions[id].variants;
    const srcs = sortedKeys(vars);
    if (srcs.length < 2) continue;
    if (srcs.every(s => assumptionEq(vars[srcs[0]], vars[s]))) continue;
    out.push({
      key: 'A:' + id, kind: 'assumption', assumptionId: id,
      message: `假设「${id}」登记矛盾：` + srcs.map(s => {
        const v = vars[s];
        return `来源「${s}」基准=${v.base} 区间=[${v.min}, ${v.max}] 单位=${v.unit || '—'}`;
      }).join('；'),
      entries: srcs.map(s => ({ source: s, content: { ...vars[s] } })),
    });
  }
  for (const mid of sortedKeys(model.responses)) {
    for (const aid of sortedKeys(model.responses[mid])) {
      const vars = model.responses[mid][aid].variants;
      const srcs = sortedKeys(vars);
      if (srcs.length < 2) continue;
      if (srcs.every(s => segmentsEq(vars[srcs[0]].segments, vars[s].segments))) continue;
      const desc = v => v.segments.map(s => `[${s.x0},${s.y0}→${s.x1},${s.y1}]`).join(' ');
      out.push({
        key: 'R:' + mid + '/' + aid, kind: 'response', metricId: mid, assumptionId: aid,
        message: `响应「${aid} → ${mid}」登记矛盾：` + srcs.map(s => `来源「${s}」${vars[s].segments.length} 段：${desc(vars[s])}`).join('；'),
        entries: srcs.map(s => ({ source: s, content: { segments: vars[s].segments.map(x => ({ ...x })) } })),
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 交互操作 */

function setValue(model, id, v) {
  const a = getActiveAssumption(model, id);
  if (!a) return { ok: false, errors: [{ path: 'values.' + id, message: `假设「${id}」不存在` }] };
  if (!isNum(v)) return { ok: false, errors: [{ path: 'values.' + id, message: `取值 ${v} 不是有限数值` }] };
  const clamped = Math.min(Math.max(v, a.min), a.max);
  model.values[id] = clamped;
  return { ok: true, clamped: clamped !== v, value: clamped };
}

function setDirection(model, id, w) {
  if (!model.assumptions[id]) return { ok: false, errors: [{ path: 'direction.' + id, message: `假设「${id}」不存在` }] };
  if (!isNum(w)) return { ok: false, errors: [{ path: 'direction.' + id, message: `方向权重 ${w} 不是有限数值` }] };
  model.direction[id] = w;
  return { ok: true };
}

/* ---------------------------------------------------------------- 导出 */

const API = {
  EPS, nearlyEq,
  createModel,
  registerMetric, registerAssumption, registerResponse, validateSegments,
  getActiveAssumption, getActiveResponse, setActiveSource,
  evaluateSegments, currentValues, computeDecomposition,
  sweepDirection, recompute, fullRecompute, verifyConsistency,
  getConflicts, setValue, setDirection,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
global.FinReview = API;
})(typeof window !== 'undefined' ? window : globalThis);
