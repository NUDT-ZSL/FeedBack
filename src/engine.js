/*
 * FormStepLoad —— 表单分步认知负担推演引擎（纯函数，无 DOM 依赖）
 * 每次推演都从完整表单结构整体重推，不做增量假设。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CONFIG = { stepCount: 4, readThreshold: 15, requiredThreshold: 4 };

  // 依赖边携带的填写要求（source 字段对 target 前置字段提出的要求）
  const KIND_LABELS = {
    required: '必填',
    optional: '选填',
    readOnly: '只读带出',
    hidden: '隐藏不填',
    skipIfFilled: '有值则跳过'
  };
  const KINDS = Object.keys(KIND_LABELS);

  // 同一字段被多条依赖指向时，互不相容的要求对（无序）
  const CONFLICT_PAIR_LIST = [
    ['required', 'optional'],
    ['required', 'readOnly'],
    ['required', 'hidden'],
    ['optional', 'readOnly'],
    ['optional', 'hidden'],
    ['readOnly', 'hidden'],
    ['skipIfFilled', 'readOnly'],
    ['skipIfFilled', 'hidden']
  ];
  function pairKey(a, b) { return [a, b].sort().join('|'); }
  const CONFLICT_PAIRS = new Set(CONFLICT_PAIR_LIST.map(p => pairKey(p[0], p[1])));

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function analyze(form) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, form.config || {});
    const fields = (form.fields || []).map(f => Object.assign(
      { label: f.id, step: 0, readWeight: 1, required: false, locked: false, excluded: false }, f));
    const deps = (form.dependencies || []).filter(d => d && d.source && d.target && d.requirement);
    const byId = new Map(fields.map(f => [f.id, f]));
    const stepCount = cfg.stepCount;

    const incoming = new Map(fields.map(f => [f.id, []]));
    const outgoing = new Map(fields.map(f => [f.id, []]));
    deps.forEach(e => {
      // 边 source -> target：source 依赖前置 target，并携带对 target 的填写要求
      if (byId.has(e.target)) incoming.get(e.target).push(e);
      if (byId.has(e.source)) outgoing.get(e.source).push(e);
    });
    const active = f => f && !f.excluded;

    const reports = new Map(fields.map(f => [f.id, {
      id: f.id, blocked: false, reasons: [], conflicts: [], unmet: [],
      incoming: incoming.get(f.id), outgoing: outgoing.get(f.id)
    }]));

    // 1) 同一字段被多条依赖指向（成为多个字段的前置）且要求冲突：保留全部依据
    for (const f of fields) {
      if (!active(f)) continue;
      const groups = {};
      incoming.get(f.id)
        .filter(e => active(byId.get(e.source)))
        .forEach(e => { (groups[e.requirement] = groups[e.requirement] || []).push(e); });
      const kinds = Object.keys(groups);
      for (let i = 0; i < kinds.length; i++) {
        for (let j = i + 1; j < kinds.length; j++) {
          if (CONFLICT_PAIRS.has(pairKey(kinds[i], kinds[j]))) {
            reports.get(f.id).conflicts.push({
              kinds: [kinds[i], kinds[j]],
              text: '字段「' + (f.label || f.id) + '」被多条依赖提出冲突要求：' +
                KIND_LABELS[kinds[i]] + ' 与 ' + KIND_LABELS[kinds[j]],
              evidence: groups[kinds[i]].concat(groups[kinds[j]])
            });
          }
        }
      }
    }

    // 2) 直接阻断：前置被排除、前置位于更靠后步骤
    const blocked = new Map();
    function addReason(id, r) {
      if (!blocked.has(id)) blocked.set(id, []);
      const arr = blocked.get(id);
      if (!arr.some(x => x.code === r.code && x.depId === r.depId && x.targetId === r.targetId)) arr.push(r);
    }
    for (const f of fields) {
      if (!active(f)) continue;
      for (const e of outgoing.get(f.id)) {
        const t = byId.get(e.target);
        if (!t) continue;
        if (!active(t)) {
          addReason(f.id, { code: 'excluded', depId: e.id, targetId: t.id,
            text: '依赖的「' + (t.label || t.id) + '」已被排除出表单，无法取得该值' });
        } else if (t.step > f.step) {
          addReason(f.id, { code: 'future', depId: e.id, targetId: t.id, targetStep: t.step,
            text: '依赖的「' + (t.label || t.id) + '」被排在更靠后的步骤 ' + (t.step + 1) +
              '，该步骤不可完成' });
        }
      }
    }

    // 3) 循环依赖：环上每个字段都不可完成
    const activeIds = fields.filter(active).map(f => f.id);
    cycleNodes(activeIds, outgoing, byId).forEach(id =>
      addReason(id, { code: 'cycle', text: '与其他字段构成循环依赖，步骤先后无法成立' }));

    // 4) 传递阻断：前置不可完成 => 本字段连带不可完成（沿依赖闭包反复推到不动点）
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of fields) {
        if (!active(f) || blocked.has(f.id)) continue;
        for (const e of outgoing.get(f.id)) {
          const t = byId.get(e.target);
          if (t && active(t) && blocked.has(t.id)) {
            const root = blocked.get(t.id)[0];
            addReason(f.id, { code: 'upstream', depId: e.id, targetId: t.id,
              rootCode: root.code,
              text: '依赖的「' + (t.label || t.id) + '」本身不可完成（' + root.text +
                '），本字段沿依赖链连带不可完成' });
            grew = true;
            break;
          }
        }
      }
    }
    function prereqOf(f) {
      return outgoing.get(f.id).map(e => {
        const t = byId.get(e.target);
        let status;
        if (!t) status = 'missing';
        else if (!active(t)) status = 'excluded';
        else if (t.step > f.step) status = 'future';
        else if (t.step === f.step) status = 'same';
        else status = 'prior';
        const targetBlocked = t ? blocked.has(t.id) : false;
        return { edge: e, target: t, status: status,
          satisfied: (status === 'prior' || status === 'same') && !targetBlocked };
      });
    }

    // 5) 逐步聚合：阅读量（本步 + 需回忆的更早步骤前置）、必填压力、未满足项
    const steps = [];
    for (let i = 0; i < stepCount; i++) {
      const sf = fields.filter(f => active(f) && f.step === i);
      let localRead = 0, requiredCount = 0, requiredWeight = 0, unmetItems = 0;
      let conflictCount = 0;
      const recall = new Set();
      const blockReasons = [];
      for (const f of sf) {
        const rep = reports.get(f.id);
        localRead += f.readWeight || 0;
        const edgeRequired = rep.outgoing.some(e =>
          e.requirement === 'required' && active(byId.get(e.target)));
        if (f.required || edgeRequired) { requiredCount++; requiredWeight += f.readWeight || 0; }
        if (rep.conflicts.length) conflictCount++;
        for (const e of rep.outgoing) { // 本步字段依赖的前置若在更早步骤 => 需回忆
          const t = byId.get(e.target);
          if (t && active(t) && t.step < i) recall.add(t.id);
        }
        const items = prereqOf(f);
        rep.unmet = items.filter(it => !it.satisfied);
        unmetItems += rep.unmet.length;
        if (blocked.has(f.id)) blockReasons.push({ fieldId: f.id, reasons: blocked.get(f.id) });
      }
      const recallRead = Array.from(recall).reduce((s, id) => s + (byId.get(id).readWeight || 0), 0);
      steps.push({
        index: i,
        name: (form.stepNames && form.stepNames[i]) || ('步骤 ' + (i + 1)),
        fieldIds: sf.map(f => f.id),
        localRead: localRead,
        recallRead: recallRead,
        totalRead: localRead + recallRead,
        requiredCount: requiredCount,
        requiredWeight: requiredWeight,
        unmetCount: unmetItems,
        blockedFieldCount: blockReasons.length,
        conflictCount: conflictCount,
        blocked: blockReasons.length > 0,
        blockReasons: blockReasons,
        highRead: localRead + recallRead >= cfg.readThreshold,
        highRequired: requiredCount >= cfg.requiredThreshold
      });
    }

    // 回填字段级报告
    for (const f of fields) {
      const rep = reports.get(f.id);
      rep.blocked = blocked.has(f.id) || false;
      rep.reasons = blocked.get(f.id) || [];
      if (!rep.unmet) rep.unmet = active(f) ? prereqOf(f).filter(it => !it.satisfied) : [];
    }

    const conflictFieldIds = fields
      .filter(f => active(f) && reports.get(f.id).conflicts.length).map(f => f.id);
    const blockedFieldIds = fields
      .filter(f => active(f) && blocked.has(f.id)).map(f => f.id);

    return {
      config: cfg,
      steps: steps,
      fieldReports: reports,
      conflictFields: conflictFieldIds,
      blockedFields: blockedFieldIds,
      summary: {
        stepCount: stepCount,
        activeFieldCount: fields.filter(active).length,
        excludedCount: fields.filter(f => !active(f)).length,
        blockedFieldCount: blockedFieldIds.length,
        conflictFieldCount: conflictFieldIds.length,
        blockedSteps: steps.filter(s => s.blocked).map(s => s.index),
        maxTotalRead: steps.reduce((m, s) => Math.max(m, s.totalRead), 0)
      }
    };
  }
  // 依据约束 source.step >= target.step 整体重推收敛：
  //   1) 锁定锚传播硬区间 [LB,UB]：锁定字段 LB=UB=其步骤；排除字段不参与；
  //   2) 未锁定字段夹取到区间内（早锁定字段的前置会被拉前）；
  //   3) 单调前移：把依赖方反复前移到其最晚前置所在步骤，直到不动点（终止且幂等）；
  //   4) 锁定字段与前置冲突、或前移越过硬上界 => infeasible，阻断由 analyze 标出。
  function converge(form) {
    const next = clone(form);
    const cfg = Object.assign({}, DEFAULT_CONFIG, next.config || {});
    const fields = next.fields || [];
    const n = cfg.stepCount;
    const byId = new Map(fields.map(f => [f.id, f]));
    const deps = (next.dependencies || []).filter(d => d && d.source && d.target &&
      byId.has(d.source) && byId.has(d.target));
    const active = f => f && !f.excluded;

    const lb = new Map(), ub = new Map();
    fields.forEach(f => {
      if (f.locked) { lb.set(f.id, f.step); ub.set(f.id, f.step); }
      else { lb.set(f.id, 0); ub.set(f.id, n - 1); }
    });
    // 锁定锚传播到不动点（s=source, t=target，约束 s.step >= t.step）：
    //   LB[s] = max(LB[s], LB[t])；UB[t] = min(UB[t], UB[s])；锁定字段的区间恒定不动
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of deps) {
        const s = byId.get(e.source), t = byId.get(e.target);
        if (!active(s) || !active(t)) continue;
        if (!s.locked && lb.get(s.id) < lb.get(t.id)) { lb.set(s.id, lb.get(t.id)); changed = true; }
        if (!t.locked && ub.get(t.id) > ub.get(s.id)) { ub.set(t.id, ub.get(s.id)); changed = true; }
      }
    }
    // 锁定字段若被传播推成空区间，直接标记其锁定-前置冲突（锁定位置保留）
    const infeasible = [];
    const seenInfeasible = new Set();
    function flagEdge(e, why) {
      if (seenInfeasible.has(e.id)) return;
      seenInfeasible.add(e.id);
      const s = byId.get(e.source), t = byId.get(e.target);
      infeasible.push({ edge: e, depId: e.id,
        text: why + '：「' + (s.label || s.id) + '」在步骤 ' + (s.step + 1) +
          '，但依赖的「' + (t.label || t.id) + '」在更靠后的步骤 ' + (t.step + 1) });
    }
    deps.forEach(e => {
      const s = byId.get(e.source), t = byId.get(e.target);
      if (!active(s) || !active(t) || s.step >= t.step) return;
      if (s.locked || t.locked) {
        flagEdge(e, s.locked ? '锁定冲突' : '前置锁定冲突');
      }
    });
    // 未锁定字段夹取到硬区间（不移动已标记冲突涉及的锁定字段）
    fields.forEach(fld => {
      if (active(fld) && !fld.locked && lb.get(fld.id) <= ub.get(fld.id)) {
        fld.step = Math.max(lb.get(fld.id), Math.min(ub.get(fld.id), fld.step));
      }
    });
    // 单调前移到不动点
    let moved = true;
    while (moved) {
      moved = false;
      for (const f of fields) {
        if (!active(f)) continue;
        let need = f.step;
        for (const e of deps) {
          if (e.source !== f.id) continue;
          const t = byId.get(e.target);
          if (!active(t)) continue;
          if (t.step > f.step) {
            if (f.locked || t.step > ub.get(f.id)) {
              if (!seenInfeasible.has(e.id)) {
                seenInfeasible.add(e.id);
                infeasible.push({ edge: e, depId: e.id,
                  text: (f.locked ? '锁定冲突：「' + (f.label || f.id) + '」锁定在步骤 ' + (f.step + 1) :
                    '收敛越界：「' + (f.label || f.id) + '」的归属无法容纳其前置') +
                    '，但依赖的「' + (t.label || t.id) + '」在更靠后的步骤 ' + (t.step + 1) });
              }
            } else need = Math.max(need, t.step);
          }
        }
        if (!f.locked && need > f.step) { f.step = need; moved = true; }
      }
    }
    return { form: next, infeasible: infeasible };
  }

  // Tarjan 强连通分量：返回所有处于环上的字段 id（含自环）
  function cycleNodes(ids, outgoing, byId) {
    let index = 0;
    const idx = new Map(), low = new Map(), stack = [], onStack = new Set(), result = new Set();
    const idSet = new Set(ids);
    function strongConnect(v) {
      idx.set(v, index); low.set(v, index); index++;
      stack.push(v); onStack.add(v);
      for (const e of outgoing.get(v) || []) {
        const w = byId.has(e.target) ? e.target : null;
        if (!w || !idSet.has(w)) continue;
        if (!idx.has(w)) { strongConnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      }
      if (low.get(v) === idx.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) comp.forEach(x => result.add(x));
        else {
          const self = (outgoing.get(v) || []).some(e => e.target === v);
          if (self) result.add(v);
        }
      }
    }
    ids.forEach(id => { if (!idx.has(id)) strongConnect(id); });
    return result;
  }
  return {
    analyze: analyze,
    converge: converge,
    cycleNodes: cycleNodes,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    KIND_LABELS: KIND_LABELS,
    KINDS: KINDS,
    CONFLICT_PAIRS: CONFLICT_PAIRS,
    pairKey: pairKey
  };
});
