/**
 * 假设与证据验证工作台 —— 纯逻辑引擎（无外部依赖）
 *
 * 设计要点：
 *  - 所有计算函数均为纯函数：同一状态 + 同一来源关系图 => 同一结论，与登记顺序无关。
 *  - 来源关系：同源(same) 做等价类合并；派生(derived) 是等价类之间的有向边，禁止成环。
 *    独立性分组 = 在“同源 + 派生（按无向连通）”图上的连通分量，每个分量只算一条独立证据。
 *  - 结论强度：证据质量、独立性、人群覆盖、反证强度四维合成；正反并存时双方都保留，
 *    势均力敌一律判“证据不足”。
 *  - act() 每次变更只重算受影响假设，并同时做一次全量重算比对（parity），保证增量结果
 *    与从头全量重算完全一致。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EV = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================== 常量 ============================== */

  const STANCE = { SUPPORT: 'support', REFUTE: 'refute' };
  const STANCE_LABEL = { support: '支持', refute: '反驳' };
  const QUALITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
  const QUALITY_WEIGHT = { high: 3, medium: 2, low: 1 };
  const QUALITY_LABEL = { high: '高', medium: '中', low: '低' };
  const H_STATUS = ['待验证', '验证中', '已验证', '已证伪'];

  // 结论档位：strong/moderate/weak 各分支持、反驳；insufficient 证据不足；none 无法判定
  const GRADE = {
    STRONG_SUPPORT: 'strong_support',
    MODERATE_SUPPORT: 'moderate_support',
    WEAK_SUPPORT: 'weak_support',
    INSUFFICIENT: 'insufficient',
    WEAK_REFUTE: 'weak_refute',
    MODERATE_REFUTE: 'moderate_refute',
    STRONG_REFUTE: 'strong_refute',
    NONE: 'none',
  };
  const GRADE_LABEL = {
    strong_support: '强支持',
    moderate_support: '支持',
    weak_support: '弱支持',
    insufficient: '证据不足',
    weak_refute: '弱反驳',
    moderate_refute: '反驳',
    strong_refute: '强反驳',
    none: '无法判定',
  };
  const GRADE_SCORE = {
    strong_support: 5, moderate_support: 3, weak_support: 1,
    insufficient: 0, none: 0,
    weak_refute: -1, moderate_refute: -3, strong_refute: -5,
  };
  // 强档要求占比；中档（最低“成结论”门槛）要求占比
  const STRONG_SHARE = 0.75;
  const DECISIVE_SHARE = 2 / 3;

  /* ============================== 工具 ============================== */

  const sorted = (arr) => arr.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const uniq = (arr) => sorted(Array.from(new Set(arr)));
  const trim = (s) => (s == null ? '' : String(s).trim());
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const pct = (x) => Math.round(x * 1000) / 10; // 保留一位小数

  function padId(prefix, n) {
    return prefix + String(n).padStart(3, '0');
  }
  function nextId(prefix, existing) {
    let max = 0;
    for (const id of existing) {
      const m = new RegExp('^' + prefix + '(\\d+)$').exec(id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return padId(prefix, max + 1);
  }

  /** 校验采集时刻：接受 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm[:ss] */
  function validateCapturedAt(v) {
    const s = trim(v).replace(' ', 'T');
    if (!s) return { ok: false, value: '', reason: '采集时刻缺失' };
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
      return { ok: false, value: trim(v), reason: '采集时刻格式无法识别（应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm）' };
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return { ok: false, value: trim(v), reason: '采集时刻不是有效日期' };
    return { ok: true, value: s.length === 10 ? s : s.slice(0, 16) };
  }

  function normalizeStance(v) {
    const s = trim(v).toLowerCase();
    if (s === 'support' || s === '支持' || s === '挺' || s === '正向') return { ok: true, value: STANCE.SUPPORT };
    if (s === 'refute' || s === '反驳' || s === '反对' || s === '负向') return { ok: true, value: STANCE.REFUTE };
    return { ok: false, reason: '立场缺失或无法识别（必须明确为“支持”或“反驳”，不得默认）' };
  }

  function normalizeQuality(v) {
    const s = trim(v).toLowerCase();
    if (s === 'high' || s === '高' || s === '高质量') return QUALITY.HIGH;
    if (s === 'low' || s === '低' || s === '低质量') return QUALITY.LOW;
    return QUALITY.MEDIUM; // 质量可缺省为中；来源/时刻/立场不允许缺省
  }

  class UnionFind {
    constructor() { this.p = new Map(); }
    add(x) { if (!this.p.has(x)) this.p.set(x, x); }
    find(x) {
      this.add(x);
      let r = x;
      while (this.p.get(r) !== r) r = this.p.get(r);
      let cur = x;
      while (this.p.get(cur) !== cur) { const nxt = this.p.get(cur); this.p.set(cur, r); cur = nxt; }
      return r;
    }
    union(a, b) {
      const ra = this.find(a), rb = this.find(b);
      if (ra === rb) return false;
      // 规范代表元取字典序最小，保证顺序无关
      const [small, big] = ra < rb ? [ra, rb] : [rb, ra];
      this.p.set(big, small);
      return true;
    }
  }

  function bfsPath(adj, from, to) {
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const x = q.shift();
      for (const y of adj.get(x) || []) {
        if (!prev.has(y)) { prev.set(y, x); if (y === to) {
          const path = [to]; let c = to;
          while (prev.get(c) != null) { c = prev.get(c); path.unshift(c); }
          return path;
        } q.push(y); }
      }
    }
    return null;
  }

  /* ============================== 状态 ============================== */

  function createState() {
    return { version: 1, hypotheses: [], evidence: [], relations: [] };
  }

  function createStore(initialState) {
    const state = initialState || createState();
    const model = buildSourceModel(state);
    const results = computeAllWithModel(state, model);
    return { state, model, results };
  }

  /* ====================== 来源模型（同源/派生） ====================== */

  /**
   * @returns {
   *   sources: string[],
   *   classOf: Map<source, classId>,                 // 同源等价类
   *   classMembers: Map<classId, source[]>,
   *   derivedEdges: [{from:classId,to:classId}],     // 类间派生 DAG
   *   clusterOf: Map<source, clusterId>,             // 独立来源组（同源∪派生无向连通）
   *   clusterMembers: Map<clusterId, source[]>,
   * }
   */
  function buildSourceModel(state) {
    const sourceSet = new Set();
    state.evidence.forEach((e) => { if (trim(e.sourceId)) sourceSet.add(trim(e.sourceId)); });
    state.relations.forEach((r) => { sourceSet.add(r.from); sourceSet.add(r.to); });

    const uf = new UnionFind();
    sourceSet.forEach((s) => uf.add(s));

    const sameAdj = new Map();
    const addUndirected = (adj, a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    };
    state.relations
      .filter((r) => r.kind === 'same')
      .forEach((r) => { uf.union(r.from, r.to); addUndirected(sameAdj, r.from, r.to); });

    // 类成员（代表元 = 字典序最小来源）
    const classOf = new Map();
    const classMembers = new Map();
    const rawGroups = new Map();
    sourceSet.forEach((s) => {
      const root = uf.find(s);
      if (!rawGroups.has(root)) rawGroups.set(root, new Set());
      rawGroups.get(root).add(s);
    });
    rawGroups.forEach((members, root) => {
      const classId = sorted(Array.from(members))[0];
      classMembers.set(classId, sorted(Array.from(members)));
      members.forEach((s) => classOf.set(s, classId));
      void root;
    });

    // 派生边（类间去重、去自环、排序——顺序无关）
    const edgeSet = new Set();
    const derivedEdges = [];
    state.relations
      .filter((r) => r.kind === 'derived')
      .forEach((r) => {
        const cf = classOf.get(r.from) || r.from;
        const ct = classOf.get(r.to) || r.to;
        if (cf === ct) return; // 同源合并产生的自环在登记时已作废，此处再兜底
        const key = cf + '->' + ct;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        derivedEdges.push({ from: cf, to: ct });
      });
    derivedEdges.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));

    // 独立来源组：把类作为节点，同源(类内)与派生边按无向连通
    const undAdj = new Map();
    const ensureNode = (x) => { if (!undAdj.has(x)) undAdj.set(x, []); };
    classMembers.forEach((members, classId) => {
      ensureNode(classId);
      void members;
    });
    derivedEdges.forEach(({ from, to }) => { ensureNode(from); ensureNode(to); addUndirected(undAdj, from, to); });

    const clusterOf = new Map();
    const clusterMembers = new Map();
    const seen = new Set();
    for (const start of sorted(Array.from(undAdj.keys()))) {
      if (seen.has(start)) continue;
      const stack = [start]; const compClasses = []; seen.add(start);
      while (stack.length) {
        const x = stack.pop(); compClasses.push(x);
        for (const y of undAdj.get(x) || []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
      }
      const members = uniq(compClasses.flatMap((c) => classMembers.get(c) || [c]));
      const clusterId = members[0];
      clusterMembers.set(clusterId, members);
      members.forEach((s) => clusterOf.set(s, clusterId));
    }
    // 关系里出现但无成员的极端兜底
    sourceSet.forEach((s) => {
      if (!clusterOf.has(s)) {
        clusterOf.set(s, s);
        clusterMembers.set(s, [s]);
      }
    });

    return {
      sources: sorted(Array.from(sourceSet)),
      classOf, classMembers, derivedEdges,
      clusterOf, clusterMembers,
    };
  }

  /** 类级派生 DAG 上的有向路径（用于成环提示） */
  function derivedClassPath(model, fromClass, toClass) {
    const adj = new Map();
    model.derivedEdges.forEach(({ from, to }) => {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push(to);
    });
    return bfsPath(adj, fromClass, toClass);
  }
  function sameSourcePath(state, from, to) {
    const adj = new Map();
    state.relations.filter((r) => r.kind === 'same').forEach((r) => {
      if (!adj.has(r.from)) adj.set(r.from, []);
      if (!adj.has(r.to)) adj.set(r.to, []);
      adj.get(r.from).push(r.to); adj.get(r.to).push(r.from);
    });
    return bfsPath(adj, from, to);
  }

  /* ============================== 登记校验 ============================== */

  function validateHypothesisInput(state, input) {
    const errors = [];
    const id = trim(input.id);
    const statement = trim(input.statement);
    const population = trim(input.population);
    if (!id) errors.push({ field: 'id', code: 'ID_EMPTY', message: '假设标识缺失（位置：标识字段）' });
    else if (state.hypotheses.some((h) => h.id === id)) {
      errors.push({ field: 'id', code: 'ID_DUPLICATE', message: `假设标识重复：「${id}」已存在（位置：标识字段）` });
    }
    if (!statement) {
      errors.push({ field: 'statement', code: 'STATEMENT_EMPTY', message: '判断陈述为空（位置：陈述字段），必须是可判定真假的一句话' });
    }
    if (!population) {
      errors.push({ field: 'population', code: 'POPULATION_EMPTY', message: '目标人群为空（位置：目标人群字段）' });
    }
    const segments = (Array.isArray(input.segments)
      ? input.segments
      : String(input.segments || '').split(/[,，、;；\n]/))
      .map(trim).filter(Boolean);
    return { errors, value: { id, statement, population, segments } };
  }

  /**
   * 校验一条观察材料。
   * 返回 {errors（硬拒绝）, fieldIssues（字段缺失→标记不通过）, value}
   */
  function validateEvidenceInput(state, input, rowIndex) {
    const loc = rowIndex != null ? `（位置：批量录入第 ${rowIndex} 行）` : '（位置：登记表单）';
    const errors = [];
    const fieldIssues = [];

    const hypothesisId = trim(input.hypothesisId);
    if (!hypothesisId) {
      errors.push({ field: 'hypothesisId', code: 'H_EMPTY', row: rowIndex, message: '未指定材料指向的假设' + loc });
    } else if (!state.hypotheses.some((h) => h.id === hypothesisId)) {
      errors.push({ field: 'hypothesisId', code: 'H_UNKNOWN', row: rowIndex, message: `假设标识「${hypothesisId}」不存在` + loc });
    }

    const sourceId = trim(input.sourceId);
    if (!sourceId) fieldIssues.push({ field: 'sourceId', reason: '来源缺失：无法判断独立性，不得默认通过' });

    const ts = validateCapturedAt(input.capturedAt);
    if (!ts.ok) fieldIssues.push({ field: 'capturedAt', reason: ts.reason });

    const st = normalizeStance(input.stance);
    if (!st.ok) fieldIssues.push({ field: 'stance', reason: st.reason });

    const value = {
      hypothesisId,
      sourceId,
      sourceLabel: trim(input.sourceLabel),
      capturedAt: ts.ok ? ts.value : trim(input.capturedAt),
      stance: st.ok ? st.value : trim(input.stance),
      quality: normalizeQuality(input.quality),
      segment: trim(input.segment),
      excerpt: trim(input.excerpt),
    };
    return { errors, fieldIssues, value, loc };
  }

  /* ============================== 结论计算 ============================== */

  function groupBySource(activeRecords) {
    const map = new Map();
    for (const r of activeRecords) {
      if (!map.has(r.sourceId)) map.set(r.sourceId, []);
      map.get(r.sourceId).push(r);
    }
    return map;
  }

  function coverageOf(h, observedSegments) {
    const declared = uniq(h.segments || []);
    const observed = uniq(observedSegments.filter(Boolean));
    if (declared.length === 0) {
      return { level: 'undeclared', ratio: null, declared: [], observed, missing: [], extra: [] };
    }
    const hit = observed.filter((s) => declared.includes(s));
    const missing = declared.filter((s) => !observed.includes(s));
    const extra = observed.filter((s) => !declared.includes(s));
    const ratio = hit.length / declared.length;
    const level = ratio >= 0.8 ? 'sufficient' : ratio >= 0.4 ? 'partial' : 'insufficient';
    return { level, ratio, declared, observed, missing, extra };
  }

  const COVERAGE_TEXT = {
    sufficient: '充分', partial: '部分', insufficient: '不足', undeclared: '未声明细分',
  };

  function buildOpposition(ws, wr, nS, nR) {
    const total = ws + wr;
    if (nS > 0 && nR > 0) {
      const dominant = ws === wr ? 'tie' : ws > wr ? 'support' : 'refute';
      if (dominant === 'tie') {
        return {
          hasBoth: true, supportWeight: ws, refuteWeight: wr,
          independentCounts: { support: nS, refute: nR },
          dominant: 'tie', margin: 0, dominanceShare: 0.5,
          note: `正反双方权重 ${ws}:${wr} 完全持平，独立来源 ${nS}:${nR}——双方证据均保留，判定证据不足，不得强行定论。`,
        };
      }
      const winW = Math.max(ws, wr), loseW = Math.min(ws, wr);
      const share = winW / total;
      const dirText = dominant === 'support' ? '支持方' : '反驳方';
      return {
        hasBoth: true, supportWeight: ws, refuteWeight: wr,
        independentCounts: { support: nS, refute: nR },
        dominant, margin: winW - loseW, dominanceShare: share,
        note: `正反并存，双方证据均保留：${dirText}占优，权重 ${ws}:${wr}，领先 ${winW - loseW}（占双方权重 ${pct(share)}%）。`,
      };
    }
    return {
      hasBoth: false, supportWeight: ws, refuteWeight: wr,
      independentCounts: { support: nS, refute: nR },
      dominant: nS > 0 ? 'support' : nR > 0 ? 'refute' : 'none',
      margin: total, dominanceShare: total ? 1 : 0,
      note: total ? `仅存在${nS > 0 ? '支持' : '反驳'}方证据（权重 ${total}），暂无反证。` : '尚无有效证据。',
    };
  }

  function computeHypothesis(state, h, model) {
    const mine = state.evidence.filter((e) => e.hypothesisId === h.id);
    const flagged = mine.filter((e) => e.flagged && !e.withdrawn);
    const withdrawn = mine.filter((e) => e.withdrawn);
    const active = mine.filter((e) => !e.flagged && !e.withdrawn);

    // —— 第一层：同一来源多次出现 => 一个来源单元 ——
    const bySrc = groupBySource(active);
    const sourceUnits = [];
    for (const sourceId of sorted(Array.from(bySrc.keys()))) {
      const rs = bySrc.get(sourceId).slice().sort((a, b) => (a.capturedAt + a.id < b.capturedAt + b.id ? -1 : 1));
      const stances = uniq(rs.map((r) => r.stance));
      const qualities = rs.map((r) => QUALITY_WEIGHT[r.quality]);
      sourceUnits.push({
        sourceId,
        sourceLabel: rs.map((r) => r.sourceLabel).filter(Boolean).pop() || sourceId,
        stance: stances.length === 1 ? stances[0] : 'conflicted',
        quality: rs.reduce((best, r) => (QUALITY_WEIGHT[r.quality] > QUALITY_WEIGHT[best.quality] ? r : best)).quality,
        qualityWeight: Math.max.apply(null, qualities),
        segments: uniq(rs.map((r) => r.segment)),
        firstAt: rs[0].capturedAt,
        recordIds: rs.map((r) => r.id),
        recordCount: rs.length,
      });
    }

    // —— 第二层：同源/派生连通 => 一个独立证据单元 ——
    const clusterMap = new Map();
    for (const su of sourceUnits.slice().sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1))) {
      const cid = model.clusterOf.get(su.sourceId) || su.sourceId;
      if (!clusterMap.has(cid)) {
        clusterMap.set(cid, {
          clusterId: cid,
          sources: [], sourceLabels: [], recordIds: [], recordCount: 0,
          stances: new Set(), qualities: [], segments: new Set(), firstAt: null,
        });
      }
      const c = clusterMap.get(cid);
      c.sources.push(su.sourceId);
      if (su.sourceLabel) c.sourceLabels.push(su.sourceLabel);
      c.recordIds.push.apply(c.recordIds, su.recordIds);
      c.recordCount += su.recordCount;
      c.stances.add(su.stance);
      c.qualities.push(su.qualityWeight);
      su.segments.forEach((s) => c.segments.add(s));
      c.firstAt = c.firstAt == null || su.firstAt < c.firstAt ? su.firstAt : c.firstAt;
    }
    const units = Array.from(clusterMap.values()).map((c) => ({
      clusterId: c.clusterId,
      sources: c.sources,
      sourceLabels: uniq(c.sourceLabels),
      recordIds: c.recordIds,
      recordCount: c.recordCount,
      stance: c.stances.size === 1 ? Array.from(c.stances)[0] : 'conflicted',
      weight: Math.max.apply(null, c.qualities),
      quality: Object.keys(QUALITY_WEIGHT).find((k) => QUALITY_WEIGHT[k] === Math.max.apply(null, c.qualities)),
      segments: sorted(Array.from(c.segments)),
      firstAt: c.firstAt,
    })).sort((a, b) => (a.clusterId < b.clusterId ? -1 : 1));

    const sup = units.filter((u) => u.stance === STANCE.SUPPORT);
    const ref = units.filter((u) => u.stance === STANCE.REFUTE);
    const conflicted = units.filter((u) => u.stance === 'conflicted');
    const ws = sup.reduce((s, u) => s + u.weight, 0);
    const wr = ref.reduce((s, u) => s + u.weight, 0);
    const winUnits = ws > wr ? sup : ws < wr ? ref : [];
    const winAvgWeight = winUnits.length ? winUnits.reduce((s, u) => s + u.weight, 0) / winUnits.length : 0;
    const coverage = coverageOf(h, units.flatMap((u) => u.segments));
    const total = ws + wr;
    const share = total ? Math.max(ws, wr) / total : 0;
    const opposition = buildOpposition(ws, wr, sup.length, ref.length);

    const dimensions = {
      quality: winUnits.length
        ? { avgWeight: Math.round(winAvgWeight * 100) / 100, label: winAvgWeight >= 2.5 ? '高' : winAvgWeight >= 1.8 ? '中' : '偏低' }
        : { avgWeight: 0, label: '无' },
      independence: { supportClusters: sup.length, refuteClusters: ref.length, conflictedClusters: conflicted.length, total: units.length },
      coverage,
      counterEvidence: {
        weight: wr, independentClusters: ref.length,
        label: wr === 0 ? '无反证' : wr >= 6 || ref.length >= 3 ? '强反证' : wr >= 3 || ref.length >= 2 ? '中等反证' : '弱反证',
      },
    };

    // —— 档位判定（逐档留痕）——
    const dir = ws > wr ? STANCE.SUPPORT : STANCE.REFUTE;
    let grade = GRADE.NONE;
    const ladder = [];
    const reasons = [];

    if (units.length === 0) {
      reasons.push('没有任何有效独立证据：有效材料为 0 条（被标记/撤回的材料不计入，见时间线）。');
    } else if (ws === wr || share < DECISIVE_SHARE) {
      grade = GRADE.INSUFFICIENT;
      reasons.push(ws === wr
        ? `支持与反驳权重持平（${ws}:${wr}），按规则判为证据不足。`
        : `占优方仅占双方权重 ${pct(share)}%，未达 ${pct(DECISIVE_SHARE)}% 的定论门槛，判为证据不足。`);
      if (ws !== wr) reasons.push(`双方差距仅 ${Math.abs(ws - wr)} 个权重点，差距过小，不予定论。`);
      if (conflicted.length) reasons.push(`存在 ${conflicted.length} 个同源组内立场矛盾（${conflicted.map((u) => u.clusterId).join('、')}），该组不计入任何一方，需补充裁决。`);
    } else {
      const dirText = dir === STANCE.SUPPORT ? '支持' : '反驳';
      const strongChecks = [
        { label: '独立来源 ≥ 3 个', pass: winUnits.length >= 3, detail: `实际 ${winUnits.length} 个独立来源组` },
        { label: '平均质量 ≥ 中', pass: winAvgWeight >= 2, detail: `平均质量权重 ${Math.round(winAvgWeight * 100) / 100}/3` },
        { label: `占方权重 ≥ ${pct(STRONG_SHARE)}%`, pass: share >= STRONG_SHARE, detail: `实际 ${pct(share)}%` },
        { label: '组内无立场矛盾', pass: conflicted.length === 0, detail: conflicted.length ? `存在 ${conflicted.length} 个矛盾来源组` : '无矛盾组' },
        { label: '人群覆盖达标（充分或未声明细分）', pass: coverage.level === 'sufficient' || coverage.level === 'undeclared',
          detail: `覆盖：${COVERAGE_TEXT[coverage.level]}` + (coverage.level === 'partial' ? '（封顶为“支持/反驳”档）' : coverage.level === 'insufficient' ? '（封顶为“弱支持/弱反驳”档）' : '') },
      ];
      const moderateChecks = [
        { label: '独立来源 ≥ 2 个', pass: winUnits.length >= 2, detail: `实际 ${winUnits.length} 个独立来源组` },
        { label: `占方权重 ≥ ${pct(DECISIVE_SHARE)}%`, pass: share >= DECISIVE_SHARE, detail: `实际 ${pct(share)}%` },
        { label: '人群覆盖不为“不足”', pass: coverage.level !== 'insufficient', detail: `覆盖：${COVERAGE_TEXT[coverage.level]}` },
      ];
      const strongPass = strongChecks.every((c) => c.pass);
      const moderatePass = moderateChecks.every((c) => c.pass);
      if (strongPass) grade = dir === STANCE.SUPPORT ? GRADE.STRONG_SUPPORT : GRADE.STRONG_REFUTE;
      else if (moderatePass) grade = dir === STANCE.SUPPORT ? GRADE.MODERATE_SUPPORT : GRADE.MODERATE_REFUTE;
      else grade = dir === STANCE.SUPPORT ? GRADE.WEAK_SUPPORT : GRADE.WEAK_REFUTE;

      ladder.push({
        grade: GRADE_LABEL[dir === STANCE.SUPPORT ? GRADE.STRONG_SUPPORT : GRADE.STRONG_REFUTE],
        passed: strongPass, checks: strongChecks,
        why: strongPass ? '全部硬条件满足，定为强档。' : '未满足：' + strongChecks.filter((c) => !c.pass).map((c) => c.label + '（' + c.detail + '）').join('；'),
      });
      ladder.push({
        grade: GRADE_LABEL[dir === STANCE.SUPPORT ? GRADE.MODERATE_SUPPORT : GRADE.MODERATE_REFUTE],
        passed: !strongPass && moderatePass, checks: moderateChecks,
        why: moderatePass ? (strongPass ? '已被强档覆盖。' : '强档条件不全，但中档条件满足，定为中档。')
          : '未满足：' + moderateChecks.filter((c) => !c.pass).map((c) => c.label + '（' + c.detail + '）').join('；'),
      });
      ladder.push({
        grade: GRADE_LABEL[dir === STANCE.SUPPORT ? GRADE.WEAK_SUPPORT : GRADE.WEAK_REFUTE],
        passed: !strongPass && !moderatePass, checks: [],
        why: strongPass ? '已被强档覆盖。'
          : moderatePass ? '已被中档覆盖。'
          : '强档、中档条件均未全部满足；虽达到定论门槛，仅能给弱档结论。',
      });

      reasons.push(`独立性：${sup.length} 个独立来源组支持、${ref.length} 组反驳${conflicted.length ? `、${conflicted.length} 组组内矛盾` : ''}（同来源重复引用与派生材料已合并）。`);
      reasons.push(`证据质量：占优方平均质量「${dimensions.quality.label}」（权重均值 ${Math.round(winAvgWeight * 100) / 100}/3）。`);
      reasons.push(coverage.level === 'undeclared'
        ? '人群覆盖：该假设未声明目标人群细分，覆盖维度未核验（建议先声明细分再下强结论）。'
        : `人群覆盖：声明 ${coverage.declared.length} 个细分，命中 ${coverage.observed.filter((s) => coverage.declared.includes(s)).length} 个（${pct(clamp01(coverage.ratio))}%，${COVERAGE_TEXT[coverage.level]}）`
          + (coverage.missing.length ? `，未覆盖：${coverage.missing.join('、')}` : '') + '。');
      reasons.push(opposition.note);
      if (conflicted.length) reasons.push(`存在 ${conflicted.length} 个同源组内立场矛盾（${conflicted.map((u) => u.clusterId).join('、')}），该组不计入任何一方，需补充裁决。`);
      if (coverage.extra.length) reasons.push(`观察到声明之外的人群标签：${coverage.extra.join('、')}，请确认目标人群定义是否需要更新。`);
    }

    return {
      hypothesisId: h.id,
      grade, gradeLabel: GRADE_LABEL[grade], score: GRADE_SCORE[grade],
      units, sourceUnits,
      weights: { support: ws, refute: wr, total, share: total ? Math.max(ws, wr) / total : 0 },
      opposition, dimensions, coverage, ladder, reasons,
      counts: { active: active.length, flagged: flagged.length, withdrawn: withdrawn.length, conflicted: conflicted.length },
    };
  }

  function computeAllWithModel(state, model) {
    const results = new Map();
    state.hypotheses.forEach((h) => results.set(h.id, computeHypothesis(state, h, model)));
    // 排名：分数降序，同分按假设标识升序打破平局
    const ranking = state.hypotheses
      .map((h) => ({ id: h.id, score: results.get(h.id).score }))
      .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((x, i) => ({ rank: i + 1, id: x.id, score: x.score }));
    ranking.forEach((r) => { results.get(r.id).rank = r.rank; });
    return results;
  }

  function computeAll(state) {
    return computeAllWithModel(state, buildSourceModel(state));
  }

  /* ============================== 增量重算 ============================== */

  /** 来源分组发生变化时，找出受影响来源（新旧模型中簇发生变化的所有来源） */
  function changedSources(before, after) {
    const changed = new Set();
    const all = new Set([].concat(before.sources, after.sources));
    all.forEach((s) => {
      const b = before.clusterOf.get(s) || s;
      const a = after.clusterOf.get(s) || s;
      if (a !== b) changed.add(s);
    });
    return changed;
  }
  function hypothesesTouchingSources(state, sources) {
    const set = new Set(sources);
    const out = new Set();
    state.evidence.forEach((e) => { if (set.has(e.sourceId)) out.add(e.hypothesisId); });
    return Array.from(out);
  }

  /**
   * 统一变更入口。mutator 在 action 内同步修改 state；返回增量重算结果并校验与全量重算一致。
   * action: {type, payload}
   */
  function act(store, type, payload) {
    payload = payload || {};
    const beforeModel = store.model;
    const dirty = new Set();
    const out = { ok: true, type, errors: [], notices: [], recomputed: [], parityOk: true, changes: [] };

    const markHypotheses = (ids) => ids.forEach((id) => { if (id) dirty.add(id); });
    const markSources = (ids) => hypothesesTouchingSources(store.state, ids).forEach((h) => dirty.add(h));

    if (type === 'ADD_HYPOTHESIS') {
      const { errors, value } = validateHypothesisInput(store.state, payload);
      if (errors.length) { out.ok = false; out.errors = errors; return finishNoChange(store, out); }
      const now = new Date().toISOString();
      store.state.hypotheses.push({
        id: value.id, statement: value.statement, population: value.population,
        segments: value.segments, status: '待验证', note: '', createdAt: now, updatedAt: now,
      });
      markHypotheses([value.id]);
      out.notices.push(`已登记假设 ${value.id}。`);
    } else if (type === 'UPDATE_HYPOTHESIS') {
      const h = store.state.hypotheses.find((x) => x.id === trim(payload.id));
      if (!h) { out.ok = false; out.errors = [{ field: 'id', code: 'H_NOT_FOUND', message: `假设「${payload.id}」不存在` }]; return finishNoChange(store, out); }
      const candidate = {
        id: h.id,
        statement: payload.statement != null ? payload.statement : h.statement,
        population: payload.population != null ? payload.population : h.population,
        segments: payload.segments != null
          ? (Array.isArray(payload.segments) ? payload.segments : String(payload.segments).split(/[,，、;；\n]/))
              .map(trim).filter(Boolean)
          : h.segments,
      };
      const v = validateHypothesisInput(
        { hypotheses: store.state.hypotheses.filter((x) => x.id !== h.id) },
        candidate,
      );
      if (v.errors.length) { out.ok = false; out.errors = v.errors; return finishNoChange(store, out); }
      h.statement = v.value.statement; h.population = v.value.population; h.segments = v.value.segments;
      if (payload.status != null) {
        if (!H_STATUS.includes(payload.status)) {
          out.ok = false; out.errors = [{ field: 'status', code: 'BAD_STATUS', message: `状态必须是：${H_STATUS.join(' / ')}` }];
          return finishNoChange(store, out);
        }
        h.status = payload.status;
      }
      if (payload.note != null) h.note = trim(payload.note);
      h.updatedAt = new Date().toISOString();
      markHypotheses([h.id]);
      out.notices.push(`已更新假设 ${h.id}，仅重算该假设。`);
    } else if (type === 'ADD_EVIDENCE' || type === 'ADD_EVIDENCE_BULK') {
      const rows = type === 'ADD_EVIDENCE_BULK' ? payload.rows : [payload];
      const startLine = payload.startLine || 1;
      const accepted = [];
      rows.forEach((row, i) => {
        const rowIndex = type === 'ADD_EVIDENCE_BULK' ? startLine + i : undefined;
        const v = validateEvidenceInput(store.state, row, rowIndex);
        if (v.errors.length) { out.ok = false; out.errors.push.apply(out.errors, v.errors); return; }
        const id = nextId('E', store.state.evidence.map((e) => e.id));
        const rec = {
          id,
          hypothesisId: v.value.hypothesisId,
          sourceId: v.value.sourceId,
          sourceLabel: v.value.sourceLabel,
          capturedAt: v.value.capturedAt,
          stance: v.value.stance,
          quality: v.value.quality,
          segment: v.value.segment,
          excerpt: v.value.excerpt,
          flagged: v.fieldIssues.length > 0,
          fieldIssues: v.fieldIssues,
          withdrawn: false,
          createdAt: new Date().toISOString(),
        };
        store.state.evidence.push(rec);
        accepted.push(rec);
        if (rec.flagged) {
          out.ok = false; // 有字段缺失 => 整体不算“干净通过”，但记录已留存并标记
          out.notices.push(`${id} 已登记但被标记为材料不完整，不计入证据：`
            + rec.fieldIssues.map((f) => `${f.field}=${f.reason}`).join('；')
            + (rowIndex != null ? `（第 ${rowIndex} 行）` : ''));
        }
      });
      if (!out.ok && !accepted.length) return finishNoChange(store, out);
      markHypotheses(uniq(accepted.map((r) => r.hypothesisId)));
    } else if (type === 'CORRECT_EVIDENCE') {
      const rec = store.state.evidence.find((e) => e.id === trim(payload.id));
      if (!rec) { out.ok = false; out.errors = [{ field: 'id', code: 'E_NOT_FOUND', message: `材料「${payload.id}」不存在` }]; return finishNoChange(store, out); }
      const oldH = rec.hypothesisId;
      const merged = {
        hypothesisId: payload.hypothesisId != null ? payload.hypothesisId : rec.hypothesisId,
        sourceId: payload.sourceId != null ? payload.sourceId : rec.sourceId,
        sourceLabel: payload.sourceLabel != null ? payload.sourceLabel : rec.sourceLabel,
        capturedAt: payload.capturedAt != null ? payload.capturedAt : rec.capturedAt,
        stance: payload.stance != null ? payload.stance : rec.stance,
        quality: payload.quality != null ? payload.quality : rec.quality,
        segment: payload.segment != null ? payload.segment : rec.segment,
        excerpt: payload.excerpt != null ? payload.excerpt : rec.excerpt,
      };
      const v = validateEvidenceInput(store.state, merged);
      if (v.errors.length) { out.ok = false; out.errors = v.errors; return finishNoChange(store, out); }
      Object.assign(rec, v.value, { flagged: v.fieldIssues.length > 0, fieldIssues: v.fieldIssues });
      markHypotheses(uniq([oldH, rec.hypothesisId]));
      out.notices.push(`已更正材料 ${rec.id}${rec.flagged ? '，但仍有字段被标记：' + rec.fieldIssues.map((f) => f.reason).join('；') : '，标记已解除'}`);
    } else if (type === 'WITHDRAW_EVIDENCE' || type === 'RESTORE_EVIDENCE') {
      const rec = store.state.evidence.find((e) => e.id === trim(payload.id));
      if (!rec) { out.ok = false; out.errors = [{ field: 'id', code: 'E_NOT_FOUND', message: `材料「${payload.id}」不存在` }]; return finishNoChange(store, out); }
      rec.withdrawn = type === 'WITHDRAW_EVIDENCE';
      rec.withdrawReason = type === 'WITHDRAW_EVIDENCE' ? trim(payload.reason) : '';
      markHypotheses([rec.hypothesisId]);
      out.notices.push(type === 'WITHDRAW_EVIDENCE' ? `已撤回材料 ${rec.id}，从证据合成中剔除（时间线保留）。` : `已恢复材料 ${rec.id}。`);
    } else if (type === 'ADD_RELATION') {
      const from = trim(payload.from), to = trim(payload.to), kind = payload.kind === 'derived' ? 'derived' : 'same';
      if (!from || !to) { out.ok = false; out.errors = [{ field: 'relation', code: 'SRC_EMPTY', message: '来源关系双方都必须填写' }]; return finishNoChange(store, out); }
      if (from === to) { out.ok = false; out.errors = [{ field: 'relation', code: 'SELF_LOOP', message: `来源「${from}」不能与自身声明${kind === 'same' ? '同源' : '派生'}关系（自环）` }]; return finishNoChange(store, out); }
      const dup = store.state.relations.find((r) => r.kind === kind && r.from === from && r.to === to);
      if (dup) { out.ok = false; out.errors = [{ field: 'relation', code: 'REL_DUPLICATE', message: '该来源关系已存在（重复声明）' }]; return finishNoChange(store, out); }

      if (kind === 'same') {
        const path = sameSourcePath(store.state, from, to);
        if (path) {
          out.ok = false;
          out.errors.push({ field: 'relation', code: 'SAME_CYCLE', message: `拒绝同源声明：${from} 与 ${to} 已在同一同源组中，现存路径 ${path.join(' = ')}，再加一条就成环。` });
          return finishNoChange(store, out);
        }
      } else {
        const cf = beforeModel.classOf.get(from) || from;
        const ct = beforeModel.classOf.get(to) || to;
        if (cf === ct) {
          out.ok = false;
          out.errors.push({ field: 'relation', code: 'DERIVE_FROM_SAME', message: `拒绝派生声明：${from} 与 ${to} 已属同一同源组（${cf}），同源来源之间不能再声明派生。` });
          return finishNoChange(store, out);
        }
        const cyc = derivedClassPath(beforeModel, ct, cf);
        if (cyc) {
          const pretty = cyc.map((c) => c).join(' → ');
          out.ok = false;
          out.errors.push({ field: 'relation', code: 'DERIVE_CYCLE', message: `拒绝派生声明：会形成有向环。现存派生路径 ${pretty} → ${cf}（即 ${from} 的等价类已派生自 ${to} 的等价类）。` });
          return finishNoChange(store, out);
        }
      }

      store.state.relations.push({ id: nextId('R', store.state.relations.map((r) => r.id)), from, to, kind, createdAt: new Date().toISOString() });
      const afterModel = buildSourceModel(store.state);
      // 同源合并可能让旧派生边变成类内自环 → 作废并告知
      const pruned = [];
      store.state.relations = store.state.relations.filter((r) => {
        if (r.kind !== 'derived') return true;
        const keep = (afterModel.classOf.get(r.from) || r.from) !== (afterModel.classOf.get(r.to) || r.to);
        if (!keep) pruned.push(r);
        return keep;
      });
      const finalModel = pruned.length ? buildSourceModel(store.state) : afterModel;
      markSources(Array.from(changedSources(beforeModel, finalModel)));
      markSources([from, to]);
      out._model = finalModel;
      out.notices.push(kind === 'same' ? `已声明 ${from} 与 ${to} 同源，独立性合并为同一来源组。` : `已声明 ${to} 的内容派生自 ${from}（${from} → ${to}），二者不再分别计为独立证据。`);
      pruned.forEach((r) => out.notices.push(`因同源合并，派生关系 ${r.from} → ${r.to} 已自动作废（双方已成同一来源）。`));
    } else if (type === 'REMOVE_RELATION') {
      const idx = store.state.relations.findIndex((r) => r.id === trim(payload.id));
      if (idx < 0) { out.ok = false; out.errors = [{ field: 'relation', code: 'REL_NOT_FOUND', message: `关系「${payload.id}」不存在` }]; return finishNoChange(store, out); }
      const [removed] = store.state.relations.splice(idx, 1);
      const afterModel = buildSourceModel(store.state);
      markSources(Array.from(changedSources(beforeModel, afterModel)));
      markSources([removed.from, removed.to]);
      out._model = afterModel;
      out.notices.push(`已移除来源关系 ${removed.from} ${removed.kind === 'same' ? '=' : '→'} ${removed.to}。`);
    } else {
      out.ok = false; out.errors = [{ field: 'type', code: 'UNKNOWN_ACTION', message: `未知操作：${type}` }];
      return finishNoChange(store, out);
    }

    // —— 增量重算 ——
    const afterModel = out._model || buildSourceModel(store.state);
    const beforeGrades = new Map();
    dirty.forEach((id) => { if (store.results.has(id)) beforeGrades.set(id, store.results.get(id).gradeLabel); });

    const newResults = new Map(store.results);
    dirty.forEach((id) => {
      const h = store.state.hypotheses.find((x) => x.id === id);
      if (h) newResults.set(id, computeHypothesis(store.state, h, afterModel));
    });
    // 新假设/受影响假设需要排名：用全量排名结果回填 rank（同分按标识序）
    const rankedMap = computeAllWithModel(store.state, afterModel);
    rankedMap.forEach((res, id) => {
      if (newResults.has(id)) newResults.get(id).rank = res.rank;
    });

    // —— 全量重算 parity 校验 ——
    const full = computeAllWithModel(store.state, afterModel);
    let parityOk = true;
    store.state.hypotheses.forEach((h) => {
      const a = newResults.get(h.id);
      const b = full.get(h.id);
      if (JSON.stringify(a) !== JSON.stringify(b)) parityOk = false;
    });
    out.parityOk = parityOk;

    // 未受影响结论必须保持同一对象引用
    store.state.hypotheses.forEach((h) => {
      if (!dirty.has(h.id) && store.results.get(h.id) !== newResults.get(h.id)) {
        parityOk = false; out.parityOk = false;
      }
    });

    store.model = afterModel;
    store.results = newResults;
    out.recomputed = sorted(Array.from(dirty));
    out.changes = out.recomputed.map((id) => ({
      id,
      before: beforeGrades.has(id) ? beforeGrades.get(id) : null,
      after: newResults.get(id).gradeLabel,
    }));
    out.allResults = full; // 供测试/调试
    return out;
  }

  function finishNoChange(store, out) {
    out.recomputed = [];
    out.parityOk = true;
    out.allResults = store.results;
    return out;
  }

  /* ============================== 批量文本解析 ============================== */

  /**
   * 每行：来源标识 | 采集时刻 | 立场 | 人群标签(可空) | 质量(可空) | 摘录
   * 也支持制表符分隔。返回 {rows, parseErrors:[{line,message}]}
   */
  function parseEvidenceText(text, defaults) {
    const rows = []; const parseErrors = [];
    const lines = String(text || '').split(/\r?\n/);
    lines.forEach((raw, i) => {
      const line = i + 1;
      if (!trim(raw)) return;
      const parts = raw.indexOf('\t') >= 0 ? raw.split('\t') : raw.split('|');
      if (parts.length < 3) {
        parseErrors.push({ line, message: `第 ${line} 行字段不足：至少需要“来源 | 时刻 | 立场”，已跳过。` });
        return;
      }
      const [sourceId, capturedAt, stance, segment, quality, excerpt, sourceLabel] = parts.map(trim);
      rows.push({
        hypothesisId: defaults.hypothesisId,
        sourceId, capturedAt, stance,
        segment: segment || '', quality: quality || 'medium',
        excerpt: excerpt || '', sourceLabel: sourceLabel || '',
        _line: line,
      });
    });
    return { rows, parseErrors };
  }

  /* ============================== 演示数据 ============================== */

  function demoState() {
    const state = createState();
    const t = (d, hm) => `2026-09-${String(d).padStart(2, '0')}T${hm}`;
    state.hypotheses = [
      {
        id: 'H1', status: '验证中',
        statement: '社区团购用户愿意为次日达净菜支付约 10% 的溢价。',
        population: '一线城市、每月社区团购 4 次以上的家庭买菜决策者',
        segments: ['年轻妈妈', '银发买菜者', '双职工家庭'],
        note: '', createdAt: t(1, '09:00'), updatedAt: t(1, '09:00'),
      },
      {
        id: 'H2', status: '验证中',
        statement: '用户愿意把账户充值上限从 500 元提高到 2000 元。',
        population: '近 90 天有过充值行为的注册用户',
        segments: ['90后', '80后', '00后'],
        note: '', createdAt: t(1, '09:10'), updatedAt: t(1, '09:10'),
      },
      {
        id: 'H3', status: '待验证',
        statement: '客服 IM 图文会话比电话更能降低升级投诉率。',
        population: '近 30 天联系过客服的用户',
        segments: [],
        note: '', createdAt: t(1, '09:20'), updatedAt: t(1, '09:20'),
      },
    ];
    let n = 0;
    const E = (o) => {
      n += 1;
      return Object.assign({
        id: padId('E', n), flagged: false, fieldIssues: [], withdrawn: false,
        sourceLabel: '', quality: 'medium', segment: '', excerpt: '',
        createdAt: t(10, '12:00'),
      }, o);
    };
    state.evidence = [
      // H1：3 个独立来源组；U001 被引用两次（只算一条）；N001 派生自 U003；N002 与 U002 同源；另有 1 条低质量反证
      E({ hypothesisId: 'H1', sourceId: 'U001', sourceLabel: '王女士(年轻妈妈)', capturedAt: t(2, '10:15'), stance: 'support', quality: 'high', segment: '年轻妈妈', excerpt: '“贵一块钱以内我都买，省得去菜场。”' }),
      E({ hypothesisId: 'H1', sourceId: 'U001', sourceLabel: '王女士(年轻妈妈)', capturedAt: t(3, '15:40'), stance: 'support', quality: 'medium', segment: '年轻妈妈', excerpt: '回访中再次表达愿意加价（同一人，不得重复计数）。' }),
      E({ hypothesisId: 'H1', sourceId: 'U002', sourceLabel: '李阿姨(银发)', capturedAt: t(4, '08:50'), stance: 'support', quality: 'medium', segment: '银发买菜者', excerpt: '“儿女下单我提货，多花点也值。”' }),
      E({ hypothesisId: 'H1', sourceId: 'N002', sourceLabel: '居委会访谈纪要-李阿姨段', capturedAt: t(5, '11:00'), stance: 'support', quality: 'medium', segment: '银发买菜者', excerpt: '纪要中同一人的发言，与 U002 同源。' }),
      E({ hypothesisId: 'H1', sourceId: 'U003', sourceLabel: '陈先生(双职工)', capturedAt: t(6, '20:05'), stance: 'support', quality: 'medium', segment: '双职工家庭', excerpt: '“下班没空挑菜，净菜加价合理。”' }),
      E({ hypothesisId: 'H1', sourceId: 'N001', sourceLabel: 'U003 访谈逐字稿摘要', capturedAt: t(7, '10:00'), stance: 'support', quality: 'high', segment: '双职工家庭', excerpt: '逐字稿整理稿，内容派生自 U003，非独立观察。' }),
      E({ hypothesisId: 'H1', sourceId: 'U004', sourceLabel: '赵女士(价格敏感)', capturedAt: t(8, '09:30'), stance: 'refute', quality: 'low', segment: '年轻妈妈', excerpt: '“涨一毛我都去拼夕夕。”' }),
      // H2：正反 5:5 持平 → 证据不足
      E({ hypothesisId: 'H2', sourceId: 'U010', sourceLabel: '小刘(90后)', capturedAt: t(3, '13:00'), stance: 'support', quality: 'high', segment: '90后', excerpt: '“2000 也行，反正要花。”' }),
      E({ hypothesisId: 'H2', sourceId: 'U011', sourceLabel: '老周(80后)', capturedAt: t(4, '19:00'), stance: 'support', quality: 'medium', segment: '80后', excerpt: '“可以提高，但别默认开通。”' }),
      E({ hypothesisId: 'H2', sourceId: 'U012', sourceLabel: '小孙(90后)', capturedAt: t(5, '13:30'), stance: 'refute', quality: 'high', segment: '90后', excerpt: '“充值上限越高，盗号风险越大，反对。”' }),
      E({ hypothesisId: 'H2', sourceId: 'U013', sourceLabel: '吴姐(80后)', capturedAt: t(6, '18:10'), stance: 'refute', quality: 'medium', segment: '80后', excerpt: '“500 够了，钱放里面不放心。”' }),
      // H3：仅一条有效证据 → 弱支持；另有一条缺时刻的材料被标记
      E({ hypothesisId: 'H3', sourceId: 'U020', sourceLabel: '客服值班长', capturedAt: t(9, '10:00'), stance: 'support', quality: 'medium', excerpt: '试点周升级投诉从 12 件降到 7 件。' }),
      E({ hypothesisId: 'H3', sourceId: '', sourceLabel: '匿名工单截图', capturedAt: '', stance: '', quality: 'low', excerpt: '缺来源、时刻、立场——必须被标记，不得默认通过。' }),
    ];
    state.relations = [
      { id: 'R001', from: 'U003', to: 'N001', kind: 'derived', createdAt: t(7, '10:05') },
      { id: 'R002', from: 'N002', to: 'U002', kind: 'same', createdAt: t(5, '11:10') },
    ];
    return state;
  }

  return {
    STANCE, STANCE_LABEL, QUALITY, QUALITY_WEIGHT, QUALITY_LABEL,
    GRADE, GRADE_LABEL, GRADE_SCORE, H_STATUS,
    STRONG_SHARE, DECISIVE_SHARE,
    createState, createStore, buildSourceModel,
    computeAll, computeHypothesis, computeAllWithModel,
    validateHypothesisInput, validateEvidenceInput, validateCapturedAt, normalizeStance,
    changedSources, hypothesesTouchingSources,
    act, parseEvidenceText, demoState,
    sameSourcePath, derivedClassPath,
    nextId,
  };
});
