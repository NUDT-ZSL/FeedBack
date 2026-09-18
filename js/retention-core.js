/**
 * retention-core.js — 队列留存比较的纯领域内核
 *
 * 无 DOM、无外部依赖、无网络。浏览器与 Node 均可加载（UMD）。
 * 所有“计算”均为纯函数，输入相同则输出完全一致；修改通过不可变更新进行，
 * 未受影响的比较凭签名缓存保持不变（见 compareCohorts）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RetentionCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 基础工具 ----------

  function isInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /** 稳定的深比较（用于“增量重算 === 全量重算”的校验） */
  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------- 状态 ----------

  function createState(opts) {
    opts = opts || {};
    return {
      version: 1,
      cohorts: [], // 不可变更新：每次变更替换数组/条目
      minCohortsPerStratum: isInt(opts.minCohortsPerStratum) ? opts.minCohortsPerStratum : 2,
      rev: 0,
      _cache: new Map(),
    };
  }

  function getCohort(state, id) {
    return state.cohorts.find((c) => c.id === id) || null;
  }

  function err(code, message, extra) {
    return Object.assign({ ok: false, code: code, message: message }, extra || {});
  }

  // ---------- 队列维护 ----------

  let _seq = 0;
  function makeId(name) {
    _seq += 1;
    var slug = String(name || 'cohort')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'cohort';
    return slug + '-' + Math.abs(hashStr(String(name) + ':' + _seq + ':' + (Date.now ? Date.now() : 0))).toString(36).slice(0, 6);
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  /**
   * 新建队列。
   * @attr {id?,name,channel,stratum,size,startAt,note?}
   */
  function addCohort(state, attr) {
    if (!attr || typeof attr.name !== 'string' || !attr.name.trim()) {
      return err('BAD_NAME', '队列名称不能为空');
    }
    if (!attr.channel || !String(attr.channel).trim()) {
      return err('BAD_CHANNEL', '必须指定获客渠道');
    }
    if (!attr.stratum || !String(attr.stratum).trim()) {
      return err('BAD_STRATUM', '必须指定分层属性');
    }
    if (!isInt(attr.size) || attr.size <= 0) {
      return err('BAD_SIZE', '队列规模必须为正整数', { field: 'size' });
    }
    var startAt = parseStartAt(attr.startAt);
    if (!startAt) {
      return err('BAD_START', '起始时刻格式无效（应为日期或 ISO 时间）', { field: 'startAt' });
    }
    var id = attr.id ? String(attr.id) : makeId(attr.name);
    if (state.cohorts.some((c) => c.id === id)) {
      return err('DUP_ID', '队列 ID 已存在：' + id);
    }
    var cohort = {
      id: id,
      name: attr.name.trim(),
      channel: String(attr.channel).trim(),
      stratum: String(attr.stratum).trim(),
      size: attr.size,
      startAt: startAt,
      note: attr.note ? String(attr.note) : '',
      obs: [], // {period, active, source, ts}，同一期可因多来源而多条
      conflicts: [], // {key,cohortId,cohortName,period,values:[{active,source,ts}],status,resolvedValue,resolution}
      createdAt: attr.createdAt || nowIso(),
    };
    state.cohorts = state.cohorts.concat([cohort]);
    state.rev += 1;
    return { ok: true, status: 'created', cohortId: id, cohort: cohort };
  }

  function parseStartAt(v) {
    if (v == null || v === '') return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function obsLoc(cohort, p, source) {
    return '队列「' + cohort.name + '」第 ' + p + ' 期' + (source ? '（来源：' + source + '）' : '');
  }

  /**
   * 上报单期活跃数（幂等）。
   *
   * 规则：
   *  - period 必须为 ≥0 的整数；不允许早于该队列已观测到的最大期（时刻倒退）。
   *  - active 必须为 0..size 的整数（超规模拒绝）。
   *  - 同一 (period, source, active) 重复上报 → 幂等忽略。
   *  - 同一 period 出现不同 active（无论来源是否相同）→ 双方都保留，挂起冲突，绝不静默择一。
   */
  function addObservation(state, cohortId, observation) {
    var cohort = getCohort(state, cohortId);
    if (!cohort) return err('NO_COHORT', '队列不存在：' + cohortId);

    var p = observation && observation.period;
    var active = observation && observation.active;
    var source = observation && observation.source ? String(observation.source).trim() : '';
    if (!source) return err('BAD_SOURCE', obsLoc(cohort, p, '') + '：上报必须注明来源');
    if (!isInt(p) || p < 0) {
      return err('BAD_PERIOD', obsLoc(cohort, p, source) + '：观察期必须为 ≥0 的整数', { field: 'period' });
    }
    if (!isInt(active) || active < 0) {
      return err('BAD_ACTIVE', obsLoc(cohort, p, source) + '：活跃数必须为非负整数', { field: 'active' });
    }
    if (active > cohort.size) {
      return err(
        'ACTIVE_OVER_SIZE',
        obsLoc(cohort, p, source) + '：活跃数 ' + active + ' 超过队列规模 ' + cohort.size + '，已拒绝',
        { location: obsLoc(cohort, p, source), period: p, size: cohort.size, active: active, field: 'active' }
      );
    }
    var samePeriod = cohort.obs.filter((o) => o.period === p);

    // 幂等优先于时刻倒退：同一数据的重复投递（同期/同来源/同值）不是倒退，直接忽略
    var exact = samePeriod.find((o) => o.active === active && o.source === source);
    if (exact) {
      return { ok: true, status: 'duplicate', cohortId: cohortId, period: p, message: '与既有上报完全一致（' + obsLoc(cohort, p, source) + '，值 ' + active + '），按幂等处理（无变化）' };
    }

    var maxPeriod = cohort.obs.reduce(function (m, o) {
      return Math.max(m, o.period);
    }, -1);
    // 倒退仅指“给从未上报过的历史期补数据”；该期已有上报时，迟到的矛盾值走冲突保留流程
    if (p < maxPeriod && samePeriod.length === 0) {
      return err(
        'TIME_REGRESSION',
        obsLoc(cohort, p, source) + '：该队列已观测到第 ' + maxPeriod + ' 期，且第 ' + p + ' 期此前从未上报，时刻不允许倒退，已拒绝',
        { location: obsLoc(cohort, p, source), period: p, maxObservedPeriod: maxPeriod, field: 'period' }
      );
    }

    // 同一来源、同一期、数值不同：也属于互相矛盾，双方皆保留
    var existingDifferent = samePeriod.filter((o) => o.active !== active);
    var pending = cohort.conflicts.find((c) => c.period === p && c.status === 'pending');

    var entry = { period: p, active: active, source: source, ts: observation.ts || nowIso() };
    var nextObs = cohort.obs.concat([entry]).sort((x, y) => (x.period - y.period) || (x.source < y.source ? -1 : 1));
    var nextConflicts;

    if (existingDifferent.length === 0 && !pending) {
      nextConflicts = cohort.conflicts;
      commitCohort(state, cohort, nextObs, nextConflicts);
      return { ok: true, status: 'added', cohortId: cohortId, period: p };
    }

    // 产生/更新冲突：保留全部不同数值
    var values;
    if (pending) {
      values = pending.values.concat([{ active: active, source: source, ts: entry.ts }]);
    } else {
      values = existingDifferent
        .map((o) => ({ active: o.active, source: o.source, ts: o.ts }))
        .concat([{ active: active, source: source, ts: entry.ts }]);
    }
    values = dedupeValues(values).sort((a, b) => (a.active - b.active) || (a.source < b.source ? -1 : 1));
    var key = cohortId + '#p' + p;
    if (pending) {
      nextConflicts = cohort.conflicts.map((c) => (c === pending ? Object.assign({}, c, { values: values }) : c));
    } else {
      nextConflicts = cohort.conflicts.concat([
        {
          key: key,
          cohortId: cohortId,
          cohortName: cohort.name,
          period: p,
          values: values,
          status: 'pending',
          resolvedValue: null,
          resolution: null,
          createdAt: nowIso(),
        },
      ]);
    }
    commitCohort(state, cohort, nextObs, nextConflicts);
    return {
      ok: true,
      status: 'conflict',
      cohortId: cohortId,
      period: p,
      conflictKey: key,
      message:
        obsLoc(cohort, p) + ' 出现互相矛盾的活跃数：' +
        values.map((v) => v.active + '（来源：' + v.source + '）').join(' vs ') +
        '。双方数值均已保留，需人工裁决，比较在裁决前不把该期计入共同窗口。',
    };
  }

  function dedupeValues(values) {
    var seen = new Set();
    return values.filter((v) => {
      var k = v.active + '@' + v.source + '@' + v.ts;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * 修正队列规模。不得小于任何已观测活跃数，否则拒绝并逐一指出位置。
   */
  function correctScale(state, cohortId, newSize, reason) {
    var cohort = getCohort(state, cohortId);
    if (!cohort) return err('NO_COHORT', '队列不存在：' + cohortId);
    if (!isInt(newSize) || newSize <= 0) return err('BAD_SIZE', '队列规模必须为正整数');
    var violates = maxActiveByPeriod(cohort)
      .filter((m) => m.active > newSize)
      .map((m) => '第 ' + m.period + ' 期活跃数 ' + m.active + (m.sources.length ? '（来源：' + m.sources.join('、') + '）' : ''));
    if (violates.length) {
      return err(
        'SCALE_BELOW_ACTIVE',
        '规模修正被拒绝：新规模 ' + newSize + ' 小于以下已观测活跃数 — ' + violates.join('；'),
        { locations: violates }
      );
    }
    if (newSize === cohort.size) {
      return { ok: true, status: 'duplicate', cohortId: cohortId, message: '规模未变化' };
    }
    var next = Object.assign({}, cohort, {
      size: newSize,
      scaleHistory: (cohort.scaleHistory || []).concat([{ from: cohort.size, to: newSize, reason: reason || '', at: nowIso() }]),
    });
    state.cohorts = state.cohorts.map((c) => (c.id === cohortId ? next : c));
    state.rev += 1;
    return { ok: true, status: 'corrected', cohortId: cohortId, from: cohort.size, to: newSize };
  }

  /**
   * 裁决冲突：冲突记录永久保留（进入 resolved），选定值带裁决来源与理由。
   */
  function resolveConflict(state, conflictKey, chosen) {
    var target = null;
    var cohort = null;
    state.cohorts.forEach((c) => {
      var f = c.conflicts.find((x) => x.key === conflictKey);
      if (f) {
        target = f;
        cohort = c;
      }
    });
    if (!target) return err('NO_CONFLICT', '冲突不存在：' + conflictKey);
    if (target.status !== 'pending') return err('ALREADY_RESOLVED', '该冲突已裁决：' + conflictKey);
    var pick = target.values.find((v) => v.active === chosen.active && (!chosen.source || v.source === chosen.source));
    if (!pick) {
      if (!isInt(chosen.active) || chosen.active < 0 || chosen.active > cohort.size) {
        return err('BAD_RESOLUTION', '裁决值必须是 0 到规模 ' + cohort.size + ' 之间的整数');
      }
      pick = { active: chosen.active, source: chosen.source || '人工录入' };
    }
    var resolution = {
      active: pick.active,
      source: pick.source,
      reason: chosen.reason || '',
      by: chosen.by || '人工裁决',
      at: nowIso(),
    };
    var nextConflicts = cohort.conflicts.map((c) =>
      c === target ? Object.assign({}, c, { status: 'resolved', resolvedValue: resolution, resolution: resolution }) : c
    );
    commitCohort(state, cohort, cohort.obs, nextConflicts);
    return { ok: true, status: 'resolved', conflictKey: conflictKey, resolution: resolution };
  }

  function commitCohort(state, old, nextObs, nextConflicts) {
    var next = Object.assign({}, old, { obs: nextObs, conflicts: nextConflicts });
    state.cohorts = state.cohorts.map((c) => (c.id === old.id ? next : c));
    state.rev += 1;
  }

  // ---------- 读取模型 ----------

  /** 某队列各期的“有效值”。冲突未裁决 → null（不可静默择一）。 */
  function effectiveActive(cohort, period) {
    var rows = cohort.obs.filter((o) => o.period === period);
    if (!rows.length) return null;
    var conflict = cohort.conflicts.find((c) => c.period === period);
    if (conflict) {
      if (conflict.status === 'resolved' && conflict.resolvedValue) return conflict.resolvedValue.active;
      return null; // pending：禁止择一
    }
    return rows[0].active;
  }

  function observedPeriods(cohort) {
    var set = new Set(cohort.obs.map((o) => o.period));
    return Array.from(set).sort((a, b) => a - b);
  }

  function maxObservedPeriod(cohort) {
    return cohort.obs.reduce((m, o) => Math.max(m, o.period), -1);
  }

  function maxActiveByPeriod(cohort) {
    return observedPeriods(cohort).map((p) => {
      var rows = cohort.obs.filter((o) => o.period === p);
      return { period: p, active: Math.max.apply(null, rows.map((r) => r.active)), sources: Array.from(new Set(rows.map((r) => r.source))) };
    });
  }

  function pendingConflictPeriods(cohort) {
    return new Set(cohort.conflicts.filter((c) => c.status === 'pending').map((c) => c.period));
  }

  // ---------- 比较（纯函数 + 签名缓存）----------

  /** 队列内容签名：规模、观测、冲突裁决全部进入签名 */
  function cohortSignature(cohort) {
    var obs = cohort.obs
      .map((o) => [o.period, o.active, o.source])
      .sort((a, b) => (a[0] - b[0]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[1] - b[1]));
    var conflicts = cohort.conflicts
      .map((c) => [c.period, c.status, c.resolvedValue ? c.resolvedValue.active : null, c.resolvedValue ? c.resolvedValue.source : null])
      .sort((a, b) => a[0] - b[0]);
    return JSON.stringify({ id: cohort.id, size: cohort.size, obs: obs, conflicts: conflicts });
  }

  /**
   * 比较两个队列。未受影响的比较返回同一结果对象（签名未变即命中缓存）。
   * 仅在两队列都有“有效观测”的共同期上比较；其余观测一律排除并给出原因，
   * 既不当作 0，也不按缺失插补。
   */
  function compareCohorts(state, idA, idB) {
    var rawA = getCohort(state, idA);
    var rawB = getCohort(state, idB);
    if (!rawA || !rawB) return err('NO_COHORT', '比较失败：队列不存在（' + idA + ' / ' + idB + '）');
    if (idA === idB) return err('SAME_COHORT', '请选择两个不同的队列');

    // 一律归一化到 id 字典序方向计算，保证缓存内容是与方向无关的 canonical 结果
    var loKey = idA < idB ? idA : idB;
    var hiKey = loKey === idA ? idB : idA;
    var a = getCohort(state, loKey);
    var b = getCohort(state, hiKey);

    var sigLo = cohortSignature(a);
    var sigHi = cohortSignature(b);
    var cacheKey = loKey + '|' + hiKey + '|' + sigLo + '|' + sigHi;
    if (state._cache.has(cacheKey)) {
      var hit = state._cache.get(cacheKey);
      // 结果按请求方向（A/B）输出；缓存以 id 字典序存放
      return orientResult(hit, idA, idB);
    }

    var periodsA = usablePeriods(a);
    var periodsB = usablePeriods(b);
    var setA = new Set(periodsA);
    var setB = new Set(periodsB);
    var common = periodsA.filter((p) => setB.has(p)).sort((x, y) => x - y);

    var exclusions = [];
    var pendingA = pendingConflictPeriods(a);
    var pendingB = pendingConflictPeriods(b);

    if (common.length === 0) {
      gatherExclusions(a, b, null, pendingA, pendingB, periodsA, periodsB, exclusions);
      var noWindow = {
        ok: false,
        code: 'NO_COMMON_WINDOW',
        canonical: true,
        idA: loKey,
        idB: hiKey,
        cohortA: getCohort(state, loKey),
        cohortB: getCohort(state, hiKey),
        window: null,
        rows: [],
        exclusions: exclusions,
        message: '两队列没有任何共同观察期，无法比较（不做零填补）。',
      };
      state._cache.set(cacheKey, noWindow);
      return orientResult(noWindow, idA, idB);
    }

    var winLo = common[0];
    var winHi = common[common.length - 1];

    // 窗口内的缺口（一方该期无观测）也要排除；未裁决冲突期由冲突原因单独说明，不重复记缺口
    for (var p = winLo; p <= winHi; p++) {
      if (!setA.has(p) && !pendingA.has(p)) exclusions.push(exclusion(a, p, 'GAP_IN_WINDOW', '位于共同窗口跨度内但队列「' + a.name + '」该期无观测，不做零/缺失填补'));
      if (!setB.has(p) && !pendingB.has(p)) exclusions.push(exclusion(b, p, 'GAP_IN_WINDOW', '位于共同窗口跨度内但队列「' + b.name + '」该期无观测，不做零/缺失填补'));
    }
    gatherExclusions(a, b, [winLo, winHi], pendingA, pendingB, periodsA, periodsB, exclusions);

    var rows = common.map(function (period) {
      var actA = effectiveActive(a, period);
      var actB = effectiveActive(b, period);
      var rateA = actA / a.size;
      var rateB = actB / b.size;
      var diff = rateA - rateB;
      return {
        period: period,
        activeA: actA,
        activeB: actB,
        rateA: rateA,
        rateB: rateB,
        diff: diff,
        direction: diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie',
      };
    });

    // 反转检测：相邻非零差异符号变化（tie 不改变“上一方向”）
    var reversals = [];
    var lastDir = null;
    rows.forEach(function (r) {
      if (r.direction === 'tie') return;
      if (lastDir && r.direction !== lastDir) {
        reversals.push({ period: r.period, from: lastDir, to: r.direction });
      }
      lastDir = r.direction;
    });

    var diffs = rows.map((r) => r.diff);
    var result = {
      ok: true,
      canonical: true,
      idA: loKey,
      idB: hiKey,
      cohortA: getCohort(state, loKey),
      cohortB: getCohort(state, hiKey),
      sameStratum: a.stratum === b.stratum,
      window: { start: winLo, end: winHi, length: common.length, periods: common },
      rows: rows,
      exclusions: exclusions.sort((x, y) => (x.cohortId < y.cohortId ? -1 : x.cohortId > y.cohortId ? 1 : x.period - y.period)),
      reversals: reversals,
      hasReversal: reversals.length > 0,
      summary: {
        meanRateA: rows.reduce((s, r) => s + r.rateA, 0) / rows.length,
        meanRateB: rows.reduce((s, r) => s + r.rateB, 0) / rows.length,
        meanDiff: diffs.reduce((s, d) => s + d, 0) / diffs.length,
        aLeads: rows.filter((r) => r.direction === 'A').length,
        bLeads: rows.filter((r) => r.direction === 'B').length,
        ties: rows.filter((r) => r.direction === 'tie').length,
      },
      generatedAt: null, // 纯结果不含时间，保证逐字节可复现
    };
    state._cache.set(cacheKey, result);
    return orientResult(result, idA, idB);
  }

  function orientResult(r, idA, idB) {
    if (r.idA === idA && r.idB === idB) return r;
    // 翻转 A/B
    var copy = clone(r);
    copy.idA = idA;
    copy.idB = idB;
    copy.cohortA = r.cohortB;
    copy.cohortB = r.cohortA;
    copy.rows = (r.rows || []).map(function (x) {
      return {
        period: x.period,
        activeA: x.activeB,
        activeB: x.activeA,
        rateA: x.rateB,
        rateB: x.rateA,
        diff: -x.diff,
        direction: x.direction === 'A' ? 'B' : x.direction === 'B' ? 'A' : 'tie',
      };
    });
    copy.reversals = (r.reversals || []).map((v) => ({ period: v.period, from: v.from === 'A' ? 'B' : 'A', to: v.to === 'A' ? 'B' : 'A' }));
    if (r.summary) {
      copy.summary = {
        meanRateA: r.summary.meanRateB,
        meanRateB: r.summary.meanRateA,
        meanDiff: -r.summary.meanDiff,
        aLeads: r.summary.bLeads,
        bLeads: r.summary.aLeads,
        ties: r.summary.ties,
      };
    }
    return copy;
  }

  /** 可用于比较的期：有观测且冲突已裁决 */
  function usablePeriods(cohort) {
    var pending = pendingConflictPeriods(cohort);
    return observedPeriods(cohort)
      .filter((p) => !pending.has(p))
      .sort((a, b) => a - b);
  }

  function exclusion(cohort, period, code, reason) {
    var rows = cohort.obs.filter((o) => o.period === period);
    var sources = Array.from(new Set(rows.map((r) => r.source)));
    var actives = Array.from(new Set(rows.map((r) => r.active)));
    return {
      cohortId: cohort.id,
      cohortName: cohort.name,
      period: period,
      actives: actives,
      sources: sources,
      reasonCode: code,
      reason: reason,
    };
  }

  function gatherExclusions(a, b, window, pendingA, pendingB, periodsA, periodsB, out) {
    var lo = window ? window[0] : null;
    var hi = window ? window[1] : null;
    periodsA.forEach((p) => {
      if (window && p >= lo && p <= hi) return; // 窗口内的缺口/冲突另行处理
      if (!window) {
        out.push(exclusion(a, p, 'OUTSIDE_WINDOW', '两队列无共同窗口：该观测不参与比较，不作零填补'));
        return;
      }
      out.push(
        p < lo
          ? exclusion(a, p, 'BEFORE_WINDOW', '早于共同观察窗口起点（第 ' + lo + ' 期）：队列「' + b.name + '」在此之前无观测，该点排除，不做零填补')
          : exclusion(a, p, 'AFTER_WINDOW', '超出共同观察窗口终点（第 ' + hi + ' 期）：队列「' + b.name + '」观测更短，该点排除——不得当作 0 或缺失')
      );
    });
    periodsB.forEach((p) => {
      if (window && p >= lo && p <= hi) return;
      if (!window) {
        out.push(exclusion(b, p, 'OUTSIDE_WINDOW', '两队列无共同窗口：该观测不参与比较，不作零填补'));
        return;
      }
      out.push(
        p < lo
          ? exclusion(b, p, 'BEFORE_WINDOW', '早于共同观察窗口起点（第 ' + lo + ' 期）：队列「' + a.name + '」在此之前无观测，该点排除，不做零填补')
          : exclusion(b, p, 'AFTER_WINDOW', '超出共同观察窗口终点（第 ' + hi + ' 期）：队列「' + a.name + '」观测更短，该点排除——不得当作 0 或缺失')
      );
    });
    // 未裁决冲突：即使双方都有该期，也禁止纳入
    pendingA.forEach((p) => out.push(exclusion(a, p, 'UNRESOLVED_CONFLICT', '该期存在未裁决的数值冲突，双方数值并存，禁止静默择一；裁决后方可计入共同窗口')));
    pendingB.forEach((p) => out.push(exclusion(b, p, 'UNRESOLVED_CONFLICT', '该期存在未裁决的数值冲突，双方数值并存，禁止静默择一；裁决后方可计入共同窗口')));
  }

  // ---------- 分层可比性 ----------

  function strataSummary(state) {
    var map = new Map();
    state.cohorts.forEach((c) => {
      if (!map.has(c.stratum)) map.set(c.stratum, []);
      map.get(c.stratum).push(c);
    });
    var min = state.minCohortsPerStratum;
    return Array.from(map.keys())
      .sort()
      .map((name) => {
        var list = map.get(name);
        var usable = list.filter((c) => observedPeriods(c).length > 0);
        var pendingConflicts = list.reduce((n, c) => n + c.conflicts.filter((x) => x.status === 'pending').length, 0);
        return {
          stratum: name,
          cohorts: list.slice().sort((x, y) => x.name.localeCompare(y.name)),
          count: list.length,
          usableCount: usable.length,
          required: min,
          comparable: usable.length >= min,
          missing: Math.max(0, min - usable.length),
          pendingConflicts: pendingConflicts,
          note:
            usable.length >= min
              ? (pendingConflicts ? '分层可比，但有 ' + pendingConflicts + ' 个未裁决冲突会收窄共同窗口' : '分层可比')
              : '该分层仅有 ' + usable.length + ' 个含观测的队列，低于下限 ' + min + '，还缺 ' + (min - usable.length) + ' 个，标记为不可比，不得与其他分层并列得出优劣结论',
        };
      });
  }

  function setMinCohortsPerStratum(state, n) {
    if (!isInt(n) || n < 1) return err('BAD_MIN', '每分层最少队列数必须为 ≥1 的整数');
    state.minCohortsPerStratum = n;
    state.rev += 1;
    return { ok: true, value: n };
  }

  // ---------- 留存矩阵 ----------

  /**
   * 留存矩阵：行为队列，列为观察期。
   * 未观察期状态为 'unobserved'，与 observed 的 0% 留存视觉/语义都不同。
   */
  function retentionMatrix(state) {
    var maxP = state.cohorts.reduce((m, c) => Math.max(m, maxObservedPeriod(c)), -1);
    var periods = [];
    for (var i = 0; i <= maxP; i++) periods.push(i);
    var rows = state.cohorts
      .slice()
      .sort((a, b) => a.stratum.localeCompare(b.stratum) || a.name.localeCompare(b.name))
      .map(function (c) {
        var pending = pendingConflictPeriods(c);
        return {
          cohort: c,
          cells: periods.map(function (p) {
            var has = c.obs.some((o) => o.period === p);
            if (!has) return { period: p, state: 'unobserved', rate: null, active: null };
            var conflict = c.conflicts.find((x) => x.period === p);
            if (conflict) {
              if (conflict.status === 'resolved') {
                var act = conflict.resolvedValue.active;
                return { period: p, state: 'resolved-conflict', rate: act / c.size, active: act, conflict: conflict };
              }
              return { period: p, state: 'conflicted', rate: null, active: null, conflict: conflict };
            }
            var active = effectiveActive(c, p);
            return { period: p, state: 'observed', rate: active / c.size, active: active };
          }),
        };
      });
    return { periods: periods, rows: rows };
  }

  // ---------- 全量重算（用于校验增量一致性）----------

  function clearCache(state) {
    state._cache.clear();
  }

  /** 在 fresh state 上重放全部数据并重算指定比较，供“增量 === 全量”校验 */
  function fullRecompute(snapshot, idA, idB) {
    var fresh = hydrate(clone(snapshot));
    clearCache(fresh);
    return compareCohorts(fresh, idA, idB);
  }

  /** 去掉运行时字段后的可序列化快照 */
  function serialize(state) {
    return JSON.stringify({
      version: state.version,
      minCohortsPerStratum: state.minCohortsPerStratum,
      cohorts: state.cohorts,
    }, null, 2);
  }

  function hydrate(obj) {
    var state = createState({ minCohortsPerStratum: obj.minCohortsPerStratum || 2 });
    state.version = obj.version || 1;
    state.cohorts = obj.cohorts || [];
    return state;
  }

  /** 导入全量数据：逐条执行全部领域校验 */
  function loadFromSnapshot(obj) {
    var state = createState({ minCohortsPerStratum: obj.minCohortsPerStratum || 2 });
    var errors = [];
    (obj.cohorts || []).forEach(function (c) {
      var r = addCohort(state, {
        id: c.id,
        name: c.name,
        channel: c.channel,
        stratum: c.stratum,
        size: c.size,
        startAt: c.startAt,
        note: c.note || '',
        createdAt: c.createdAt,
      });
      if (!r.ok) {
        errors.push(r.message);
        return;
      }
      var id = r.cohortId;
      if (Array.isArray(c.scaleHistory)) {
        var created = getCohort(state, id);
        created.scaleHistory = c.scaleHistory;
      }
      // 按期升序重放，同期多来源保持文件顺序；校验规则与实时上报完全一致
      var groups = new Map();
      (c.obs || []).forEach(function (o) {
        if (!groups.has(o.period)) groups.set(o.period, []);
        groups.get(o.period).push(o);
      });
      Array.from(groups.keys())
        .sort((a, b) => a - b)
        .forEach(function (p) {
          groups.get(p).forEach(function (o) {
            var rr = addObservation(state, id, { period: p, active: o.active, source: o.source, ts: o.ts });
            if (!rr.ok) errors.push(rr.message);
          });
        });
      // 复刻已裁决冲突
      (c.conflicts || [])
        .filter((x) => x.status === 'resolved' && x.resolvedValue)
        .forEach(function (x) {
          resolveConflict(state, x.key, {
            active: x.resolvedValue.active,
            source: x.resolvedValue.source,
            reason: x.resolvedValue.reason,
            by: x.resolvedValue.by,
          });
        });
    });
    return { state: state, errors: errors };
  }

  return {
    // state
    createState: createState,
    serialize: serialize,
    hydrate: hydrate,
    loadFromSnapshot: loadFromSnapshot,
    clearCache: fullRecompute_clearCache,
    fullRecompute: fullRecompute,
    deepEqual: deepEqual,
    // cohorts
    addCohort: addCohort,
    correctScale: correctScale,
    addObservation: addObservation,
    resolveConflict: resolveConflict,
    getCohort: getCohort,
    // read models
    compareCohorts: compareCohorts,
    strataSummary: strataSummary,
    retentionMatrix: retentionMatrix,
    observedPeriods: observedPeriods,
    effectiveActive: effectiveActive,
    pendingConflictPeriods: pendingConflictPeriods,
    maxObservedPeriod: maxObservedPeriod,
    cohortSignature: cohortSignature,
    setMinCohortsPerStratum: setMinCohortsPerStratum,
  };

  function fullRecompute_clearCache(state) {
    state._cache.clear();
  }
});
