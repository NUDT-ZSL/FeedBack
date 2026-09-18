/*
 * engine.js — 队列留存比较核心引擎（纯逻辑，无 DOM 依赖）
 * 同时支持浏览器（window.Engine）与 Node（module.exports），便于离线测试。
 *
 * 设计要点：
 * - 所有比较都是状态的纯函数，结果确定性一致（需求 3、6）。
 * - 重复上报幂等忽略，且不改变状态版本号（需求 1、6）。
 * - 非法数据（活跃>规模、时刻倒退）拒绝并记录位置（需求 1）。
 * - 来源冲突双方保留，冲突期不静默择一、不纳入比较（需求 5）。
 * - 两队列只在共同观察窗口内比较，窗口外观测排除并说明原因（需求 2）。
 * - 比较结果按 (队列A修订号, 队列B修订号) 缓存：未受影响的比较返回同一对象，
 *   受影响的比较整体重算 —— 由于重算是纯函数，必然与从头全量重算一致（需求 6）。
 */
(function (root, factory) {
  const Engine = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---------- 状态 ----------

  function createState(options) {
    options = options || {};
    return {
      cohorts: {},              // id -> cohort
      cohortOrder: [],          // 保持插入顺序，保证渲染/结果确定
      conflicts: [],            // 冲突记录（需求 5）
      rejections: [],           // 拒绝日志（需求 1）
      duplicates: 0,            // 幂等忽略计数
      clock: 0,                 // 内部逻辑时钟（上报时刻缺省时自动递增）
      sourceClock: {},          // 每个来源已见的最大上报时刻（检测时刻倒退）
      seq: 0,
      minCohortsPerStratum: options.minCohortsPerStratum || 2, // 分层可比下限（需求 4）
      version: 0,               // 全局版本：任何被接受的变更 +1
      compareCache: {}          // 比较缓存：key -> {aRev, bRev, result}
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function recordRejection(state, kind, reason, report) {
    state.rejections.push({ kind: kind, reason: reason, report: clone(report), at: ++state.seq });
    return { status: 'rejected', reason: reason };
  }

  // ---------- 队列维护（需求 1） ----------

  function addCohort(state, spec) {
    const id = String(spec.id || '').trim() || ('C' + (state.cohortOrder.length + 1));
    const name = String(spec.name || '').trim();
    const stratum = String(spec.stratum || '').trim();
    const start = String(spec.start == null ? '' : spec.start).trim();
    const size = Number(spec.size);

    if (!name) return recordRejection(state, 'cohort', '队列名称不能为空', spec);
    if (!stratum) return recordRejection(state, 'cohort', '分层属性（渠道）不能为空', spec);
    if (!Number.isInteger(size) || size <= 0)
      return recordRejection(state, 'cohort', '规模必须为正整数，收到: ' + spec.size, spec);

    if (state.cohorts[id]) {
      const c = state.cohorts[id];
      if (c.name === name && c.stratum === stratum && c.size === size && c.start === start) {
        state.duplicates++;
        return { status: 'duplicate', cohortId: id, reason: '相同队列已存在，幂等忽略' };
      }
      return recordRejection(state, 'cohort',
        '队列ID「' + id + '」已存在且属性不一致（已有: ' + c.name + '/' + c.stratum + '/规模' + c.size + '）', spec);
    }

    state.cohorts[id] = { id: id, name: name, stratum: stratum, start: start, size: size, rev: 0, obs: {} };
    state.cohortOrder.push(id);
    state.version++;
    return { status: 'accepted', cohortId: id };
  }

  // 修正规模（需求 6）：不得使已有观测失效，否则拒绝并指出位置
  function correctSize(state, cohortId, newSize) {
    const c = state.cohorts[cohortId];
    if (!c) return recordRejection(state, 'size', '队列不存在: ' + cohortId, { cohortId: cohortId, newSize: newSize });
    const size = Number(newSize);
    if (!Number.isInteger(size) || size <= 0)
      return recordRejection(state, 'size', '新规模必须为正整数，收到: ' + newSize, { cohortId: cohortId });
    if (size === c.size) { state.duplicates++; return { status: 'duplicate', reason: '规模未变化，幂等忽略' }; }
    const viol = [];
    Object.keys(c.obs).forEach(function (p) {
      c.obs[p].forEach(function (e) {
        if (e.active > size) viol.push('第' + p + '期活跃 ' + e.active + '（来源「' + e.source + '」）');
      });
    });
    if (viol.length)
      return recordRejection(state, 'size',
        '拒绝将队列 ' + c.name + ' 规模修正为 ' + size + '：小于已上报观测 —— ' + viol.join('；'),
        { cohortId: cohortId, newSize: newSize });
    c.size = size;
    c.rev++; state.version++;
    return { status: 'accepted' };
  }

  // ---------- 观测上报（需求 1、5） ----------

  function reportObservation(state, rep) {
    const cohort = state.cohorts[rep.cohortId];
    if (!cohort) return recordRejection(state, 'observation', '队列不存在: ' + rep.cohortId, rep);

    const period = Number(rep.period);
    if (!Number.isInteger(period) || period < 0)
      return recordRejection(state, 'observation',
        '观察期非法: ' + rep.period + '（队列 ' + cohort.name + ' 的观察期必须为 >= 0 的整数；负值意味着时刻倒退到队列起始之前）', rep);

    const active = Number(rep.active);
    if (!Number.isInteger(active) || active < 0)
      return recordRejection(state, 'observation',
        '活跃数非法: ' + rep.active + '（位置：队列 ' + cohort.name + ' 第 ' + period + ' 期）', rep);
    if (active > cohort.size)
      return recordRejection(state, 'observation',
        '活跃数超过规模: 队列 ' + cohort.name + '(' + cohort.id + ') 第 ' + period + ' 期上报活跃 ' + active + ' > 规模 ' + cohort.size, rep);

    const source = String(rep.source == null || rep.source === '' ? '未标注来源' : rep.source);

    // 时刻倒退检测：同一来源的上报时刻必须单调不减
    let reportedAt = rep.reportedAt;
    if (reportedAt === undefined || reportedAt === null || reportedAt === '') {
      reportedAt = ++state.clock;
    } else {
      reportedAt = Number(reportedAt);
      if (!Number.isFinite(reportedAt))
        return recordRejection(state, 'observation', '上报时刻非法: ' + rep.reportedAt, rep);
      const last = state.sourceClock[source];
      if (last !== undefined && reportedAt < last)
        return recordRejection(state, 'observation',
          '时刻倒退: 来源「' + source + '」本次上报时刻 ' + reportedAt + ' 早于其已见时刻 ' + last +
          '（位置：队列 ' + cohort.name + ' 第 ' + period + ' 期）', rep);
      if (reportedAt > state.clock) state.clock = reportedAt;
    }
    state.sourceClock[source] = Math.max(state.sourceClock[source] || reportedAt, reportedAt);

    const entries = cohort.obs[period] || (cohort.obs[period] = []);
    // 幂等：同队列、同期、同来源、同数值 -> 忽略，且不改变任何版本号
    const same = entries.find(function (e) { return e.source === source && e.active === active; });
    if (same) {
      state.duplicates++;
      return { status: 'duplicate', reason: '重复上报已幂等忽略: ' + cohort.name + ' 第' + period + '期 来源「' + source + '」=' + active };
    }

    entries.push({ source: source, active: active, reportedAt: reportedAt, seq: ++state.seq });

    const distinct = [];
    entries.forEach(function (e) { if (distinct.indexOf(e.active) < 0) distinct.push(e.active); });

    if (distinct.length > 1) {
      // 需求 5：矛盾值双方保留，生成可读冲突记录；该期不纳入比较，绝不静默择一
      let conf = null;
      for (let i = 0; i < state.conflicts.length; i++) {
        if (state.conflicts[i].cohortId === cohort.id && state.conflicts[i].period === period) { conf = state.conflicts[i]; break; }
      }
      if (!conf) {
        conf = { cohortId: cohort.id, cohortName: cohort.name, period: period, values: [] };
        state.conflicts.push(conf);
      }
      conf.values = distinct.sort(function (a, b) { return a - b; }).map(function (v) {
        return { active: v, sources: entries.filter(function (e) { return e.active === v; }).map(function (e) { return e.source; }) };
      });
      cohort.rev++; state.version++;
      return { status: 'conflict', reason: '冲突: 队列 ' + cohort.name + ' 第' + period + '期 存在互相矛盾的数值 ' +
        distinct.join(' / ') + '，双方均已保留；该期在冲突解决前不纳入任何比较' };
    }

    cohort.rev++; state.version++;
    return { status: 'accepted' };
  }

  // 某队列某期的“可用值”：无观测 -> undefined；多值冲突 -> null；唯一值 -> 数值
  function resolvedValue(cohort, period) {
    const entries = cohort.obs[period];
    if (!entries || entries.length === 0) return undefined;
    let v = entries[0].active;
    for (let i = 1; i < entries.length; i++) if (entries[i].active !== v) return null;
    return v;
  }

  // ---------- 比较（需求 2、3） ----------

  function signOf(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // 把队列折算成通用序列 {period: {active, size}}，并收集冲突期
  function seriesFromCohort(cohort) {
    const series = {}, conflicted = [];
    Object.keys(cohort.obs).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
      const v = resolvedValue(cohort, p);
      if (v === null) conflicted.push(p);
      else if (v !== undefined) series[p] = { active: v, size: cohort.size };
    });
    return { series: series, conflicted: conflicted };
  }

  // 分层聚合序列：逐期把层内所有有可用值的队列加总（活跃与规模分别相加）
  function seriesFromStratum(state, stratum) {
    const series = {}, conflicted = [];
    state.cohortOrder.forEach(function (id) {
      const c = state.cohorts[id];
      if (c.stratum !== stratum) return;
      const s = seriesFromCohort(c);
      s.conflicted.forEach(function (p) {
        conflicted.push({ cohortId: id, cohortName: c.name, period: p });
      });
      Object.keys(s.series).forEach(function (k) {
        const p = Number(k);
        if (!series[p]) series[p] = { active: 0, size: 0 };
        series[p].active += s.series[p].active;
        series[p].size += s.series[p].size;
      });
    });
    return { series: series, conflicted: conflicted };
  }

  function excludeReason(p, otherMin, otherMax, otherLabel, otherConflicted) {
    if (otherConflicted.indexOf(p) >= 0)
      return '对方（' + otherLabel + '）第 ' + p + ' 期存在来源冲突，未纳入比较';
    if (otherMin === null) return '对方（' + otherLabel + '）没有任何可用观测';
    if (p < otherMin) return '早于对方（' + otherLabel + '）的首个观测期（第 ' + otherMin + ' 期）';
    if (p > otherMax) return '超出对方（' + otherLabel + '）的观察范围（对方最后观测期为第 ' + otherMax + ' 期）——该期仅因一方观察更久而存在，不代表表现差异';
    return '对方（' + otherLabel + '）在第 ' + p + ' 期无观测（数据缺口），不以零或缺失填补';
  }

  // 通用序列比较：只在共同窗口内逐期对比（需求 2、3）
  function compareSeries(seriesA, seriesB, labelA, labelB, conflictedA, conflictedB) {
    const pa = Object.keys(seriesA).map(Number);
    const pb = Object.keys(seriesB).map(Number);
    const setA = new Set(pa), setB = new Set(pb);
    const windowPeriods = pa.filter(function (p) { return setB.has(p); }).sort(function (a, b) { return a - b; });

    const minA = pa.length ? Math.min.apply(null, pa) : null, maxA = pa.length ? Math.max.apply(null, pa) : null;
    const minB = pb.length ? Math.min.apply(null, pb) : null, maxB = pb.length ? Math.max.apply(null, pb) : null;

    const excludedA = pa.filter(function (p) { return !setB.has(p); })
      .map(function (p) { return { period: p, reason: excludeReason(p, minB, maxB, labelB, conflictedB) }; });
    const excludedB = pb.filter(function (p) { return !setA.has(p); })
      .map(function (p) { return { period: p, reason: excludeReason(p, minA, maxA, labelA, conflictedA) }; });

    const rows = windowPeriods.map(function (p) {
      const a = seriesA[p], b = seriesB[p];
      // 用交叉相乘判定方向，避免浮点误差影响“反转”判定的确定性
      const sign = signOf(a.active * b.size, b.active * a.size);
      const rateA = a.active / a.size, rateB = b.active / b.size;
      return { period: p, activeA: a.active, sizeA: a.size, rateA: rateA,
               activeB: b.active, sizeB: b.size, rateB: rateB,
               diff: rateA - rateB, sign: sign };
    });

    // 差异方向反转检测（需求 3）：列出发生反转的具体观察期
    const reversals = [];
    let prevRow = null;
    rows.forEach(function (row) {
      if (prevRow && row.sign !== 0 && prevRow.sign !== 0 && row.sign !== prevRow.sign) {
        reversals.push({ period: row.period, prevPeriod: prevRow.period, from: prevRow.sign, to: row.sign });
      }
      if (row.sign !== 0) prevRow = row;
    });

    const meanDiff = rows.length ? rows.reduce(function (s, r) { return s + r.diff; }, 0) / rows.length : null;

    return {
      labelA: labelA, labelB: labelB,
      window: windowPeriods,
      rows: rows,
      excludedA: excludedA, excludedB: excludedB,
      conflictedA: conflictedA, conflictedB: conflictedB,
      reversals: reversals,
      meanDiff: meanDiff
    };
  }

  // 两队列比较：带增量缓存（需求 6）
  function compareCohorts(state, idA, idB) {
    const A = state.cohorts[idA], B = state.cohorts[idB];
    if (!A || !B) return null;
    const key = idA + '→' + idB;
    const hit = state.compareCache[key];
    if (hit && hit.aRev === A.rev && hit.bRev === B.rev) {
      hit.result.fromCache = true; // 未受影响：返回同一对象，结果保持不变
      return hit.result;
    }
    const sa = seriesFromCohort(A), sb = seriesFromCohort(B);
    const result = compareSeries(sa.series, sb.series, A.name, B.name, sa.conflicted, sb.conflicted);
    result.aId = idA; result.bId = idB;
    result.aRevs = A.rev; result.bRevs = B.rev;
    result.fromCache = false;
    state.compareCache[key] = { aRev: A.rev, bRev: B.rev, result: result };
    return result;
  }

  // ---------- 分层可比性（需求 4） ----------

  function stratumSummary(state) {
    const map = {};
    state.cohortOrder.forEach(function (id) {
      const c = state.cohorts[id];
      if (!map[c.stratum]) map[c.stratum] = { stratum: c.stratum, cohortIds: [] };
      map[c.stratum].cohortIds.push(id);
    });
    return Object.keys(map).sort().map(function (k) {
      const s = map[k];
      const n = s.cohortIds.length, t = state.minCohortsPerStratum;
      return {
        stratum: s.stratum, cohortIds: s.cohortIds, count: n, threshold: t,
        comparable: n >= t,
        missing: Math.max(0, t - n) // 还差多少个队列才可比
      };
    });
  }

  // 分层比较：任一层不可比则拒绝给出优劣结论（需求 4）
  function compareStrata(state, stratumA, stratumB) {
    const summary = stratumSummary(state);
    const a = summary.find(function (s) { return s.stratum === stratumA; });
    const b = summary.find(function (s) { return s.stratum === stratumB; });
    if (!a || !b) return { comparable: false, reason: '分层不存在' };
    if (!a.comparable || !b.comparable) {
      const parts = [];
      if (!a.comparable) parts.push('分层「' + stratumA + '」可用队列数 ' + a.count + ' 低于下限 ' + a.threshold + '，还差 ' + a.missing + ' 个');
      if (!b.comparable) parts.push('分层「' + stratumB + '」可用队列数 ' + b.count + ' 低于下限 ' + b.threshold + '，还差 ' + b.missing + ' 个');
      return { comparable: false, reason: parts.join('；') + '。该分层标记为不可比，不与分层充足的一方并列得出优劣结论。' };
    }
    const sa = seriesFromStratum(state, stratumA), sb = seriesFromStratum(state, stratumB);
    const result = compareSeries(sa.series, sb.series, stratumA, stratumB,
      sa.conflicted.map(function (c) { return c.period; }),
      sb.conflicted.map(function (c) { return c.period; }));
    result.comparable = true;
    result.strataConflictDetail = sa.conflicted.concat(sb.conflicted);
    return result;
  }

  // ---------- 留存矩阵（需求 7） ----------

  function retentionMatrix(state) {
    let maxPeriod = -1;
    state.cohortOrder.forEach(function (id) {
      Object.keys(state.cohorts[id].obs).forEach(function (p) {
        maxPeriod = Math.max(maxPeriod, Number(p));
      });
    });
    const rows = state.cohortOrder.map(function (id) {
      const c = state.cohorts[id];
      const cells = [];
      for (let p = 0; p <= maxPeriod; p++) {
        const v = resolvedValue(c, p);
        if (v === undefined) cells.push({ status: 'empty' });
        else if (v === null) cells.push({ status: 'conflict', entries: c.obs[p].map(function (e) { return { source: e.source, active: e.active }; }) });
        else cells.push({ status: 'ok', active: v, rate: v / c.size });
      }
      return { cohort: c, cells: cells };
    });
    return { maxPeriod: maxPeriod, rows: rows };
  }

  // ---------- 持久化 ----------

  function serialize(state) {
    const copy = clone(state);
    copy.compareCache = {}; // 缓存可重建，不持久化
    return copy;
  }

  function deserialize(obj) {
    const state = Object.assign(createState(), obj);
    state.compareCache = {};
    return state;
  }

  return {
    createState: createState,
    addCohort: addCohort,
    correctSize: correctSize,
    reportObservation: reportObservation,
    resolvedValue: resolvedValue,
    compareCohorts: compareCohorts,
    compareStrata: compareStrata,
    stratumSummary: stratumSummary,
    retentionMatrix: retentionMatrix,
    serialize: serialize,
    deserialize: deserialize
  };
});
