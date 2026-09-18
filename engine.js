/*
 * 申报引导引擎（纯逻辑，无 DOM 依赖，浏览器与 Node 均可运行）
 *
 * 流程定义结构：
 * {
 *   id, title,
 *   steps: [{ id, title, phase, skippable, condition? }],
 *   questions: [{ id, step, text, type, required, options?, dependsOn? }]
 * }
 *
 * 条件表达式（步骤 condition 与问题 dependsOn 元素通用）：
 *   { question, op, value }           op: equals|notEquals|in|notIn|answered|notAnswered|truthy|falsy|gt|gte|lt|lte
 *   { all: [cond...] } { any: [cond...] } { not: cond }
 */
const FlowEngine = (() => {
  'use strict';

  /* ---------------- 条件工具 ---------------- */

  // 收集条件表达式中引用的全部问题标识
  function conditionRefs(cond, out) {
    out = out || [];
    if (!cond || typeof cond !== 'object') return out;
    if (cond.question) out.push(cond.question);
    if (Array.isArray(cond.all)) cond.all.forEach((c) => conditionRefs(c, out));
    if (Array.isArray(cond.any)) cond.any.forEach((c) => conditionRefs(c, out));
    if (cond.not) conditionRefs(cond.not, out);
    return out;
  }

  function evalCondition(cond, getValue) {
    if (!cond) return true;
    if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, getValue));
    if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, getValue));
    if (cond.not) return !evalCondition(cond.not, getValue);
    const v = getValue(cond.question);
    switch (cond.op) {
      case 'equals': return v !== undefined && v === cond.value;
      case 'notEquals': return v !== undefined && v !== cond.value;
      case 'in': return Array.isArray(cond.value) && v !== undefined && cond.value.indexOf(v) !== -1;
      case 'notIn': return Array.isArray(cond.value) && v !== undefined && cond.value.indexOf(v) === -1;
      case 'answered': return v !== undefined && v !== '';
      case 'notAnswered': return v === undefined || v === '';
      case 'truthy': return !!v;
      case 'falsy': return v !== undefined && !v;
      case 'gt': return typeof v === 'number' && v > cond.value;
      case 'gte': return typeof v === 'number' && v >= cond.value;
      case 'lt': return typeof v === 'number' && v < cond.value;
      case 'lte': return typeof v === 'number' && v <= cond.value;
      default: return false;
    }
  }

  // 人类可读的条件描述，用于“依据”说明
  function describeCondition(cond, label) {
    label = label || ((qid) => qid);
    if (!cond) return '无条件';
    if (Array.isArray(cond.all)) return '同时满足（' + cond.all.map((c) => describeCondition(c, label)).join('；') + '）';
    if (Array.isArray(cond.any)) return '满足其一（' + cond.any.map((c) => describeCondition(c, label)).join('；') + '）';
    if (cond.not) return '不满足（' + describeCondition(cond.not, label) + '）';
    const name = label(cond.question);
    const val = JSON.stringify(cond.value);
    switch (cond.op) {
      case 'equals': return `${name} = ${val}`;
      case 'notEquals': return `${name} ≠ ${val}`;
      case 'in': return `${name} ∈ ${val}`;
      case 'notIn': return `${name} ∉ ${val}`;
      case 'answered': return `${name} 已填写`;
      case 'notAnswered': return `${name} 未填写`;
      case 'truthy': return `${name} 为“是”`;
      case 'falsy': return `${name} 为“否”`;
      case 'gt': return `${name} > ${val}`;
      case 'gte': return `${name} ≥ ${val}`;
      case 'lt': return `${name} < ${val}`;
      case 'lte': return `${name} ≤ ${val}`;
      default: return `${name} ? ${val}`;
    }
  }

  /* ---------------- 流程定义校验（需求 1、2） ---------------- */

  function validateFlow(def) {
    const errors = [];
    const err = (path, message, chain) => errors.push({ path, message, chain: chain || null });

    if (!def || typeof def !== 'object') {
      err('(root)', '流程定义必须是对象');
      return { ok: false, errors };
    }
    if (!Array.isArray(def.steps) || def.steps.length === 0) err('steps', '流程必须至少包含一个步骤');
    if (!Array.isArray(def.questions) || def.questions.length === 0) err('questions', '流程必须至少包含一个问题');
    if (errors.length) return { ok: false, errors };

    // 步骤标识唯一性
    const stepMap = new Map();
    def.steps.forEach((s, i) => {
      const path = `steps[${i}]`;
      if (!s || typeof s.id !== 'string' || !s.id) { err(`${path}.id`, '步骤缺少唯一标识 id'); return; }
      if (stepMap.has(s.id)) {
        err(`${path}.id`, `步骤标识 "${s.id}" 重复（首次出现于 ${stepMap.get(s.id)}）`);
      } else {
        stepMap.set(s.id, path);
      }
    });

    // 问题标识唯一性 + 所属步骤引用
    const qMap = new Map();
    def.questions.forEach((q, i) => {
      const path = `questions[${i}]`;
      if (!q || typeof q.id !== 'string' || !q.id) { err(`${path}.id`, '问题缺少唯一标识 id'); return; }
      if (qMap.has(q.id)) {
        err(`${path}.id`, `问题标识 "${q.id}" 重复（首次出现于 ${qMap.get(q.id)}）`);
      } else {
        qMap.set(q.id, path);
      }
      if (!q.step || !stepMap.has(q.step)) {
        err(`${path}.step`, `问题 "${q.id}" 引用了不存在的步骤 "${q.step == null ? '' : q.step}"`);
      }
    });

    // 依赖与条件引用必须已登记
    def.questions.forEach((q, i) => {
      if (!q || !q.id) return;
      (q.dependsOn || []).forEach((cond, j) => {
        conditionRefs(cond).forEach((ref) => {
          if (!qMap.has(ref)) {
            err(`questions[${i}].dependsOn[${j}]`, `问题 "${q.id}" 的依赖引用了未登记的问题 "${ref}"`);
          }
        });
      });
    });
    def.steps.forEach((s, i) => {
      if (!s || !s.id || !s.condition) return;
      conditionRefs(s.condition).forEach((ref) => {
        if (!qMap.has(ref)) {
          err(`steps[${i}].condition`, `步骤 "${s.id}" 的成立条件引用了未登记的问题 "${ref}"`);
        }
      });
    });

    // 依赖图（问题→其依赖的问题；步骤→其条件引用的问题；问题→所属步骤），检测环并给出链条
    // 仅当引用完整时才做环检测，避免悬空引用干扰
    if (errors.length === 0) {
      const nodes = new Map(); // key -> {label, deps:[key]}
      def.steps.forEach((s) => nodes.set('s:' + s.id, {
        label: `步骤「${s.title || s.id}」`,
        deps: conditionRefs(s.condition).map((r) => 'q:' + r),
      }));
      def.questions.forEach((q) => nodes.set('q:' + q.id, {
        label: `问题「${q.text || q.id}」`,
        deps: ['s:' + q.step].concat(
          (q.dependsOn || []).reduce((acc, c) => acc.concat(conditionRefs(c)), []).map((r) => 'q:' + r)
        ),
      }));

      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = new Map([...nodes.keys()].map((k) => [k, WHITE]));
      const stack = [];
      let cycleReported = false;
      const dfs = (key) => {
        if (cycleReported) return;
        color.set(key, GRAY);
        stack.push(key);
        for (const dep of nodes.get(key).deps) {
          if (!nodes.has(dep)) continue;
          if (color.get(dep) === GRAY) {
            const from = stack.indexOf(dep);
            const chainKeys = stack.slice(from).concat([dep]);
            err(
              'dependencies',
              '依赖关系成环：' + chainKeys.map((k) => nodes.get(k).label).join(' → '),
              chainKeys
            );
            cycleReported = true;
            return;
          }
          if (color.get(dep) === WHITE) dfs(dep);
          if (cycleReported) return;
        }
        stack.pop();
        color.set(key, BLACK);
      };
      for (const key of nodes.keys()) {
        if (cycleReported) break;
        if (color.get(key) === WHITE) dfs(key);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /* ---------------- 运行时会话 ---------------- */

  const STATUS = { CONFIRMED: 'confirmed', STALE: 'stale' }; // 答案状态：已确认 / 待重新确认

  function createSession(def, saved) {
    const check = validateFlow(def);
    if (!check.ok) {
      const e = new Error('流程定义不合法：' + check.errors.map((x) => x.message).join('；'));
      e.errors = check.errors;
      throw e;
    }

    const steps = def.steps;
    const questions = def.questions;
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const stepIndex = new Map(steps.map((s, i) => [s.id, i]));
    const label = (qid) => { const q = qMap.get(qid); return q ? `「${q.text || qid}」` : `「${qid}」`; };

    // 依赖优先的求值顺序（图无环，校验已保证）
    const evalOrder = (() => {
      const nodes = new Map();
      steps.forEach((s) => nodes.set('s:' + s.id, conditionRefs(s.condition).map((r) => 'q:' + r)));
      questions.forEach((q) => nodes.set('q:' + q.id, ['s:' + q.step].concat(
        (q.dependsOn || []).reduce((acc, c) => acc.concat(conditionRefs(c)), []).map((r) => 'q:' + r)
      )));
      const order = [];
      const done = new Set();
      const visit = (k) => {
        if (done.has(k)) return;
        done.add(k); // 无环，直接标记
        nodes.get(k).forEach((d) => { if (nodes.has(d)) visit(d); });
        order.push(k);
      };
      nodes.forEach((_, k) => visit(k));
      return order;
    })();

    // 反向图：X 被改 → 哪些节点依赖 X（用于影响面分析与链条回溯）
    const dependents = new Map(); // key -> [key]
    const addDep = (from, to) => {
      if (!dependents.has(from)) dependents.set(from, []);
      dependents.get(from).push(to);
    };
    steps.forEach((s) => conditionRefs(s.condition).forEach((r) => addDep('q:' + r, 's:' + s.id)));
    questions.forEach((q) => {
      addDep('s:' + q.step, 'q:' + q.id);
      (q.dependsOn || []).forEach((c) => conditionRefs(c).forEach((r) => addDep('q:' + r, 'q:' + q.id)));
    });

    // ---- 可变状态 ----
    const answers = {}; // qid -> { value, status }
    let currentStep = 0;
    let maxReached = 0;
    if (saved && typeof saved === 'object') {
      Object.keys(saved.answers || {}).forEach((qid) => {
        if (qMap.has(qid)) answers[qid] = { value: saved.answers[qid].value, status: saved.answers[qid].status === STATUS.STALE ? STATUS.STALE : STATUS.CONFIRMED };
      });
      currentStep = Math.min(Math.max(0, saved.currentStep | 0), steps.length - 1);
      maxReached = Math.min(Math.max(currentStep, saved.maxReached | 0), steps.length - 1);
    }

    const getValue = (qid) => (answers[qid] ? answers[qid].value : undefined);

    // 激活状态计算：步骤成立条件满足 且 条件引用的问题均激活；问题所属步骤激活 且 依赖条件满足 且 依赖引用的问题均激活
    function computeActive() {
      const active = {};
      for (const key of evalOrder) {
        if (key.startsWith('s:')) {
          const s = stepMap.get(key.slice(2));
          const condOk = !s.condition || evalCondition(s.condition, getValue);
          const refsOk = conditionRefs(s.condition).every((r) => active['q:' + r]);
          active[key] = condOk && refsOk;
        } else {
          const q = qMap.get(key.slice(2));
          const stepOk = active['s:' + q.step];
          const depsOk = (q.dependsOn || []).every((c) => evalCondition(c, getValue));
          const refsOk = (q.dependsOn || []).every((c) => conditionRefs(c).every((r) => active['q:' + r]));
          active[key] = stepOk && depsOk && refsOk;
        }
      }
      return active;
    }

    // 问题未激活的具体原因（用于界面说明与阻止链条）
    function inactiveReason(qid, active) {
      const q = qMap.get(qid);
      if (!active['s:' + q.step]) {
        const s = stepMap.get(q.step);
        return `所属步骤「${s.title || s.id}」的成立条件未满足（${s.condition ? describeCondition(s.condition, label) : '无条件'}）`;
      }
      for (const c of q.dependsOn || []) {
        if (!evalCondition(c, getValue)) return `依赖条件未满足：${describeCondition(c, label)}`;
        for (const r of conditionRefs(c)) {
          if (!active['q:' + r]) return `依赖的问题${label(r)}当前未激活`;
        }
      }
      return '';
    }

    function stepInactiveReason(sid, active) {
      const s = stepMap.get(sid);
      if (!s.condition) return '';
      if (!evalCondition(s.condition, getValue)) return `成立条件未满足：${describeCondition(s.condition, label)}`;
      const ref = conditionRefs(s.condition).find((r) => !active['q:' + r]);
      if (ref) return `条件引用的问题${label(ref)}当前未激活`;
      return '';
    }

    // 从 fromKey 到 toKey 的依赖链条（沿正向依赖边 BFS，取最短）
    function dependencyChain(fromKey, toKey) {
      const nodes = new Map();
      steps.forEach((s) => nodes.set('s:' + s.id, conditionRefs(s.condition).map((r) => 'q:' + r)));
      questions.forEach((q) => nodes.set('q:' + q.id, ['s:' + q.step].concat(
        (q.dependsOn || []).reduce((acc, c) => acc.concat(conditionRefs(c)), []).map((r) => 'q:' + r)
      )));
      // 从 toKey 沿“依赖于”边回溯到 fromKey（toKey 依赖 … 依赖 fromKey）
      const prev = new Map([[toKey, null]]);
      const queue = [toKey];
      while (queue.length) {
        const cur = queue.shift();
        if (cur === fromKey) break;
        for (const dep of nodes.get(cur) || []) {
          if (!prev.has(dep)) { prev.set(dep, cur); queue.push(dep); }
        }
      }
      if (!prev.has(fromKey)) return null;
      const chain = [];
      for (let k = fromKey; k; k = prev.get(k)) chain.push(k);
      return chain;
    }

    const keyLabel = (k) => k.startsWith('s:')
      ? `步骤「${(stepMap.get(k.slice(2)) || {}).title || k.slice(2)}」`
      : `问题${label(k.slice(2))}`;

    /* ---- 改答与影响判定（需求 3、4、5） ---- */
    function setAnswer(qid, value) {
      const q = qMap.get(qid);
      if (!q) return { ok: false, error: `问题 "${qid}" 不存在` };
      const before = computeActive();
      const had = !!answers[qid];
      const oldValue = had ? answers[qid].value : undefined;
      if (had && oldValue === value && answers[qid].status === STATUS.CONFIRMED) {
        return { ok: true, changed: false, impact: [] };
      }
      answers[qid] = { value, status: STATUS.CONFIRMED };
      const after = computeActive();

      const impact = [];
      // 步骤层面变化
      for (const s of steps) {
        const k = 's:' + s.id;
        if (before[k] === after[k]) continue;
        impact.push({
          type: 'step', id: s.id, title: s.title || s.id,
          outcome: after[k] ? 'reactivated' : 'deactivated',
          reason: after[k]
            ? `成立条件已恢复满足（${s.condition ? describeCondition(s.condition, label) : '无条件'}），步骤及其保留答案原样回到流程`
            : `成立条件不再满足（${s.condition ? describeCondition(s.condition, label) : ''}），步骤下答案转为保留未激活`,
        });
      }
      // 问题层面变化
      for (const qq of questions) {
        if (qq.id === qid) continue;
        const k = 'q:' + qq.id;
        const wasActive = before[k], isActive = after[k];
        const ans = answers[qq.id];
        if (wasActive && !isActive) {
          impact.push({
            type: 'question', id: qq.id, text: qq.text, outcome: 'deactivated',
            preserved: ans ? ans.value : undefined,
            reason: inactiveReason(qq.id, after) + '；原答案保留，不计入进度',
            chain: chainLabels(dependencyChain('q:' + qid, k)),
          });
        } else if (!wasActive && isActive) {
          impact.push({
            type: 'question', id: qq.id, text: qq.text, outcome: 'reactivated',
            preserved: ans ? ans.value : undefined,
            reason: ans
              ? '激活条件恢复，原答案原样回到流程，不重复计入进度'
              : '激活条件满足，问题进入待回答',
            chain: chainLabels(dependencyChain('q:' + qid, k)),
          });
        } else if (wasActive && isActive && ans) {
          // 两侧均激活：仅当其“直接前提”（自身依赖 + 所属步骤条件引用的问题）含被改问题时，才需重新确认
          const directRefs = new Set();
          (qq.dependsOn || []).forEach((c) => conditionRefs(c).forEach((r) => directRefs.add(r)));
          conditionRefs(stepMap.get(qq.step).condition).forEach((r) => directRefs.add(r));
          if (directRefs.has(qid)) {
            ans.status = STATUS.STALE; // 保留原答案，仅显式标注（需求 4）
            impact.push({
              type: 'question', id: qq.id, text: qq.text, outcome: 'reconfirm',
              preserved: ans.value,
              reason: `其直接前提${label(qid)}的答案已由 ${JSON.stringify(oldValue)} 改为 ${JSON.stringify(value)}，原答案保留，需重新确认`,
              chain: chainLabels(dependencyChain('q:' + qid, k)),
            });
          } else {
            impact.push({
              type: 'question', id: qq.id, text: qq.text, outcome: 'keep',
              reason: `不直接以${label(qid)}为前提，且激活状态未变，答案继续沿用`,
            });
          }
        }
      }
      return { ok: true, changed: true, impact };
    }

    function chainLabels(chain) {
      return chain ? chain.map(keyLabel) : null;
    }

    // 重新确认：原答案不变，仅状态回到已确认（需求 4）
    function confirmAnswer(qid) {
      const ans = answers[qid];
      if (!ans) return { ok: false, error: `问题 "${qid}" 尚无答案` };
      if (ans.status !== STATUS.STALE) return { ok: true, changed: false };
      ans.status = STATUS.CONFIRMED;
      return { ok: true, changed: true };
    }

    /* ---- 导航与阻止（需求 6） ---- */

    // 当前步骤中阻碍前进的必答问题（未答或待重新确认），附依赖链说明
    function blockersForStep(sid, active) {
      const s = stepMap.get(sid);
      if (!active['s:' + sid]) return [];
      return questions
        .filter((q) => q.step === sid && q.required !== false && active['q:' + q.id])
        .filter((q) => !answers[q.id] || answers[q.id].status === STATUS.STALE)
        .map((q) => ({
          id: q.id,
          text: q.text,
          cause: !answers[q.id] ? '尚未作答' : '答案受改答影响，待重新确认',
          basis: activationBasis(q, s),
        }));
    }

    // 说明“为什么这个问题现在必须回答”：列出其成立的直接前提
    function activationBasis(q, s) {
      const parts = [];
      if (s.condition) parts.push(`步骤「${s.title || s.id}」成立：${describeCondition(s.condition, label)}`);
      (q.dependsOn || []).forEach((c) => parts.push(`依赖成立：${describeCondition(c, label)}`));
      if (!parts.length) parts.push('该问题为流程必答项');
      return parts;
    }

    function nextActiveStepIndex(from) {
      const active = computeActive();
      for (let i = from + 1; i < steps.length; i++) {
        if (active['s:' + steps[i].id]) return i;
      }
      return -1;
    }

    function next() {
      const active = computeActive();
      const s = steps[currentStep];
      const missing = blockersForStep(s.id, active);
      if (missing.length) {
        return { ok: false, reason: 'missing', message: '存在必答问题未完成，已阻止前进，已填内容与状态未改动', missing };
      }
      const target = nextActiveStepIndex(currentStep);
      if (target === -1) return { ok: false, reason: 'end', message: '已是最后一个可到达步骤' };
      currentStep = target;
      if (target > maxReached) maxReached = target;
      return { ok: true };
    }

    function prev() {
      const active = computeActive();
      for (let i = currentStep - 1; i >= 0; i--) {
        if (active['s:' + steps[i].id]) { currentStep = i; return { ok: true }; }
      }
      return { ok: false, reason: 'start', message: '已是第一个步骤' };
    }

    function skip() {
      const s = steps[currentStep];
      if (!s.skippable) {
        const active = computeActive();
        return {
          ok: false, reason: 'not-skippable',
          message: `步骤「${s.title || s.id}」不可跳过，已阻止，已填内容与状态未改动`,
          missing: blockersForStep(s.id, active),
        };
      }
      const target = nextActiveStepIndex(currentStep);
      if (target === -1) return { ok: false, reason: 'end', message: '已是最后一个可到达步骤' };
      currentStep = target;
      if (target > maxReached) maxReached = target;
      return { ok: true };
    }

    function goToStep(i) {
      if (i < 0 || i >= steps.length) return { ok: false, reason: 'range', message: '步骤序号超出范围' };
      const active = computeActive();
      const s = steps[i];
      if (!active['s:' + s.id]) {
        const refs = conditionRefs(s.condition);
        return {
          ok: false, reason: 'step-inactive',
          message: `步骤「${s.title || s.id}」的成立条件当前未满足，已阻止进入，已填内容与状态未改动`,
          chain: [stepInactiveReason(s.id, active)].concat(
            refs.map((r) => `${keyLabel('q:' + r)}（${r}）当前答案：${JSON.stringify(getValue(r))}`)
          ),
        };
      }
      if (i > maxReached) {
        // 不允许越过未完成的中间步骤
        for (let j = 0; j < i; j++) {
          const sj = steps[j];
          if (!active['s:' + sj.id] || sj.skippable) continue;
          const missing = blockersForStep(sj.id, active);
          if (missing.length) {
            return {
              ok: false, reason: 'missing',
              message: `前置步骤「${sj.title || sj.id}」存在必答问题未完成，已阻止前进，已填内容与状态未改动`,
              missing,
            };
          }
        }
        maxReached = i;
      }
      currentStep = i;
      return { ok: true };
    }

    /* ---- 派生视图（需求 7 的四种状态） ---- */

    function questionState(q, active) {
      const ans = answers[q.id];
      if (!active['q:' + q.id]) {
        return { status: 'inactive', answer: ans ? ans.value : undefined, answerKept: !!ans, reason: inactiveReason(q.id, active) };
      }
      if (!ans) return { status: 'unreached' };
      if (ans.status === STATUS.STALE) return { status: 'stale', answer: ans.value };
      return { status: 'confirmed', answer: ans.value };
    }

    function getState() {
      const active = computeActive();
      const stepViews = steps.map((s, i) => {
        const qs = questions.filter((q) => q.step === s.id).map((q) => Object.assign({
          id: q.id, text: q.text, type: q.type || 'text', required: q.required !== false,
          options: q.options || null,
        }, questionState(q, active)));
        let status;
        if (!active['s:' + s.id]) status = 'inactive';
        else if (qs.some((q) => q.status === 'stale')) status = 'stale';
        else if (qs.filter((q) => q.required).every((q) => q.status === 'confirmed') && qs.some((q) => q.status === 'confirmed')) status = 'confirmed';
        else status = 'unreached';
        const activeQs = qs.filter((q) => q.status !== 'inactive');
        return {
          id: s.id, title: s.title || s.id, phase: s.phase || '', skippable: !!s.skippable,
          index: i, status, current: i === currentStep, reached: i <= maxReached,
          inactiveReason: active['s:' + s.id] ? '' : stepInactiveReason(s.id, active),
          progress: {
            confirmed: activeQs.filter((q) => q.status === 'confirmed').length,
            total: activeQs.length,
          },
          questions: qs,
        };
      });
      const allActive = stepViews.flatMap((s) => s.questions).filter((q) => q.status !== 'inactive');
      return {
        flowTitle: def.title || def.id || '申报引导',
        currentStep: currentStep,
        steps: stepViews,
        progress: {
          confirmed: allActive.filter((q) => q.status === 'confirmed').length,
          stale: allActive.filter((q) => q.status === 'stale').length,
          total: allActive.length,
        },
        canSubmit: steps.every((s, i) => blockersForStep(s.id, active).length === 0),
      };
    }

    function serialize() {
      return JSON.stringify({ answers, currentStep, maxReached });
    }

    return {
      def, getState, setAnswer, confirmAnswer, next, prev, skip, goToStep, serialize,
      _internals: { computeActive, blockersForStep, evalCondition: (c) => evalCondition(c, getValue) },
    };
  }

  return { validateFlow, createSession, evalCondition, describeCondition, conditionRefs, STATUS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FlowEngine;
