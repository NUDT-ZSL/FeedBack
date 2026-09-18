'use strict';
/* ============================================================
 * 财务方案假设敏感性评审工具 —— 计算引擎
 * 纯函数、无 DOM 依赖；浏览器与 node 均可加载。
 * ============================================================ */

const EPS = 1e-9;

function isNum(x) { return typeof x === 'number' && isFinite(x); }

/* ---------------- 假设校验（需求 1） ---------------- */
function validateAssumption(a) {
  const errs = [];
  if (!a.id || !String(a.id).trim()) errs.push({ field: 'id', msg: '标识为空' });
  if (!isNum(a.min)) errs.push({ field: 'min', msg: `下限非法：${a.min}` });
  if (!isNum(a.max)) errs.push({ field: 'max', msg: `上限非法：${a.max}` });
  if (isNum(a.min) && isNum(a.max) && a.min >= a.max)
    errs.push({ field: 'min', msg: `区间非法：下限 ${a.min} ≥ 上限 ${a.max}` });
  if (!isNum(a.base)) errs.push({ field: 'base', msg: `基准值非法：${a.base}` });
  else if (isNum(a.min) && isNum(a.max) && a.min < a.max && (a.base < a.min || a.base > a.max))
    errs.push({ field: 'base', msg: `基准值 ${a.base} 越出区间 [${a.min}, ${a.max}]` });
  return errs;
}

/* ---------------- 响应段校验（需求 2） ----------------
 * 响应以断点列 [{x,y}...] 表示，相邻断点构成一段。
 * 断点必须严格递增（不重叠），且恰好覆盖假设区间 [min,max]（首尾相接、无缺失）。 */
function validateResponsePoints(points, a) {
  const errs = [];
  if (!Array.isArray(points) || points.length < 2) {
    errs.push({ field: 'points', msg: '断点缺失：至少需要 2 个断点才能构成一段响应' });
    return errs;
  }
  points.forEach((p, i) => {
    if (!p || !isNum(p.x) || !isNum(p.y))
      errs.push({ field: `points[${i}]`, msg: `断点 #${i + 1} 含非法数值` });
  });
  if (errs.length) return errs;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x <= points[i - 1].x)
      errs.push({ field: `points[${i}]`, msg: `断点 x=${points[i].x} 与前断点 x=${points[i - 1].x} 重叠或倒序（区间必须首尾相接且不重叠）` });
  }
  const first = points[0], last = points[points.length - 1];
  if (first.x > a.min) errs.push({ field: 'points[0]', msg: `断点缺失：区间 [${a.min}, ${first.x}] 未覆盖` });
  if (first.x < a.min) errs.push({ field: 'points[0]', msg: `断点越界：x=${first.x} 小于假设下限 ${a.min}` });
  if (last.x < a.max) errs.push({ field: `points[${points.length - 1}]`, msg: `断点缺失：区间 [${last.x}, ${a.max}] 未覆盖` });
  if (last.x > a.max) errs.push({ field: `points[${points.length - 1}]`, msg: `断点越界：x=${last.x} 大于假设上限 ${a.max}` });
  return errs;
}

/* 分段线性插值 */
function evalPoints(points, x) {
  const n = points.length;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[n - 1].x) return points[n - 1].y;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (points[m].x <= x) lo = m; else hi = m; }
  const p0 = points[lo], p1 = points[hi];
  return p0.y + (x - p0.x) / (p1.x - p0.x) * (p1.y - p0.y);
}

/* ---------------- 状态与登记（含冲突处理，需求 6） ---------------- */
function snapAssumption(a) {
  return { name: a.name, unit: a.unit, base: a.base, min: a.min, max: a.max };
}
function sameAssumptionContent(a, b) {
  return a.base === b.base && a.min === b.min && a.max === b.max && a.unit === b.unit && a.name === b.name;
}
function samePoints(p, q) {
  return p.length === q.length && p.every((pt, i) => pt.x === q[i].x && pt.y === q[i].y);
}

function addAssumption(state, a) {
  const errs = validateAssumption(a);
  if (errs.length) return { ok: false, errs };
  const conflict = state.conflicts.find(c => c.kind === 'assumption' && c.aid === a.id);
  if (conflict) {
    const dup = conflict.options.find(o => sameAssumptionContent(o.data, a));
    if (dup) return { ok: false, errs: [{ field: 'id', msg: `标识重复：'${a.id}' 的冲突记录中已存在相同内容（来源「${dup.source}」）` }] };
    conflict.options.push({ source: a.source || '未标注', data: snapAssumption(a) });
    return { ok: true, conflict: conflict.cid };
  }
  const ex = state.assumptions.find(x => x.id === a.id);
  if (ex) {
    if (sameAssumptionContent(ex, a))
      return { ok: false, errs: [{ field: 'id', msg: `标识重复：'${a.id}' 已由来源「${ex.source || '未标注'}」登记且内容一致` }] };
    /* 同标识、不同内容、不同来源 → 保留双方并生成冲突记录，该假设退出计算直至解决 */
    state.assumptions = state.assumptions.filter(x => x.id !== a.id);
    const c = {
      cid: state._cid++, kind: 'assumption', aid: a.id,
      options: [
        { source: ex.source || '未标注', data: snapAssumption(ex) },
        { source: a.source || '未标注', data: snapAssumption(a) }
      ]
    };
    state.conflicts.push(c);
    return { ok: true, conflict: c.cid };
  }
  state.assumptions.push({
    id: a.id, name: a.name || a.id, unit: a.unit || '',
    base: a.base, min: a.min, max: a.max, source: a.source || '未标注', _ver: 1
  });
  state.values[a.id] = a.base;
  return { ok: true };
}

function addResponse(state, aid, mid, points, source) {
  const a = state.assumptions.find(x => x.id === aid);
  if (!a) return { ok: false, errs: [{ field: 'aid', msg: `假设 '${aid}' 不存在或处于冲突未决状态` }] };
  const errs = validateResponsePoints(points, a);
  if (errs.length) return { ok: false, errs };
  const conflict = state.conflicts.find(c => c.kind === 'response' && c.aid === aid && c.mid === mid);
  if (conflict) {
    const dup = conflict.options.find(o => samePoints(o.data.points, points));
    if (dup) return { ok: false, errs: [{ field: 'points', msg: `重复登记：冲突记录中已存在相同响应段（来源「${dup.source}」）` }] };
    conflict.options.push({ source: source || '未标注', data: { points: points.map(p => ({ x: p.x, y: p.y })) } });
    return { ok: true, conflict: conflict.cid };
  }
  const ex = state.responses.find(r => r.aid === aid && r.mid === mid);
  if (ex) {
    if (samePoints(ex.points, points))
      return { ok: false, errs: [{ field: 'points', msg: `重复登记：(${aid}, ${mid}) 的响应已由来源「${ex.source}」登记且内容一致` }] };
    state.responses = state.responses.filter(r => !(r.aid === aid && r.mid === mid));
    const c = {
      cid: state._cid++, kind: 'response', aid, mid,
      options: [
        { source: ex.source, data: { points: ex.points } },
        { source: source || '未标注', data: { points: points.map(p => ({ x: p.x, y: p.y })) } }
      ]
    };
    state.conflicts.push(c);
    return { ok: true, conflict: c.cid };
  }
  state.responses.push({ aid, mid, points: points.map(p => ({ x: p.x, y: p.y })), source: source || '未标注', _ver: 1 });
  return { ok: true };
}

/* 直接编辑已有响应段（编辑器用）：校验通过后替换并升版本号 */
function setResponsePoints(state, aid, mid, points, source) {
  const a = state.assumptions.find(x => x.id === aid);
  if (!a) return { ok: false, errs: [{ field: 'aid', msg: `假设 '${aid}' 不存在或处于冲突未决状态` }] };
  const errs = validateResponsePoints(points, a);
  if (errs.length) return { ok: false, errs };
  const ex = state.responses.find(r => r.aid === aid && r.mid === mid);
  if (ex) { ex.points = points.map(p => ({ x: p.x, y: p.y })); ex._ver++; if (source) ex.source = source; }
  else state.responses.push({ aid, mid, points: points.map(p => ({ x: p.x, y: p.y })), source: source || '未标注', _ver: 1 });
  return { ok: true };
}

function resolveConflict(state, cid, optionIndex) {
  const i = state.conflicts.findIndex(c => c.cid === cid);
  if (i < 0) return false;
  const c = state.conflicts[i];
  const opt = c.options[optionIndex];
  if (!opt) return false;
  if (c.kind === 'assumption') {
    const d = opt.data;
    state.assumptions.push({ id: c.aid, name: d.name, unit: d.unit, base: d.base, min: d.min, max: d.max, source: opt.source, _ver: 1 });
    state.values[c.aid] = d.base;
  } else {
    state.responses.push({ aid: c.aid, mid: c.mid, points: opt.data.points.map(p => ({ x: p.x, y: p.y })), source: opt.source, _ver: 1 });
  }
  state.conflicts.splice(i, 1);
  return true;
}

/* ---------------- 查询 ---------------- */
/* 参与计算的假设：无未决冲突；按标识排序 → 结果与登记顺序无关（需求 5） */
function activeAssumptions(state) {
  return state.assumptions
    .filter(a => !state.conflicts.some(c => c.kind === 'assumption' && c.aid === a.id))
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}
function responseFor(state, aid, mid) {
  if (state.conflicts.some(c =>
    (c.kind === 'response' && c.aid === aid && c.mid === mid) ||
    (c.kind === 'assumption' && c.aid === aid))) return null;
  return state.responses.find(r => r.aid === aid && r.mid === mid) || null;
}

/* ---------------- 指标求值与贡献分解（需求 3） ---------------- */
function decompose(state, mid, values) {
  const m = state.metrics.find(x => x.id === mid);
  const parts = [];
  for (const a of activeAssumptions(state)) {
    const resp = responseFor(state, a.id, mid);
    if (!resp) continue;
    const v = values && values[a.id] !== undefined ? values[a.id] : a.base;
    const c = evalPoints(resp.points, v) - evalPoints(resp.points, a.base);
    parts.push({ aid: a.id, name: a.name, c });
  }
  const sum = parts.reduce((s, p) => s + p.c, 0);
  return { base: m.base, parts, sum, total: m.base + sum }; /* 贡献之和即总变化，构造上恒等 */
}

/* ---------------- 方向扰动扫描（需求 4、5） ---------------- */
/* 单假设在方向权重 d 下的“剖面”：g(t) = f(base + t·d) - f(base)，分段线性 */
function buildProfile(state, mid, a, d) {
  const resp = responseFor(state, a.id, mid);
  if (!resp) return { ts: [0, 1], gs: [0, 0] };
  const fBase = evalPoints(resp.points, a.base);
  const pts = resp.points
    .map(p => ({ t: (p.x - a.base) / d, g: p.y - fBase }))
    .sort((p, q) => p.t - q.t);
  return { ts: pts.map(p => p.t), gs: pts.map(p => p.g) };
}
function profileEval(prof, t) {
  const { ts, gs } = prof, n = ts.length;
  if (t <= ts[0]) return gs[0];
  if (t >= ts[n - 1]) return gs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  return gs[lo] + (t - ts[lo]) / (ts[hi] - ts[lo]) * (gs[hi] - gs[lo]);
}

function valuesAt(state, direction, t) {
  const vals = {};
  for (const a of activeAssumptions(state)) {
    const d = direction[a.id] || 0;
    let v = d ? a.base + t * d : a.base;
    v = Math.min(a.max, Math.max(a.min, v));
    vals[a.id] = +v.toFixed(6);
  }
  return vals;
}

/*
 * 沿方向 direction 扫描 t ∈ [0, tMax]（tMax = 首个假设触界处）。
 * 返回：首次越线位置、全部穿越点、贴线平台、不可达区间。
 * cache 可选：{map, hits, misses, rebuilt}，按 (指标,假设) 缓存剖面，
 * 以版本号失效 —— 未受影响的假设不重算（需求 7）。
 */
function sweep(state, mid, direction, cache) {
  const m = state.metrics.find(x => x.id === mid);
  const tau = m.threshold;
  const ass = activeAssumptions(state);
  const moving = [];
  let tMax = Infinity;
  for (const a of ass) {
    const d = direction[a.id] || 0;
    if (!d) continue;
    const tb = d > 0 ? (a.max - a.base) / d : (a.min - a.base) / d;
    moving.push({ a, d, tb });
    if (tb < tMax) tMax = tb;
  }
  if (!moving.length) return { ok: false, reason: '方向为零：请至少为一个假设设置非零权重' };

  const profs = moving.map(mv => {
    const key = mid + '|' + mv.a.id;
    if (cache) {
      const c = cache.map.get(key);
      const resp = responseFor(state, mv.a.id, mid);
      const rVer = resp ? resp._ver : -1;
      if (c && c.aVer === mv.a._ver && c.rVer === rVer && c.d === mv.d) { cache.hits++; return c.prof; }
      cache.misses++; cache.rebuilt.push(key);
      const prof = buildProfile(state, mid, mv.a, mv.d);
      cache.map.set(key, { aVer: mv.a._ver, rVer, d: mv.d, prof });
      return prof;
    }
    return buildProfile(state, mid, mv.a, mv.d);
  });

  const M = t => { let v = m.base; for (let i = 0; i < profs.length; i++) v += profileEval(profs[i], t); return v; };

  /* t 轴节点：0、tMax、所有剖面断点的像 */
  const knotSet = [0, tMax];
  for (const p of profs) for (const t of p.ts) if (t > EPS && t < tMax - EPS) knotSet.push(t);
  knotSet.sort((a, b) => a - b);
  const knots = [];
  for (const t of knotSet) if (!knots.length || t - knots[knots.length - 1] > 1e-7) knots.push(t);

  const tol = 1e-7 * Math.max(1, Math.abs(tau));
  const crossings = [];
  const addCross = t => { if (!crossings.length || Math.abs(t - crossings[crossings.length - 1]) > 1e-7) crossings.push(t); };
  const onSegs = []; /* 贴线（平台）基本段 */

  for (let i = 0; i < knots.length - 1; i++) {
    const t0 = knots[i], t1 = knots[i + 1];
    const m0 = M(t0), m1 = M(t1), d0 = m0 - tau, d1 = m1 - tau;
    const flat = Math.abs(m1 - m0) <= tol;
    if (flat) {
      if (Math.abs(d0) <= tol) onSegs.push({ t0, t1 });
      continue;
    }
    if (Math.abs(d0) <= tol) addCross(t0);
    if (d0 * d1 < 0) addCross(t0 + (tau - m0) * (t1 - t0) / (m1 - m0));
  }
  if (Math.abs(M(tMax) - tau) <= tol) addCross(tMax);

  /* 贴线平台：相邻贴线段合并 */
  const plateaus = [];
  for (const s of onSegs) {
    const last = plateaus[plateaus.length - 1];
    if (last && Math.abs(last.t1 - s.t0) <= 1e-7) last.t1 = s.t1;
    else plateaus.push({ t0: s.t0, t1: s.t1 });
  }
  /* 不可达区间：以穿越点与平台端点为事件，把 [0,tMax] 完整划分；
   * 每个事件间区间取中点判定指标停留在阈值哪一侧（内部不可触及决策线） */
  const eventSet = [0, tMax];
  for (const t of crossings) eventSet.push(t);
  for (const p of plateaus) { eventSet.push(p.t0); eventSet.push(p.t1); }
  eventSet.sort((a, b) => a - b);
  const events = [];
  for (const t of eventSet) if (!events.length || t - events[events.length - 1] > 1e-7) events.push(t);
  const unreachable = [];
  for (let i = 0; i < events.length - 1; i++) {
    const t0 = events[i], t1 = events[i + 1];
    if (t1 - t0 <= 1e-7) continue;
    if (plateaus.some(p => Math.abs(p.t0 - t0) <= 1e-7 && Math.abs(p.t1 - t1) <= 1e-7)) continue;
    const mid = M((t0 + t1) / 2) - tau;
    if (Math.abs(mid) <= tol) continue;
    unreachable.push({ t0, t1, side: mid > 0 ? 'above' : 'below' });
  }

  const h = 1e-6 * Math.max(1, tMax);
  const crossDetails = crossings.map(t => {
    const tA = Math.max(0, t - h), tB = Math.min(tMax, t + h);
    const dir = M(tB) - M(tA);
    return { t, dir: dir > tol ? 'up' : (dir < -tol ? 'down' : 'touch'), values: valuesAt(state, direction, t) };
  });

  let first = null;
  if (crossDetails.length) first = crossDetails[0].t;
  if (plateaus.length && (first === null || plateaus[0].t0 < first)) first = plateaus[0].t0;

  return {
    ok: true, tMax, tau, base: m.base,
    crossings: crossDetails, plateaus, unreachable, first,
    firstValues: first === null ? null : valuesAt(state, direction, first)
  };
}

/* ---------------- 示例数据 ---------------- */
function makeSeedState() {
  const state = { assumptions: [], metrics: [], responses: [], conflicts: [], values: {}, direction: {}, _cid: 1 };

  addAssumption(state, { id: 'rev_growth', name: '收入增长率', unit: '%', base: 8, min: -10, max: 25, source: '财务组' });
  addAssumption(state, { id: 'gross_margin', name: '毛利率', unit: '%', base: 32, min: 20, max: 45, source: '财务组' });
  addAssumption(state, { id: 'opex_ratio', name: '费用率', unit: '%', base: 18, min: 10, max: 30, source: '财务组' });
  addAssumption(state, { id: 'tax_rate', name: '有效税率', unit: '%', base: 20, min: 5, max: 35, source: '税务组' });
  /* 同一假设由另一来源给出不同基准 → 预置一条冲突（需求 6） */
  addAssumption(state, { id: 'tax_rate', name: '有效税率', unit: '%', base: 23, min: 5, max: 35, source: '审计调整' });

  state.metrics.push(
    { id: 'net_profit', name: '净利润', unit: '百万元', base: 100, threshold: 60, violate: 'below' },
    { id: 'roic', name: 'ROIC', unit: '%', base: 12, threshold: 8, violate: 'below' }
  );

  addResponse(state, 'rev_growth', 'net_profit', [
    { x: -10, y: -70 }, { x: 2, y: -30 }, { x: 8, y: 0 }, { x: 14, y: 20 }, { x: 18, y: 20 }, { x: 25, y: 45 }
  ], '财务组'); /* 14..18 为平台 */
  addResponse(state, 'gross_margin', 'net_profit', [
    { x: 20, y: -60 }, { x: 28, y: -20 }, { x: 32, y: 0 }, { x: 38, y: 25 }, { x: 45, y: 45 }
  ], '财务组');
  addResponse(state, 'opex_ratio', 'net_profit', [
    { x: 10, y: 40 }, { x: 15, y: 20 }, { x: 18, y: 5 }, { x: 24, y: -25 }, { x: 30, y: -50 }
  ], '财务组');
  addResponse(state, 'tax_rate', 'net_profit', [
    { x: 5, y: 25 }, { x: 15, y: 10 }, { x: 20, y: 0 }, { x: 28, y: -15 }, { x: 35, y: -30 }
  ], '税务组');
  addResponse(state, 'rev_growth', 'roic', [
    { x: -10, y: -5 }, { x: 5, y: 2 }, { x: 12, y: 1 }, { x: 25, y: 4 }
  ], '财务组'); /* 非单调 */
  addResponse(state, 'gross_margin', 'roic', [
    { x: 20, y: -6 }, { x: 32, y: 0 }, { x: 45, y: 7 }
  ], '财务组');
  addResponse(state, 'tax_rate', 'roic', [
    { x: 5, y: 2 }, { x: 20, y: 0 }, { x: 35, y: -3 }
  ], '税务组');

  state.direction = { rev_growth: -2, gross_margin: -0.5, opex_ratio: 0.5, tax_rate: 0 };
  return state;
}

const Engine = {
  EPS, isNum,
  validateAssumption, validateResponsePoints, evalPoints,
  addAssumption, addResponse, setResponsePoints, resolveConflict,
  activeAssumptions, responseFor, decompose,
  buildProfile, profileEval, valuesAt, sweep,
  makeSeedState
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
