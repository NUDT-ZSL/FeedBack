/**
 * GuideEngine —— 离线自助申报引导引擎
 *
 * 职责：
 *  1. 配置校验：标识重复 / 悬空引用 / 依赖成环 / 前向引用 / 条件与依赖声明不一致，
 *     一律拒绝并给出「位置」与「涉及链条」。
 *  2. 状态推导：每个问题处于 已确认(confirmed) / 待重新确认(needsReconfirm) /
 *     未激活(inactive) / 未到达(unreached) 四态之一；步骤有 完成/进行中/未激活/未到达/已跳过。
 *  3. 改答传播：沿依赖边比较「作答时基线签名」与「当前输入签名」，逐项给出依据；
 *     被波及答案一律保留、显式标注，绝不静默清空。
 *  4. 前进守卫：必答缺口或待重新确认未处理时阻止前进，指出缺失问题与依赖链，且不改动任何状态。
 *
 * 该文件无外部依赖，UMD 封装：浏览器挂 window.GuideEngine，Node 下 module.exports。
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.GuideEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 通用工具
  // ---------------------------------------------------------------------------

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a && b && typeof a === 'object') {
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => deepEqual(a[k], b[k]));
    }
    return false;
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  class GuideConfigError extends Error {
    constructor(errors) {
      super('引导配置校验未通过，共 ' + errors.length + ' 项错误');
      this.name = 'GuideConfigError';
      this.errors = errors;
    }
  }

  class GuideActionError extends Error {
    constructor(reason) {
      super(reason.message || '操作被拒绝');
      this.name = 'GuideActionError';
      this.reason = reason; // {code, message, blocking?}
    }
  }

  /** 条件函数访问了未声明/未登记的问题标识时抛出，由校验或求值过程捕获 */
  class DepRefError extends Error {
    constructor(refId) {
      super('条件中引用了未声明的问题标识：' + refId);
      this.refId = refId;
    }
  }

  // ---------------------------------------------------------------------------
  // 配置校验
  // ---------------------------------------------------------------------------

  const Q_TYPES = ['text', 'textarea', 'number', 'select', 'radio', 'boolean', 'date'];

  /**
   * 校验配置。返回 { valid, errors }。
   * error: { code, message, location, chain? }
   *  - chain（成环时）：[{id, location}]，首尾相同以显式闭环
   */
  function validateConfig(config) {
    const errors = [];
    const warnings = [];
    const push = (code, message, location, chain) =>
      errors.push({ code, message, location, chain: chain || null });
    const warn = (code, message, location) =>
      warnings.push({ code, message, location });

    if (!config || typeof config !== 'object') {
      push('E_ROOT', '配置必须是一个对象', '配置根节点');
      return { valid: false, errors };
    }
    if (!Array.isArray(config.steps) || config.steps.length === 0) {
      push('E_NO_STEPS', '必须至少声明一个引导步骤 steps[]', '配置根节点');
      return { valid: false, errors };
    }

    // 位置描述
    const locStep = (i) =>
      '步骤序列第 ' + (i + 1) + ' 项（id「' +
      (config.steps[i] && config.steps[i].id) + '」' +
      (config.steps[i] && config.steps[i].title ? '，标题「' + config.steps[i].title + '」' : '') + ')';
    const locQuestion = (si, qi) =>
      locStep(si) + ' 的问题第 ' + (qi + 1) + ' 项（id「' +
      (config.steps[si].questions[qi] && config.steps[si].questions[qi].id) + '」）';

    // ---- 阶段（stage）登记 ----
    const stages = Array.isArray(config.stages) ? config.stages : [];
    const stageIds = new Set();
    stages.forEach((st, i) => {
      if (!st || typeof st.id !== 'string' || !st.id) {
        push('E_STAGE_ID', '阶段缺少有效 id', 'stages 第 ' + (i + 1) + ' 项');
      } else if (stageIds.has(st.id)) {
        push('E_DUP_STAGE', '阶段标识「' + st.id + '」重复', 'stages 第 ' + (i + 1) + ' 项');
      }
      stageIds.add(st && st.id);
    });

    // ---- 登记所有节点（步骤 + 问题），检查标识重复与结构 ----
    /** id -> {kind:'step'|'question', stepIndex, qIndex?, title, location} */
    const registry = new Map();
    /** 依赖边：ownerId -> depId[]（仅登记成功的 owner） */
    const edges = new Map();
    const stepMeta = []; // {step, index, qIds:[]}

    const register = (id, rec) => {
      if (registry.has(id)) {
        const prev = registry.get(id);
        push(
          'E_DUP_ID',
          '标识「' + id + '」重复：' + prev.location + ' 与 ' + rec.location + ' 不能使用同一标识',
          rec.location
        );
        return false;
      }
      registry.set(id, rec);
      return true;
    };

    config.steps.forEach((step, si) => {
      if (!step || typeof step !== 'object') {
        push('E_STEP_SHAPE', '步骤必须是对象', locStep(si));
        return;
      }
      if (typeof step.id !== 'string' || !step.id) {
        push('E_STEP_ID', '步骤缺少有效 id', locStep(si));
      }
      if (typeof step.title !== 'string' || !step.title) {
        push('E_STEP_TITLE', '步骤缺少标题 title', locStep(si));
      }
      if (step.stage !== undefined && step.stage !== null && !stageIds.has(step.stage)) {
        push(
          'E_UNKNOWN_STAGE',
          '步骤「' + step.id + '」声明了未登记的阶段 stage「' + step.stage + '」',
          locStep(si)
        );
      }
      step.skippable = step.skippable === true; // 规范化
      step.condition = step.condition === undefined ? null : step.condition;
      if (step.condition !== null && typeof step.condition !== 'function') {
        push('E_COND_TYPE', '步骤成立条件 condition 必须是函数', locStep(si));
      }
      step.dependsOn = normalizeDeps(step.dependsOn);

      if (step.id) register(step.id, { kind: 'step', stepIndex: si, title: step.title, location: locStep(si) });
      const qIds = [];

      if (!Array.isArray(step.questions)) {
        push('E_QUESTIONS_SHAPE', '步骤的 questions 必须是数组（可为空数组）', locStep(si));
        stepMeta.push({ step, index: si, qIds });
        return;
      }

      step.questions.forEach((q, qi) => {
        if (!q || typeof q !== 'object') {
          push('E_Q_SHAPE', '问题必须是对象', locQuestion(si, qi));
          return;
        }
        if (typeof q.id !== 'string' || !q.id) {
          push('E_Q_ID', '问题缺少唯一标识 id', locQuestion(si, qi));
        } else {
          const ok = register(q.id, {
            kind: 'question', stepIndex: si, qIndex: qi,
            title: q.title, location: locQuestion(si, qi)
          });
          if (ok) qIds.push(q.id);
        }
        if (typeof q.title !== 'string' || !q.title) {
          push('E_Q_TITLE', '问题缺少标题 title', locQuestion(si, qi));
        }
        if (q.type !== undefined && Q_TYPES.indexOf(q.type) === -1) {
          push('E_Q_TYPE', '问题「' + q.id + '」的 type「' + q.type + '」不受支持（可选：' + Q_TYPES.join('/') + '）',
            locQuestion(si, qi));
        }
        if (Array.isArray(q.options)) {
          const vals = new Set();
          q.options.forEach((op) => {
            if (!op || op.value === undefined) {
              push('E_OPTION_SHAPE', '问题「' + q.id + '」存在缺少 value 的选项', locQuestion(si, qi));
            } else if (vals.has(String(op.value))) {
              push('E_OPTION_DUP', '问题「' + q.id + '」的选项值「' + op.value + '」重复', locQuestion(si, qi));
            }
            vals.add(String(op.value));
          });
        }
        q.optional = q.optional === true;
        q.condition = q.condition === undefined ? null : q.condition;
        if (q.condition !== null && typeof q.condition !== 'function') {
          push('E_COND_TYPE', '问题成立条件 condition 必须是函数', locQuestion(si, qi));
        }
        q.dependsOn = normalizeDeps(q.dependsOn);
      });

      stepMeta.push({ step, index: si, qIds });
    });

    // 标识层面存在硬错误时，后续图分析没有意义
    if (errors.some((e) => e.code === 'E_DUP_ID' || e.code === 'E_Q_ID' || e.code === 'E_STEP_ID')) {
      return { valid: false, errors };
    }

    // 依赖边在后续（登记完成后）统一建立；此处只保留节点元信息
    /** id -> 顺序键：步骤 (si+1)*100000；问题 (si+1)*100000 + qi+1 */
    const ownerOrder = new Map();
    stepMeta.forEach(({ step, index, qIds }) => {
      ownerOrder.set(step.id, (index + 1) * 100000);
      qIds.forEach((qid, qi) => ownerOrder.set(qid, (index + 1) * 100000 + qi + 1));
    });

    const addEdges = (ownerId, deps, location, ownerKind, ownerStepIndex) => {
      if (!ownerId) return;
      const list = [];
      deps.forEach((dep) => {
        const rec = registry.get(dep);
        if (!rec) {
          push(
            'E_UNKNOWN_REF',
            (ownerKind === 'step' ? '步骤' : '问题') + '「' + ownerId + '」声明的依赖「' + dep +
            '」未登记：不存在同 id 的问题（请检查拼写或定义顺序）',
            location
          );
          return;
        }
        if (rec.kind !== 'question') {
          push(
            'E_REF_KIND',
            '依赖只能引用问题标识，「' + dep + '」是一个步骤标识',
            location
          );
          return;
        }
        if (ownerKind === 'step' && rec.stepIndex === ownerStepIndex) {
          push(
            'E_STEP_SELF_DEP',
            '步骤「' + ownerId + '」的成立条件不能依赖本步骤内的问题「' + dep +
            '」：步骤必须先激活，其问题才可能作答（请改为依赖此前步骤中的问题）',
            location,
            [{ id: ownerId, location }, { id: dep, location: rec.location }]
          );
          return;
        }
        if (dep === ownerId) {
          push(
            'E_SELF_REF',
            (ownerKind === 'step' ? '步骤' : '问题') + '「' + ownerId + '」依赖了自身，不允许自引用',
            location,
            [{ id: ownerId, location }, { id: dep, location: rec.location }]
          );
          return;
        }
        list.push(dep);
      });
      edges.set(ownerId, list);
    };

    stepMeta.forEach(({ step, index, qIds }) => {
      addEdges(step.id, step.dependsOn, locStep(index), 'step', index);
      qIds.forEach((qid) => {
        const qi = step.questions.findIndex((q) => q.id === qid);
        addEdges(qid, step.questions[qi].dependsOn, locQuestion(index, qi), 'question');
      });
    });

    // ---- 成环检测 ----
    // 图一（ownerEdges）：步骤/问题各自声明的依赖边。
    const WHITE = 0, GRAY = 1, BLACK = 2;

    const findCycleInGraph = (nodeIds, edgeMap) => {
      const color = new Map();
      nodeIds.forEach((id) => color.set(id, WHITE));
      for (const start of nodeIds) {
        if (color.get(start) !== WHITE) continue;
        const stack = []; // {id, edgePos}
        color.set(start, GRAY);
        stack.push({ id: start, edgePos: 0 });
        while (stack.length) {
          const top = stack[stack.length - 1];
          const deps = edgeMap.get(top.id) || [];
          if (top.edgePos < deps.length) {
            const dep = deps[top.edgePos++];
            // 悬空/自引用边已在建边阶段剔除
            if (!color.has(dep)) continue;
            if (color.get(dep) === GRAY) {
              const ci = stack.findIndex((s) => s.id === dep);
              const cycleNodes = stack.slice(ci).map((s) => s.id);
              cycleNodes.push(dep); // 显式闭环
              return cycleNodes;
            }
            if (color.get(dep) === WHITE) {
              color.set(dep, GRAY);
              stack.push({ id: dep, edgePos: 0 });
            }
          } else {
            color.set(top.id, BLACK);
            stack.pop();
          }
        }
      }
      return null;
    };

    const reportCycle = (cyc, label) => {
      const chain = cyc.map((cid) => ({ id: cid, location: registry.get(cid).location }));
      push(
        'E_CYCLE',
        '依赖不得成环。检测到' + label + '：' + cyc.join(' → ') +
        '（链条中的每个对象都（直接或间接）依赖于其后继，成立条件永远无法确定）',
        registry.get(cyc[0]).location,
        chain
      );
    };

    {
      const cyc = findCycleInGraph([...registry.keys()], edges);
      if (cyc) { reportCycle(cyc, '依赖环'); }
    }

    // 图二（运行时求值图）：问题可见性 = 所属步骤成立 且 问题自身条件成立。
    // 求值边（A → B 表示求值 A 前必须先求值 B）：
    //   问题 q → 所属步骤；问题 q → q.dependsOn 中各问题；步骤 s → s.dependsOn 中各问题。
    // ownerEdges 查不到「经所属步骤继承」形成的环，必须对求值图再查一次。
    const rtEdges = new Map();
    stepMeta.forEach(({ step, qIds }) => {
      rtEdges.set(step.id, step.dependsOn.filter((d) => registry.has(d)));
      qIds.forEach((qid) => {
        const qi = step.questions.findIndex((q) => q.id === qid);
        const merged = new Set([step.id]);
        (step.questions[qi].dependsOn || []).forEach((d) => merged.add(d));
        rtEdges.set(qid, [...merged].filter((d) => registry.has(d)));
      });
    });
    if (!errors.some((e) => e.code === 'E_CYCLE')) {
      const cyc = findCycleInGraph([...registry.keys()], rtEdges);
      if (cyc) reportCycle(cyc, '求值依赖环（依赖经所属步骤间接闭环）');
    }

    // ---- 条件函数与依赖声明的一致性（试跑一次，值全为 undefined） ----
    if (!errors.some((e) => e.code === 'E_CYCLE')) {
      stepMeta.forEach(({ step, index }) => {
        probeCondition(step, step.dependsOn, locStep(index), '步骤', push, warn);
        (step.questions || []).forEach((q, qi) => {
          if (!q || typeof q.id !== 'string') return;
          probeCondition(q, q.dependsOn, locQuestion(index, qi), '问题', push, warn);
        });
      });
    }

    return { valid: errors.length === 0, errors, warnings };

    function normalizeDeps(d) {
      if (d === undefined || d === null) return [];
      return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : [];
    }

    /** 以「全部已登记、值全 undefined」试跑条件，捕获对未声明标识的访问 */
    function probeCondition(owner, declared, location, kind, pushErr, warnErr) {
      if (!owner.condition) return;
      const declaredSet = new Set(declared);
      const accessed = new Set();
      const ctx = new Proxy({}, {
        get(_t, key) {
          if (typeof key !== 'string') return undefined;
          if (!registry.has(key)) throw new DepRefError(key);
          if (!declaredSet.has(key)) throw new DepRefError(key);
          accessed.add(key);
          return undefined;
        }
      });
      let result;
      try {
        result = owner.condition(ctx);
      } catch (e) {
        if (e instanceof DepRefError) {
          pushErr(
            'E_DEP_NOT_DECLARED',
            kind + '「' + owner.id + '」的成立条件引用了标识「' + e.refId +
            '」，但该标识未在 dependsOn 中声明（或根本未登记）。条件所依赖的每个问题都必须显式声明',
            location
          );
        } else {
          pushErr('E_COND_THROW', kind + '「' + owner.id + '」的成立条件在求值时抛出异常：' + e.message, location);
        }
        return;
      }
      if (result !== undefined && result !== null && typeof result !== 'boolean' &&
          typeof result !== 'number' && typeof result !== 'string') {
        pushErr('E_COND_RESULT', kind + '「' + owner.id + '」的成立条件应返回布尔值（或可判定真/假的原始值）', location);
      }
      declared.forEach((d) => {
        if (!accessed.has(d)) {
          // 短路求值可能访问不到，仅作警告，不拒绝
          warnErr('W_DEP_UNUSED', '提示：' + kind + '「' + owner.id + '」声明了依赖「' + d + '」，但本次试求值未访问到（若由 && / || 短路引起可忽略）', location);
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 引擎
  // ---------------------------------------------------------------------------

  function createGuide(config) {
    const verdict = validateConfig(config);
    if (!verdict.valid) throw new GuideConfigError(verdict.errors);

    const steps = config.steps;
    const stepIndexById = new Map();
    const qIndexById = new Map(); // qid -> {stepIndex, qIndex, def, step}
    steps.forEach((s, si) => {
      stepIndexById.set(s.id, si);
      (s.questions || []).forEach((q, qi) => qIndexById.set(q.id, { stepIndex: si, qIndex: qi, def: q, step: s }));
    });

    /**
     * 运行时求值图（与 validateConfig 中的图二一致）：
     *   步骤 s → s.dependsOn 中各问题；
     *   问题 q → 所属步骤、q.dependsOn 中各问题。
     * 已通过校验保证无环。topoOrder 中被依赖者排在前面。
     */
    const rtDeps = new Map();
    steps.forEach((s) => {
      rtDeps.set(s.id, (s.dependsOn || []).slice());
      (s.questions || []).forEach((q) => {
        rtDeps.set(q.id, [s.id].concat(q.dependsOn || []));
      });
    });
    const topoOrder = (() => {
      const indeg = new Map();
      const dependents = new Map(); // dep -> [dependents]
      rtDeps.forEach((deps, id) => {
        if (!indeg.has(id)) indeg.set(id, 0);
        deps.forEach((d) => {
          if (!dependents.has(d)) dependents.set(d, []);
          dependents.get(d).push(id);
          indeg.set(id, (indeg.get(id) || 0) + 1);
        });
      });
      // 同入度时按配置顺序（步骤在前），保证输出稳定
      const orderedIds = [];
      steps.forEach((s) => { orderedIds.push(s.id); (s.questions || []).forEach((q) => orderedIds.push(q.id)); });
      const queue = orderedIds.filter((id) => indeg.get(id) === 0);
      const out = [];
      while (queue.length) {
        const id = queue.shift();
        out.push(id);
        (dependents.get(id) || []).forEach((dep2) => {
          indeg.set(dep2, indeg.get(dep2) - 1);
          if (indeg.get(dep2) === 0) queue.push(dep2);
        });
      }
      return out;
    })();

    /**
     * 持久状态（用户数据，任何传播都不得清空）：
     *  answers  —— 答案原值
     *  sigs     —— 每次提交时的依赖输入基线签名
     *  furthest —— 最远已推进到的步骤序号（只进不退；失活也不抹除）。
     *              步骤 j「已到达」当且仅当 j <= furthest。未到达与未激活据此区分：
     *              尚未走到的位置 = 未到达；已走到但条件不满足 = 未激活（答案保留）。
     *  skipped  —— 用户显式跳过的可跳过步骤
     *  cursor   —— 当前查看的步骤
     * 派生状态（每次 recompute 重建）：qstate / sstate / reasons
     */
    const state = {
      answers: {},
      sigs: {},
      furthest: 0,
      skipped: {},
      cursor: steps[0].id,
      qstate: {},
      sstate: {},
      stepActive: {}, // 步骤条件真值表（不受 reached 影响），供 landAt 跨越失活步骤
      reasons: {},
      lastChange: null
    };
    const isReached = (si) => si <= state.furthest;

    // ---- 受限上下文 ----
    // qs 为「本轮重算正在构建」的状态表；求值条件必须看到同一轮中上游刚算出的状态，
    // 而不是 state.qstate 里上一轮的陈旧值。
    const makeRuntimeCtx = (declared, qs) => {
      const declaredSet = new Set(declared);
      return new Proxy({}, {
        get(_t, key) {
          if (typeof key !== 'string') return undefined;
          if (!declaredSet.has(key)) throw new DepRefError(key);
          if (qs[key] === 'inactive' || !Object.prototype.hasOwnProperty.call(state.answers, key)) {
            return undefined; // 未激活 / 无答案的问题对条件而言没有值
          }
          return clone(state.answers[key]);
        }
      });
    };

    const evalCondition = (owner, qs) => {
      if (!owner.condition) return true;
      try {
        return !!owner.condition(makeRuntimeCtx(owner.dependsOn || [], qs));
      } catch (e) {
        // 经过 validate 的配置不应走到这里；兜底按不成立处理
        return false;
      }
    };

    /** 构造问题此刻的依赖输入签名：depId -> {active,value?} */
    const buildSig = (depIds, qs) => {
      const sig = {};
      depIds.forEach((d) => {
        const active = qs[d] !== 'inactive' &&
          Object.prototype.hasOwnProperty.call(state.answers, d);
        sig[d] = active ? { active: true, value: clone(state.answers[d]) } : { active: false };
      });
      return sig;
    };

    /**
     * 按运行时求值图的拓扑序重算全部派生状态。
     * 步骤节点先算出 stepActive；问题节点求值时所属步骤必已求值完毕。
     */
    const recompute = () => {
      const qstate = {};
      const reasons = {};
      const stepActiveMap = {};

      topoOrder.forEach((id) => {
        if (stepIndexById.has(id)) {
          stepActiveMap[id] = evalCondition(steps[stepIndexById.get(id)], qstate);
          return;
        }

        const meta = qIndexById.get(id);
        const { step, def: q } = meta;

        // 适用性只由条件决定（与是否走到无关）：步骤/问题条件不成立即未激活，
        // 即使尚未走到——互斥分支在用户做出选择的当下就应显示为不适用。
        const visible = stepActiveMap[step.id] && !state.skipped[step.id] && evalCondition(q, qstate);
        if (!visible) {
          qstate[q.id] = 'inactive'; // 有答案则为「保留未激活」，answers 原样保留
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(state.answers, q.id)) {
          qstate[q.id] = 'unreached'; // 适用但尚未作答（含尚未轮到）
          return;
        }

        // 可见且有答案：比较提交时基线签名与当前签名
        const oldSig = state.sigs[q.id] || {};
        const curSig = buildSig(q.dependsOn || [], qstate);
        const hard = [];
        (q.dependsOn || []).forEach((d) => {
          const o = oldSig[d] || { active: false };
          const c = curSig[d];
          const depDef = qIndexById.get(d).def;
          if (o.active && !c.active) {
            hard.push({ kind: 'deactivated', depId: d, depTitle: depDef.title, from: clone(o.value) });
          } else if (!o.active && c.active) {
            hard.push({ kind: 'reactivated', depId: d, depTitle: depDef.title, to: clone(c.value) });
          } else if (o.active && c.active && !deepEqual(o.value, c.value)) {
            hard.push({ kind: 'changed', depId: d, depTitle: depDef.title, from: clone(o.value), to: clone(c.value) });
          }
        });

        if (hard.length) {
          qstate[q.id] = 'needsReconfirm';
          reasons[q.id] = hard;
          return;
        }

        // 软级联：直接依赖仍待重新确认时，本问题也挂起（依赖恢复同值后自动解除）
        const pendingDep = (q.dependsOn || []).find((d) => qstate[d] === 'needsReconfirm');
        if (pendingDep) {
          const root = findRootReason(pendingDep, reasons);
          qstate[q.id] = 'needsReconfirm';
          reasons[q.id] = [{
            kind: 'upstream',
            depId: pendingDep,
            depTitle: qIndexById.get(pendingDep).def.title,
            path: buildChain(q.id, pendingDep, reasons),
            root: root
          }];
          return;
        }

        qstate[q.id] = 'confirmed';
      });

      state.qstate = qstate;
      state.reasons = reasons;
      state.stepActive = stepActiveMap;

      // 步骤状态：条件不成立即未激活（哪怕还没走到）；未到达只属于「适用但没轮到」的步骤
      steps.forEach((step, si) => {
        if (!stepActiveMap[step.id]) { state.sstate[step.id] = 'inactive'; return; }
        if (state.skipped[step.id]) { state.sstate[step.id] = 'skipped'; return; }
        if (!isReached(si)) { state.sstate[step.id] = 'unreached'; return; }
        const blocking = computeBlocking(step, qstate);
        state.sstate[step.id] = blocking.length === 0 ? 'done' : 'active';
      });
    };

    /** 沿 reasons 找到最早的硬失效依据 */
    const findRootReason = (qId, reasons) => {
      const r = (reasons[qId] || [])[0];
      if (!r) return null;
      if (r.kind === 'upstream') return r.root || findRootReason(r.depId, reasons);
      return { depId: r.depId, depTitle: r.depTitle, kind: r.kind, from: r.from, to: r.to };
    };

    /** 构造 qId → depId → 硬失效源头 的依赖链（id 序列） */
    const buildChain = (qId, depId, reasons) => {
      const chain = [qId, depId];
      let cur = depId;
      const guard = new Set([qId, depId]);
      for (let i = 0; i < 100; i++) {
        const r = (reasons[cur] || [])[0];
        if (!r || r.kind !== 'upstream') break;
        if (guard.has(r.depId)) break;
        chain.push(r.depId);
        guard.add(r.depId);
        cur = r.depId;
      }
      return chain;
    };

    /** 某步骤当前的必答缺口（只统计可见问题） */
    const computeBlocking = (step, qstateArg) => {
      const qs = qstateArg || state.qstate;
      const missing = [];
      (step.questions || []).forEach((q) => {
        if (qs[q.id] !== 'confirmed' && qs[q.id] !== 'inactive' && !q.optional) {
          const status = qs[q.id] === 'needsReconfirm' ? 'pending' : 'unanswered';
          const item = {
            questionId: q.id,
            title: q.title,
            status,
            chain: [q.id]
          };
          if (status === 'pending') {
            const rs = state.reasons[q.id] || [];
            item.reasons = rs;
            const r0 = rs[0];
            item.chain = r0 && r0.kind === 'upstream' ? r0.path
              : r0 ? [q.id, r0.depId] : [q.id];
          }
          missing.push(item);
        }
      });
      return missing;
    };

    const snapshotQuestionStates = () => {
      const m = {};
      for (const k of Object.keys(state.qstate)) m[k] = state.qstate[k];
      return m;
    };

    /** 由一次提交前后的状态差生成「失效范围与依据」摘要 */
    const buildChangeReport = (answeredId, prevQ, prevS) => {
      const becamePending = [];
      const becameInactive = [];
      const becameReachable = []; // inactive -> 可见（恢复）
      const unaffected = [];
      qIndexById.forEach((meta, qid) => {
        const before = prevQ[qid];
        const after = state.qstate[qid];
        if (qid === answeredId) return;
        const hasAnswer = Object.prototype.hasOwnProperty.call(state.answers, qid);
        if (before !== 'needsReconfirm' && after === 'needsReconfirm') {
          becamePending.push(qid);
        } else if (after === 'inactive' && hasAnswer && before !== 'inactive') {
          becameInactive.push(qid);
        } else if (before === 'inactive' && after !== 'inactive') {
          becameReachable.push(qid);
        } else if (before === 'confirmed' && after === 'confirmed') {
          unaffected.push(qid);
        }
      });
      const becameInactiveSteps = [];
      const reactivatedSteps = [];
      steps.forEach((s) => {
        if (prevS[s.id] !== 'inactive' && state.sstate[s.id] === 'inactive') becameInactiveSteps.push(s.id);
        if (prevS[s.id] === 'inactive' && state.sstate[s.id] !== 'inactive') reactivatedSteps.push(s.id);
      });
      return {
        kind: 'answer',
        questionId: answeredId,
        wasReconfirm: prevQ[answeredId] === 'needsReconfirm',
        becamePending,
        becameInactive,
        becameReachable,
        unaffected,
        becameInactiveSteps,
        reactivatedSteps
      };
    };

    // ---- 对用户暴露的动作（失败时原样返回，绝不修改 state） ----

    const engine = {
      config,
      GuideConfigError,
      GuideActionError,

      getState() {
        return {
          cursor: state.cursor,
          furthest: state.furthest,
          reached: steps.map((_, i) => isReached(i)),
          skipped: Object.assign({}, state.skipped),
          answers: clone(state.answers),
          questionStates: Object.assign({}, state.qstate),
          stepStates: Object.assign({}, state.sstate),
          reasons: clone(state.reasons),
          lastChange: state.lastChange ? clone(state.lastChange) : null
        };
      },

      getQuestionState(qId) { return state.qstate[qId] || 'unreached'; },
      getStepState(sId) { return state.sstate[sId] || 'unreached'; },
      getReasons(qId) { return clone(state.reasons[qId] || []); },
      getAnswer(qId) {
        return Object.prototype.hasOwnProperty.call(state.answers, qId) ? clone(state.answers[qId]) : undefined;
      },

      /** 仅切换查看的步骤；只能进入已到达且激活的步骤。纯导航，不触碰任何答案/进度 */
      goTo(stepId) {
        const si = stepIndexById.get(stepId);
        if (si === undefined) {
          throw new GuideActionError({ code: 'NO_SUCH_STEP', message: '步骤「' + stepId + '」不存在' });
        }
        if (!isReached(si)) {
          throw new GuardError('步骤「' + steps[si].title + '」尚未到达：请先完成前面的步骤',
            'STEP_UNREACHED', steps[si]);
        }
        // 已到达但当前失活的步骤允许进入查看（其中答案以「保留未激活」只读展示）
        state.cursor = stepId;
        return { ok: true, state: engine.getState() };
      },

      /**
       * 提交答案（新作答 / 重新确认同走这里）。
       * 条件不满足（步骤未到达、问题未激活）时拒绝且不改动任何内容。
       */
      answer(questionId, value) {
        const meta = qIndexById.get(questionId);
        if (!meta) {
          throw new GuideActionError({ code: 'NO_SUCH_QUESTION', message: '问题「' + questionId + '」不存在' });
        }
        const { step, def } = meta;
        const si = meta.stepIndex;

        if (!isReached(si)) {
          throw new GuardError(
            '不能在未到达的步骤「' + step.title + '」中作答问题「' + def.title + '」：请按步骤顺序进行',
            'ANSWER_UNREACHED', step);
        }
        if (state.sstate[step.id] === 'inactive') {
          throw new GuardError(
            '问题「' + def.title + '」所在步骤「' + step.title + '」的成立条件当前不满足，答案区域未激活（已有答案已保留）',
            'ANSWER_STEP_INACTIVE', step);
        }
        if (state.skipped[step.id]) {
          throw new GuardError(
            '步骤「' + step.title + '」已被跳过。如需作答，请先取消跳过',
            'ANSWER_SKIPPED', step);
        }
        if (state.qstate[questionId] === 'inactive') {
          // 给出它依赖的条件链，帮助用户理解为什么不能答
          const chain = (def.dependsOn || []).map((d) => ({
            id: d, title: qIndexById.get(d).def.title,
            active: state.qstate[d] !== 'inactive',
            value: engine.getAnswer(d)
          }));
          throw new GuardError(
            '问题「' + def.title + '」当前未激活：其成立条件不满足，不能作答',
            'ANSWER_INACTIVE', step, [{ questionId, title: def.title, deps: chain }]);
        }

        const prevQ = snapshotQuestionStates();
        const prevS = Object.assign({}, state.sstate);
        const prevValue = engine.getAnswer(questionId);

        // 提交：以「当前输入」确立新的确认基线。
        // 基线基于重算前完整的状态表（依赖不可能指向自身，故本表对所有 dep 都有值）。
        state.answers[questionId] = clone(value);
        state.sigs[questionId] = buildSig(def.dependsOn || [], state.qstate);
        recompute();
        state.lastChange = buildChangeReport(questionId, prevQ, prevS);
        state.lastChange.previousValue = prevValue;
        state.lastChange.value = clone(value);

        return { ok: true, state: engine.getState(), change: clone(state.lastChange) };
      },

      /** 显式跳过可跳过步骤，并把光标落到下一个可处理步骤 */
      skipStep(stepId) {
        const si = stepIndexById.get(stepId || state.cursor);
        if (si === undefined) {
          throw new GuideActionError({ code: 'NO_SUCH_STEP', message: '步骤「' + stepId + '」不存在' });
        }
        const step = steps[si];
        if (!step.skippable) {
          recompute();
          const missing = computeBlocking(step);
          throw new GuardError(
            '步骤「' + step.title + '」不可跳过：存在 ' + missing.length + ' 个必答问题未完成',
            'STEP_NOT_SKIPPABLE', step, missing);
        }
        const prevS = Object.assign({}, state.sstate);
        state.skipped[step.id] = true;
        state.lastChange = {
          kind: 'skip', stepId: step.id,
          becameInactiveSteps: [], reactivatedSteps: [],
          becamePending: [], becameInactive: [], becameReachable: [], unaffected: [],
          prevStepStates: prevS
        };
        if (si < steps.length - 1) {
          const target = landAt(si + 1);
          state.furthest = Math.max(state.furthest, target);
          state.cursor = steps[target].id;
        }
        recompute();
        return { ok: true, state: engine.getState() };
      },

      /** 取消跳过（回到该步骤处理） */
      unskipStep(stepId) {
        const si = stepIndexById.get(stepId);
        if (si === undefined) {
          throw new GuideActionError({ code: 'NO_SUCH_STEP', message: '步骤「' + stepId + '」不存在' });
        }
        if (!state.skipped[stepId]) return { ok: true, state: engine.getState() };
        delete state.skipped[stepId];
        state.cursor = stepId;
        recompute();
        return { ok: true, state: engine.getState() };
      },

      /**
       * 守卫：检查某步骤前进时的阻塞项。纯查询，不改状态。
       * 返回 { blocked, missing:[{questionId,title,status,chain,reasons}] }
       */
      getBlocking(stepId) {
        const step = steps[stepIndexById.get(stepId)];
        if (!step) throw new GuideActionError({ code: 'NO_SUCH_STEP', message: '步骤「' + stepId + '」不存在' });
        if (state.sstate[stepId] === 'inactive') return { blocked: false, inactive: true, missing: [] };
        const missing = computeBlocking(step);
        return { blocked: missing.length > 0, skippable: !!step.skippable, missing };
      },

    /**
     * 尝试从指定（默认当前）步骤前进。
     * 被阻止时抛出带依赖链的错误，且 state 不发生任何变化。
     */
    advance(stepId) {
      const sid = stepId || state.cursor;
      const si = stepIndexById.get(sid);
      if (si === undefined) {
        throw new GuideActionError({ code: 'NO_SUCH_STEP', message: '步骤「' + sid + '」不存在' });
      }
      const step = steps[si];
      recompute(); // 以最新答案/条件计算阻塞项，保证守卫判断新鲜
      const missing = computeBlocking(step);
      if (missing.length > 0) {
        const detail = missing.map((m) =>
          '· ' + m.title + '（' + (m.status === 'pending' ? '答案待重新确认' : '尚未作答') + '）').join('\n');
        throw new GuardError(
          '步骤「' + step.title + '」还不能前进，以下必答问题未完成：\n' + detail,
          'ADVANCE_BLOCKED', step, missing);
      }
      if (si === steps.length - 1) {
        state.cursor = sid;
        return { ok: true, finished: true, state: engine.getState() };
      }
      const target = landAt(si + 1);
      state.furthest = Math.max(state.furthest, target);
      state.cursor = steps[target].id;
      recompute();
      return { ok: true, finished: false, state: engine.getState() };
    },

      /** 上一步（导航，不改变任何答案；失活步骤自动越过） */
      back(stepId) {
        const si = stepIndexById.get(stepId || state.cursor);
        let target = si - 1;
        while (target >= 0 && state.sstate[steps[target].id] === 'inactive') target--;
        if (target < 0) return { ok: true, state: engine.getState() };
        state.cursor = steps[target].id;
        return { ok: true, state: engine.getState() };
      },

      progress() {
        let required = 0, confirmed = 0, pending = 0, unanswered = 0, retained = 0;
        qIndexById.forEach((meta, qid) => {
          const qs = state.qstate[qid];
          if (qs === 'inactive') {
            if (Object.prototype.hasOwnProperty.call(state.answers, qid)) retained++;
            return;
          }
          if (!meta.def.optional) required++;
          if (qs === 'confirmed') { confirmed++; }
          else if (qs === 'needsReconfirm') pending++;
          else if (Object.prototype.hasOwnProperty.call(state.answers, qid)) retained++;
          else unanswered++;
        });
        return { required, confirmed, pending, unanswered, retained, percent: required ? Math.round(confirmed / required * 100) : 100 };
      },

      /** 全部必答项均确认（失活/跳过步骤不计入） */
      canFinish() {
        return steps.every((s) => {
          const ss = state.sstate[s.id];
          if (ss === 'inactive' || ss === 'skipped' || ss === 'unreached') return ss === 'inactive' || ss === 'skipped';
          return computeBlocking(s).length === 0;
        });
      }
    };

    /**
     * 前进/跳过后光标的落点：从 fromIndex 起第一个「条件成立且未显式跳过」的步骤索引。
     * 基于条件真值表（而非展示态），因此能正确跨越尚未到达但条件不成立的分支步骤。
     * 若后续全部失活，落到最后一步（只读保留态）。
     */
    function landAt(fromIndex) {
      for (let i = fromIndex; i < steps.length; i++) {
        if (state.stepActive[steps[i].id] !== false && !state.skipped[steps[i].id]) return i;
      }
      return steps.length - 1;
    }

    /** 守卫错误：携带步骤与缺失项（含依赖链），供 UI 直接展示 */
    function GuardError(message, code, step, missing) {
      const err = new Error(message);
      err.name = 'GuideActionError';
      err.reason = { code, message, stepId: step && step.id, stepTitle: step && step.title, missing: missing || [] };
      return err;
    }

    recompute();
    return engine;
  }

  return { validateConfig, createGuide, GuideConfigError, GuideActionError, VERSION: '1.0.0' };
});
