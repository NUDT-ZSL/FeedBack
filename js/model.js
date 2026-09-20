/*
 * 表单认知负担推演核心模块（纯函数、无 DOM 依赖）
 * 所有计算均为全量重推：给定同一份表单状态，结果恒定，
 * 且与“做了若干增量操作后整体重推”的结果一致。
 */
(function (global) {
  'use strict';

  var DEP_TYPES = {
    same:   { label: '同一步骤', gap: 0 },
    before: { label: '前置步骤', gap: 1 },
    after:  { label: '后置步骤', gap: -1 }
  };

  function f(id, label, step, require, read, note) {
    return { id: id, label: label, step: step, require: require,
             read: read, note: note || '', locked: false, excluded: false };
  }

  function d(from, to, type, reason) {
    return { from: from, to: to, type: type, reason: reason || '' };
  }

  /* 示例表单：员工入职信息登记（5 步，含一条填写要求冲突与一条后置依赖） */
  function sampleForm() {
    return {
      stepCount: 5,
      fields: [
        f('fullName',  '姓名',           1, 'required', 12, ''),
        f('idType',    '证件类型',       1, 'required', 8,  ''),
        f('idNo',      '证件号码',       1, 'required', 20, '格式由证件类型决定'),
        f('phone',     '手机号',         2, 'required', 12, ''),
        f('email',     '邮箱',           2, 'optional', 16, ''),
        f('emergency', '紧急联系人',     3, 'required', 10, '需要本人手机号'),
        f('emerPhone', '紧急联系人电话', 3, 'optional', 14, ''),
        f('emerEmail', '紧急联系人邮箱', 3, 'optional', 18, ''),
        f('bankName',  '开户银行',       4, 'required', 10, ''),
        f('bankCard',  '银行卡号',       5, 'required', 22, ''),
        f('contract',  '合同签署',       5, 'required', 30, '含合同条款全文'),
        f('policy',    '隐私政策确认',   5, 'required', 24, '')
      ],
      deps: [
        d('idNo',      'idType',    'same',   '证件号码格式由证件类型决定'),
        d('phone',     'fullName',  'before', '需要先登记本人基本信息'),
        d('emergency', 'phone',     'before', '紧急联系人需要本人手机号'),
        d('emerPhone', 'emergency', 'same',   '联系人与电话应同页填写'),
        d('emerEmail', 'emergency', 'same',   '必填：与联系人同页（依据 A）'),
        d('emerEmail', 'emergency', 'same',   '选填：依据 B（与依据 A 互斥）'),
        d('bankCard',  'bankName',  'before', '先选银行再填卡号'),
        d('bankCard',  'contract',  'same',   '银行信息与合同签署同页确认'),
        d('contract',  'bankName',  'before', '签署前必须先完成银行信息'),
        d('policy',    'idNo',      'before', '最终确认前需要证件号码'),
        d('policy',    'phone',     'before', '最终确认前需要手机号'),
        d('email',     'fullName',  'after',  '邮箱应在基本信息之后收集')
      ]
    };
  }

  /* ---------- 规范化：补齐字段、过滤悬空依赖、校验类型 ---------- */
  function normalize(form) {
    var warnings = [];
    var n = Math.max(1, clampInt(form.stepCount, 1, 99, 1));
    var fields = (form.fields || []).map(function (x) {
      return {
        id: String(x.id),
        label: x.label != null && x.label !== '' ? String(x.label) : String(x.id),
        step: clampInt(x.step, 1, n, 1),
        require: x.require === 'optional' ? 'optional'
               : x.require === 'hidden' ? 'hidden' : 'required',
        read: Math.max(0, Number(x.read) || 0),
        note: x.note || '',
        locked: !!x.locked,
        excluded: !!x.excluded
      };
    });
    var ids = {};
    fields.forEach(function (x) {
      if (ids[x.id]) warnings.push('字段 ID 重复：' + x.id);
      ids[x.id] = true;
    });
    var deps = [];
    (form.deps || []).forEach(function (e, i) {
      if (!ids[e.from] || !ids[e.to]) {
        warnings.push('依赖 #' + (i + 1) + ' 引用了不存在的字段，已忽略');
        return;
      }
      if (!DEP_TYPES[e.type]) {
        warnings.push('依赖 #' + (i + 1) + ' 类型非法（' + e.type + '），已忽略');
        return;
      }
      deps.push({ from: String(e.from), to: String(e.to),
                  type: e.type, reason: e.reason || '' });
    });
    return { stepCount: n, fields: fields, deps: deps, warnings: warnings };
  }

  function clampInt(v, lo, hi, dft) {
    v = Math.round(Number(v));
    if (!isFinite(v)) return dft;
    return Math.max(lo, Math.min(hi, v));
  }

  /* ---------- 并查集（同一步骤约束合并） ---------- */
  function unionFind(ids) {
    var parent = {};
    ids.forEach(function (id) { parent[id] = id; });
    return {
      find: function (x) {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
      },
      union: function (a, b) {
        a = this.find(a); b = this.find(b);
        if (a !== b) parent[b] = a;
      }
    };
  }

  /* ---------- 要求聚合：保留全部依据，冲突显式标出（不静默选一条） ----------
   * 依据来源：
   *  - 字段自身声明（declared）
   *  - 依赖理由中显式提出的“必填/选填”要求（全部依赖均保留为依据）
   * 冲突条件：
   *  - 多个依赖依据提出互斥要求；或
   *  - 字段声明为必填，但某条依据要求选填。
   */
  function aggregateRequirements(fields, deps) {
    var byField = {};
    fields.forEach(function (x) {
      byField[x.id] = {
        declared: x.require,
        effective: x.require,
        evidences: [{ source: 'declared', field: x.id,
                      demand: x.require, reason: '字段自身填写要求' }],
        conflict: null
      };
    });
    deps.forEach(function (e) {
      var demand = null;
      if (/必填|required/i.test(e.reason)) demand = 'required';
      else if (/选填|可选|optional/i.test(e.reason)) demand = 'optional';
      if (demand && byField[e.from]) {
        byField[e.from].evidences.push({
          source: 'dep', dep: e, field: e.from,
          demand: demand, reason: e.reason
        });
      }
    });
    Object.keys(byField).forEach(function (id) {
      var agg = byField[id];
      var demands = {};
      agg.evidences.forEach(function (ev) { demands[ev.demand] = true; });
      var keys = Object.keys(demands);
      var hasReq = !!demands.required;
      var hasOpt = !!demands.optional;
      if (hasReq && hasOpt) {
        agg.effective = 'required'; // 冲突时不静默降级，必填优先；冲突仍须人工解决
        agg.conflict = {
          declared: agg.declared,
          demands: keys.sort(),
          evidences: agg.evidences.slice()
        };
      } else if (hasReq) {
        agg.effective = 'required';
      }
      // hidden 仅在无必填依据时保留
      if (!hasReq && agg.declared === 'hidden') agg.effective = 'hidden';
    });
    return byField;
  }

  /* ---------- 构建组件约束图（仅参与字段；排除字段不进入） ----------
   * same 边合并组件；before/after 变为组件间不等式：
   *   step(to) >= step(from) + gap   （before: gap=1，after: gap=-1）
   * 返回组件、成员、锁与组件间有向边。
   */
  function buildGraph(norm) {
    var active = norm.fields.filter(function (x) { return !x.excluded; });
    var activeIds = active.map(function (x) { return x.id; });
    var uf = unionFind(activeIds);
    var sameEdges = [];
    norm.deps.forEach(function (e) {
      if (activeSet(active)[e.from] && activeSet(active)[e.to]) {
        if (e.type === 'same') {
          sameEdges.push(e);
          uf.union(e.from, e.to);
        }
      }
    });
    var compOf = {}, membersMap = {};
    active.forEach(function (x) {
      var r = uf.find(x.id);
      compOf[x.id] = r;
      (membersMap[r] = membersMap[r] || []).push(x.id);
    });
    var roots = Object.keys(membersMap).sort();
    var fieldById = {};
    active.forEach(function (x) { fieldById[x.id] = x; });

    // 组件锁：同组件多个锁且步骤不一致 => LOCK_LOCK 冲突（全部保留）
    var lockConflicts = [];
    var compLock = {};
    roots.forEach(function (r) {
      var locked = membersMap[r]
        .filter(function (id) { return fieldById[id].locked; })
        .map(function (id) { return { field: id, step: fieldById[id].step }; });
      var steps = {};
      locked.forEach(function (l) { steps[l.step] = true; });
      if (Object.keys(steps).length > 1) {
        lockConflicts.push({ kind: 'LOCK_LOCK', comp: r,
                             members: membersMap[r].slice(), locks: locked });
      } else if (locked.length) {
        compLock[r] = locked[0].step;
      }
    });

    // 组件间不等式边；同组件的非 same 边 => SELF 冲突
    // 方向统一编码为 step[to] >= step[from] + gap：
    //   before(from 依赖 to 在前): to->from gap=1
    //   after (from 依赖 to 在后): from->to gap=1
    var edges = [], selfConflicts = [];
    norm.deps.forEach(function (e) {
      if (e.type === 'same') return;
      if (!fieldById[e.from] || !fieldById[e.to]) return;
      var u, v;
      if (e.type === 'before') { u = e.to;   v = e.from; }
      else                     { u = e.from; v = e.to; }
      var ru = compOf[u], rv = compOf[v];
      if (ru === rv) {
        selfConflicts.push({ kind: 'SELF', dep: e,
          message: '字段“' + e.from + '”与“' + e.to + '”被同一步骤约束合并，' +
                   '却又要求处于不同步骤（' + e.reason + '）' });
      } else {
        edges.push({ from: ru, to: rv, gap: 1, dep: e });
      }
    });

    return { roots: roots, compOf: compOf, members: membersMap,
             locks: compLock, lockConflicts: lockConflicts,
             edges: edges, selfConflicts: selfConflicts,
             fieldById: fieldById, activeIds: activeIds };
  }

  function activeSet(active) {
    var s = {};
    active.forEach(function (x) { s[x.id] = true; });
    return s;
  }

  /* ---------- 上下界传播（含正环检测） ----------
   * 约束：step[v] >= step[u] + gap。
   * 下界初值：锁定组件=其锁定步骤，其余=1；上界初值=步骤数（锁定组件上界=锁定步骤）。
   * 一旦 lb > ub：产生 ORDER 冲突，保留触发边、两端组件与传播链。
   * 返回 lb/ub、每个组件的下界依据链、顺序冲突列表。
   */
  function propagateBounds(g, stepCount) {
    var lb = {}, ub = {}, chain = {};
    g.roots.forEach(function (r) {
      if (g.locks[r] != null) {
        lb[r] = g.locks[r]; ub[r] = g.locks[r];
        chain[r] = { kind: 'lock', comp: r, step: g.locks[r] };
      } else {
        lb[r] = 1; ub[r] = stepCount;
        chain[r] = { kind: 'floor', comp: r, step: 1 };
      }
    });

    var out = {};
    g.edges.forEach(function (e) {
      (out[e.from] = out[e.from] || []).push(e);
    });

    var orderConflicts = [];
    var changed = true, guard = 0;
    var maxIter = g.roots.length * g.roots.length + 2;
    while (changed && guard++ < maxIter) {
      changed = false;
      g.edges.forEach(function (e) {
        var cand = lb[e.from] + e.gap;
        if (cand > lb[e.to]) {
          var prevChain = chain[e.to];
          lb[e.to] = cand;
          chain[e.to] = { kind: 'edge', edge: e, via: chain[e.from],
                          comp: e.to, step: cand };
          changed = true;
          if (cand > ub[e.to]) {
            orderConflicts.push(buildOrderConflict(e, chain[e.from], prevChain,
                                                   lb, ub, g));
          }
        }
      });
    }
    // 正环：迭代超上限仍在增长，记录涉及的边
    if (changed) {
      orderConflicts.push({
        kind: 'ORDER_CYCLE',
        message: '依赖形成正反馈环（互相要求对方在更靠后的步骤），无可行分步',
        edges: g.edges.slice()
      });
    }

    // 锁定组件与不等式直接冲突：u->v 要求 step[v]>=step[u]+1，
    // v 锁定过低 或 u 锁定过高 都会冲突，给出精确依据
    g.edges.forEach(function (e) {
      if (g.locks[e.to] != null && lb[e.from] + 1 > g.locks[e.to]) {
        orderConflicts.push(buildLockOrderConflict(e, chain[e.from], g, 'to'));
      }
      if (g.locks[e.from] != null && g.locks[e.from] + 1 > ub[e.to]) {
        orderConflicts.push(buildLockOrderConflict(e, chain[e.from], g, 'from'));
      }
    });

    return { lb: lb, ub: ub, chain: chain, orderConflicts: orderConflicts };
  }

  function buildOrderConflict(edge, fromChain, prevChain, lb, ub, g) {
    return {
      kind: 'ORDER',
      edge: edge,
      compFrom: edge.from, compTo: edge.to,
      requiredFromMin: lb[edge.from],
      toMax: ub[edge.to],
      trail: flattenChain(fromChain),
      message: '约束链要求“' + edge.dep.from + '”至少在第 ' + lb[edge.from] +
               ' 步，进而要求“' + edge.dep.to + '”在第 ' +
               (lb[edge.from] + edge.gap) + ' 步，但该组件最晚只能在第 ' +
               ub[edge.to] + ' 步'
    };
  }

  function buildLockOrderConflict(edge, fromChain, g, side) {
    var detail = side === 'to'
      ? '“' + g.members[edge.to].join('、') + '”锁定在第 ' + g.locks[edge.to] +
        ' 步，但依赖“' + edge.dep.reason + '”要求它排在更靠后的步骤'
      : '“' + g.members[edge.from].join('、') + '”锁定在第 ' + g.locks[edge.from] +
        ' 步，但依赖“' + edge.dep.reason + '”要求它排在更靠前的步骤';
    return {
      kind: 'LOCK_EDGE',
      edge: edge,
      compFrom: edge.from, compTo: edge.to,
      lockedStep: g.locks[side] || null,
      trail: flattenChain(fromChain),
      message: detail + '，锁定与依赖冲突'
    };
  }

  function flattenChain(c) {
    var out = [];
    var seen = {};
    while (c) {
      if (seen[c.comp]) break;
      seen[c.comp] = true;
      out.unshift(c);
      c = c.via;
    }
    return out;
  }

  /* ---------- 收敛分步 ----------
   * 纯函数：输入当前字段状态，输出每个字段的“收敛后步骤”。
   * - 锁定组件保持锁定步骤；
   * - 其余组件在可行区间 [lb, ub] 内选最接近使用者偏好（成员当前步骤最大值）的值；
   * - 无可行区间（lb > ub）时退化为 lb（仍标出冲突，UI 展示不可完成）。
   * 因为完全由“锁定/排除/依赖/偏好”决定，先做若干增量操作再收敛
   * 与一次性整体重推结果相同。
   */
  function converge(norm) {
    var g = buildGraph(norm);
    var b = propagateBounds(g, norm.stepCount);
    var N = norm.stepCount;

    // 拓扑序（不等式边 u->v）；存在正环时退化为组件自然序
    var indeg = {}, adj = {};
    g.roots.forEach(function (r) { indeg[r] = 0; adj[r] = []; });
    g.edges.forEach(function (e) {
      // 去重以正确计算入度
      if (!adj[e.from].some(function (x) { return x === e.to; })) {
        adj[e.from].push(e.to); indeg[e.to]++;
      }
    });
    var queue = g.roots.filter(function (r) { return indeg[r] === 0; });
    var topo = [];
    while (queue.length) {
      var r = queue.shift();
      topo.push(r);
      adj[r].forEach(function (v) {
        if (--indeg[v] === 0) queue.push(v);
      });
    }
    if (topo.length !== g.roots.length) topo = g.roots.slice();

    // 上界收紧：ub[u] = min(ub[u], min_e(ub[v]-1))，迭代到不动点
    var ub = {};
    g.roots.forEach(function (r) {
      ub[r] = Math.min(b.ub[r], N);
    });
    var again = true;
    while (again) {
      again = false;
      g.edges.forEach(function (e) {
        var cand = ub[e.to] - 1;
        if (cand < ub[e.from]) { ub[e.from] = cand; again = true; }
      });
    }

    // 拓扑序贪心：在动态下界内取最接近偏好的值，并向后传播下界
    var lb = {};
    g.roots.forEach(function (r) { lb[r] = b.lb[r]; });
    var compStep = {};
    topo.forEach(function (r) {
      if (g.locks[r] != null) {
        compStep[r] = g.locks[r];
      } else {
        var pref = 1;
        g.members[r].forEach(function (id) {
          pref = Math.max(pref, g.fieldById[id].step);
        });
        var lo = lb[r], hi = Math.max(lb[r], ub[r]);
        var step = Math.max(lo, Math.min(pref, hi));
        compStep[r] = step;
      }
      g.edges.forEach(function (e) {
        if (e.from === r) lb[e.to] = Math.max(lb[e.to], compStep[r] + 1);
      });
    });

    // 修复传播（只移动未锁定组件；与锁定相关的不可行保留为结构冲突）：
    //  (1) before/after 通用行 u->v(step[v]>=step[u]+1)：v 被偏好压得过低 => 前移 v 并级联；
    //  (2) u 被偏好顶得过高 => 后移 u（仅当 u 未锁定）并反向级联。
    // 交替进行“前移后继 / 后移前驱”两个单调扫描，避免同轮互相回摆。
    var guard = 0, done = false;
    while (!done && guard++ < g.roots.length * 4) {
      var fwd = sweep(true), back = sweep(false);
      done = !fwd && !back;
    }
    function sweep(forward) {
      var moved = false, again = true, sg = 0;
      while (again && sg++ < g.roots.length + 1) {
        again = false;
        g.edges.forEach(function (e) {
          if (forward) {
            var need = compStep[e.from] + 1;
            if (need > compStep[e.to] && g.locks[e.to] == null) {
              compStep[e.to] = Math.min(need, norm.stepCount);
              moved = again = true;
            }
          } else if (compStep[e.from] >= compStep[e.to] && g.locks[e.from] == null) {
            compStep[e.from] = Math.max(1, compStep[e.to] - 1);
            moved = again = true;
          }
        });
      }
      return moved;
    }

    var assignment = {};
    g.roots.forEach(function (r) {
      g.members[r].forEach(function (id) { assignment[id] = compStep[r]; });
    });
    return { graph: g, bounds: b, assignment: assignment };
  }

  /* ---------- 全量分析：步骤负担、不可完成、前置未满足、冲突 ---------- */
  function analyze(form) {
    var norm = normalize(form);
    var reqAgg = aggregateRequirements(norm.fields, norm.deps);
    var conv = converge(norm); // 仅提供“建议收敛方案”，不改写当前排布
    var g = conv.graph, b = conv.bounds;
    // 指标与违规判定一律基于使用者当前排布（字段自身 step）
    var assign = {};
    norm.fields.forEach(function (x) { assign[x.id] = x.step; });

    // 前置依赖闭包：沿 before / same 语义边展开（排除字段不参与）
    var prereqOf = computePrereqClosure(norm);

    // 逐依赖检查当前排布下的违规
    var edgeChecks = norm.deps.map(function (e) {
      var fA = byId(norm.fields, e.from), fB = byId(norm.fields, e.to);
      var chk = { dep: e, status: 'ok', detail: '' };
      if (fA.excluded || fB.excluded) {
        chk.status = 'excluded';
        chk.detail = '依赖的一端已被排除：' +
          (fA.excluded ? '[' + e.from + ' 已排除]' : '') +
          (fB.excluded ? '[' + e.to + ' 已排除]' : '');
        return chk;
      }
      var sa = assign[e.from], sb = assign[e.to];
      if (e.type === 'same') {
        if (sa !== sb) {
          chk.status = 'violation';
          chk.detail = '要求同一步骤，但“' + e.from + '”在第 ' + sa +
                       ' 步、“' + e.to + '”在第 ' + sb + ' 步';
        }
      } else if (e.type === 'before') {
        if (sa <= sb) {
          chk.status = sa < sb ? 'blocked' : 'violation';
          chk.detail = '“' + e.from + '”（第 ' + sa + ' 步）要求“' + e.to +
                       '”在更靠前步骤，但后者在第 ' + sb + ' 步';
        }
      } else if (e.type === 'after') {
        if (sa >= sb) {
          chk.status = 'violation';
          chk.detail = '“' + e.from + '”（第 ' + sa + ' 步）要求“' + e.to +
                       '”在更靠后步骤，但后者目前在第 ' + sb +
                       ' 步（反而更靠前或同一步）';
        }
      }
      return chk;
    });

    // 字段级冲突汇总（要求冲突 + 结构冲突）
    var conflicts = collectConflicts(norm, g, b, reqAgg);

    // 按步聚合
    var steps = aggregateSteps(norm, assign, prereqOf, reqAgg, edgeChecks);

    return {
      norm: norm,
      assignment: assign,
      suggested: conv.assignment,
      graph: g,
      bounds: b,
      requirement: reqAgg,
      prereq: prereqOf,
      edgeChecks: edgeChecks,
      conflicts: conflicts,
      steps: steps,
      warnings: norm.warnings
    };
  }

  function byId(fields, id) {
    for (var i = 0; i < fields.length; i++)
      if (fields[i].id === id) return fields[i];
    return null;
  }

  /* 前置闭包：边 from->to 表示填写 from 前需要 to 已可用（same/before）。
   * after 边表示 to 在 from 之后，不作为填写前置。
   * 被排除的前置保留在 missing 列表中（供不可完成提示），不参与可达展开。 */
  function computePrereqClosure(norm) {
    var active = {};
    norm.fields.forEach(function (x) { if (!x.excluded) active[x.id] = x; });
    var direct = {}, missing = {};
    norm.fields.forEach(function (x) { direct[x.id] = []; missing[x.id] = []; });
    norm.deps.forEach(function (e) {
      if (!active[e.from]) return;
      if (e.type === 'same' || e.type === 'before') {
        if (active[e.to]) direct[e.from].push({ id: e.to, dep: e });
        else missing[e.from].push({ id: e.to, dep: e });
      }
    });
    var closure = {};
    norm.fields.forEach(function (x) {
      if (x.excluded) {
        closure[x.id] = { direct: [], all: [], missing: [] };
        return;
      }
      var all = {}, pathDeps = [], miss = [];
      (function walk(id, trail) {
        direct[id].forEach(function (p) {
          if (all[p.id] || p.id === x.id) return;
          all[p.id] = true;
          pathDeps.push({ id: p.id, dep: p.dep, trail: trail.slice() });
          walk(p.id, trail.concat([p.id]));
        });
        missing[id].forEach(function (p) {
          if (!all[p.id]) {
            all[p.id] = true;
            miss.push({ id: p.id, dep: p.dep, trail: trail.slice() });
          }
        });
      })(x.id, []);
      closure[x.id] = { direct: direct[x.id], all: pathDeps, missing: miss };
    });
    return closure;
  }

  /* ---------- 冲突收集：结构冲突 + 要求冲突，全部保留依据 ---------- */
  function collectConflicts(norm, g, b, reqAgg) {
    var out = [];
    g.lockConflicts.forEach(function (c) {
      out.push({ kind: c.kind, severity: 'error', locks: c.locks,
        members: c.members,
        message: '同一组件中的字段被锁定到不同步骤：' +
          c.locks.map(function (l) { return l.field + '→第' + l.step + '步'; }).join('；') });
    });
    g.selfConflicts.forEach(function (c) {
      out.push({ kind: c.kind, severity: 'error', dep: c.dep, message: c.message });
    });
    b.orderConflicts.forEach(function (c) {
      out.push({ kind: c.kind, severity: 'error', raw: c,
                 edge: c.edge, trail: c.trail, message: c.message });
    });
    Object.keys(reqAgg).forEach(function (id) {
      var agg = reqAgg[id];
      if (agg.conflict) {
        out.push({
          kind: 'REQUIREMENT', severity: 'conflict', field: id,
          declared: agg.conflict.declared,
          demands: agg.conflict.demands,
          evidences: agg.conflict.evidences,
          message: '字段“' + id + '”的填写要求存在冲突：自身声明为' +
            reqLabel(agg.conflict.declared) + '，但依据中同时要求 ' +
            agg.conflict.demands.map(reqLabel).join(' 与 ')
        });
      }
    });
    return out;
  }

  function reqLabel(r) {
    return r === 'required' ? '必填' : r === 'optional' ? '选填' : '隐藏';
  }

  /* ---------- 按步骤聚合负担指标 ---------- */
  function aggregateSteps(norm, assign, prereq, reqAgg, edgeChecks) {
    var steps = [];
    for (var s = 1; s <= norm.stepCount; s++) {
      steps.push({ step: s, fields: [], read: 0, requiredCount: 0,
                   optionalCount: 0, hiddenCount: 0,
                   blockedBy: [], unmetPrereqs: [], backRead: 0,
                   infeasible: false });
    }

    norm.fields.forEach(function (x) {
      if (x.excluded) return;
      var st = steps[assign[x.id] - 1];
      if (!st) return; // 无界冲突时 assign 可能超出范围
      st.fields.push(x.id);
      st.read += x.read;
      var eff = reqAgg[x.id].effective;
      if (eff === 'required') st.requiredCount++;
      else if (eff === 'hidden') st.hiddenCount++;
      else st.optionalCount++;
    });

    // 前置未满足 / 不可完成：逐字段沿闭包检查
    norm.fields.forEach(function (x) {
      if (x.excluded) return;
      var sx = assign[x.id], st = steps[sx - 1];
      // 前置已被排除 => 该步不可完成
      prereq[x.id].missing.forEach(function (p) {
        st.infeasible = true;
        st.blockedBy.push({
          field: x.id, prereq: p.id, kind: 'excluded', dep: p.dep,
          message: '“' + x.id + '”依赖的“' + p.id + '”已被排除'
        });
      });
      prereq[x.id].all.forEach(function (p) {
        var target = byId(norm.fields, p.id);
        if (target.excluded) {
          st.infeasible = true;
          st.blockedBy.push({
            field: x.id, prereq: p.id, kind: 'excluded',
            dep: p.dep,
            message: '“' + x.id + '”依赖的“' + p.id + '”已被排除'
          });
          return;
        }
        var sp = assign[p.id];
        if (sp > sx) {
          st.infeasible = true;
          st.blockedBy.push({
            field: x.id, prereq: p.id, kind: 'later',
            fromStep: sx, prereqStep: sp, dep: p.dep,
            message: '“' + x.id + '”（第' + sx + '步）依赖的“' + p.id +
                     '”被排到第' + sp + '步（' + p.dep.reason + '）'
          });
        } else if (sp < sx) {
          // 跨步骤回溯：必须记住早前步骤的内容
          st.unmetPrereqs.push({
            field: x.id, prereq: p.id, kind: 'earlier',
            fromStep: sx, prereqStep: sp, dep: p.dep,
            message: '“' + x.id + '”需回忆第' + sp + '步的“' + p.id +
                     '”（' + p.dep.reason + '）'
          });
          st.backRead += target.read;
        }
      });
    });

    // 违规依赖（同一步骤未满足 / after 反向）标记到所在步骤
    edgeChecks.forEach(function (chk) {
      if (chk.status === 'ok' || chk.status === 'excluded') return;
      var x = byId(norm.fields, chk.dep.from);
      var st = steps[assign[chk.dep.from] - 1];
      if (!st) return;
      if (chk.status === 'blocked') st.infeasible = true;
      st.blockedBy.push({
        field: chk.dep.from, prereq: chk.dep.to,
        kind: chk.status === 'blocked' ? 'later' : 'same',
        dep: chk.dep, status: chk.status, message: chk.detail
      });
    });

    // 负担等级（相对阈值，仅用于颜色提示）
    steps.forEach(function (st) {
      st.readLevel = level(st.read, [60, 100]);
      st.pressure = st.requiredCount * 2 + st.optionalCount;
      st.pressureLevel = level(st.pressure, [8, 14]);
      st.memoryLevel = level(st.backRead, [30, 60]);
    });
    return steps;
  }

  function level(v, t) {
    return v >= t[1] ? 'high' : v >= t[0] ? 'mid' : 'low';
  }

  /* ---------- 应用收敛：返回新的表单状态（不修改入参） ---------- */
  function applyConvergence(form) {
    var result = converge(normalize(form));
    return {
      stepCount: form.stepCount,
      fields: form.fields.map(function (x) {
        var copy = Object.assign({}, x);
        if (!x.excluded && result.assignment[x.id] != null) {
          copy.step = result.assignment[x.id];
        }
        return copy;
      }),
      deps: form.deps.map(function (e) { return Object.assign({}, e); })
    };
  }

  var api = {
    DEP_TYPES: DEP_TYPES,
    sampleForm: sampleForm,
    normalize: normalize,
    aggregateRequirements: aggregateRequirements,
    buildGraph: buildGraph,
    propagateBounds: propagateBounds,
    converge: converge,
    applyConvergence: applyConvergence,
    analyze: analyze,
    reqLabel: reqLabel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FormModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
