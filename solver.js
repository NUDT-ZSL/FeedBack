'use strict';
/*
 * 预算推演台 · 分配求解器
 * 纯函数、确定性：相同输入必然得到相同输出，
 * 因此“锁定/排除后重新推导”与“从头完整推导”天然一致。
 * 浏览器（全局 budgetSolve）与 Node（module.exports）均可使用。
 */

var EPS = 1e-6;

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

/* Tarjan 强连通分量：返回所有处于依赖闭环中的项目 id（对象形式集合） */
function findCycleMembers(projects) {
  var byId = {};
  projects.forEach(function (p) { byId[p.id] = p; });
  var index = {}, low = {}, onStack = {}, stack = [], counter = 0, inCycle = {};
  function visit(v) {
    index[v] = low[v] = counter++;
    stack.push(v); onStack[v] = true;
    var deps = byId[v].deps || [];
    for (var i = 0; i < deps.length; i++) {
      var d = deps[i];
      if (!byId[d]) continue;
      if (index[d] === undefined) { visit(d); low[v] = Math.min(low[v], low[d]); }
      else if (onStack[d]) { low[v] = Math.min(low[v], index[d]); }
    }
    if (low[v] === index[v]) {
      var scc = [], w;
      do { w = stack.pop(); onStack[w] = false; scc.push(w); } while (w !== v);
      if (scc.length > 1 || deps.indexOf(v) >= 0) {
        scc.forEach(function (x) { inCycle[x] = true; });
      }
    }
  }
  projects.forEach(function (p) { if (index[p.id] === undefined) visit(p.id); });
  return inCycle;
}

/*
 * 同优先级层内均衡注水：等额分配，触及申请额上限的项目退出，
 * 余额在剩余项目中继续分，直至耗尽或全部足额。小额申请会先被填满，
 * 整体效果是尽量逼近各自申请额，而非按固定比例平摊。
 */
function waterFill(items, amount) {
  var rest = amount;
  var active = items.filter(function (it) { return it.p.requested - it.alloc > EPS; });
  while (rest > EPS && active.length > 0) {
    var share = rest / active.length, used = 0, next = [];
    for (var i = 0; i < active.length; i++) {
      var it = active[i];
      var need = it.p.requested - it.alloc;
      var give = Math.min(share, need);
      it.alloc += give; used += give;
      if (need - give > EPS) next.push(it);
    }
    rest -= used;
    if (used <= EPS) break;
    active = next;
  }
  return rest;
}

/*
 * 对给定可分配集合做资金分配：
 * 1) 锁定金额先行扣减；
 * 2) 未锁定项目先保最低投入；
 * 3) 余额按优先级从高到低分层，层内均衡注水逼近申请额。
 * 若最低投入之和超过可用资金，则按优先级依次保底，
 * 未保到的项目留 0，由上层标记为冲突。
 */
function allocate(projects, eligible, budget) {
  var alloc = {};
  projects.forEach(function (p) { alloc[p.id] = 0; });
  var act = projects.filter(function (p) { return eligible[p.id]; });
  var lockedSum = 0;
  act.forEach(function (p) {
    if (p.locked !== null) { alloc[p.id] = p.locked; lockedSum += p.locked; }
  });
  var open = act.filter(function (p) { return p.locked === null; })
    .sort(function (a, b) { return b.priority - a.priority || (a.id < b.id ? -1 : 1); });
  var avail = budget - lockedSum;
  var minSum = open.reduce(function (s, p) { return s + p.min; }, 0);
  if (minSum <= avail + EPS) {
    var states = {};
    open.forEach(function (p) { states[p.id] = { p: p, alloc: p.min }; });
    var tiers = {};
    open.forEach(function (p) {
      (tiers[p.priority] = tiers[p.priority] || []).push(states[p.id]);
    });
    var keys = Object.keys(tiers).map(Number).sort(function (a, b) { return b - a; });
    var rest = avail - minSum;
    for (var k = 0; k < keys.length && rest > EPS; k++) {
      rest = waterFill(tiers[keys[k]], rest);
    }
    open.forEach(function (p) { alloc[p.id] = states[p.id].alloc; });
  } else {
    var rest2 = Math.max(0, avail);
    for (var i = 0; i < open.length; i++) {
      var give = Math.min(open[i].min, rest2);
      alloc[open[i].id] = give;
      rest2 -= give;
    }
  }
  return alloc;
}

/*
 * 主求解入口。
 * 输入：{ budget, projects: [{ id, name, requested, priority, min, deps, locked, excluded }] }
 * 输出：{ budget, totalAllocated, results: [...], conflicts: [...] }
 */
function budgetSolve(input) {
  var budget = Math.max(0, Number(input.budget) || 0);
  var projects = (input.projects || []).map(function (p) {
    var requested = Math.max(0, Number(p.requested) || 0);
    return {
      id: String(p.id),
      name: p.name || String(p.id),
      requested: requested,
      priority: Number(p.priority) || 0,
      min: Math.min(Math.max(0, Number(p.min) || 0), requested),
      deps: (p.deps || []).map(String),
      locked: (p.locked === null || p.locked === undefined || p.locked === '')
        ? null : Math.max(0, Number(p.locked) || 0),
      excluded: !!p.excluded
    };
  });
  var byId = {};
  projects.forEach(function (p) { byId[p.id] = p; });

  /* 1. 依赖闭环检测 */
  var inCycle = findCycleMembers(projects);
  var cycleIds = Object.keys(inCycle);
  var conflicts = [];
  if (cycleIds.length) {
    conflicts.push({
      type: 'cycle',
      projects: cycleIds.map(function (id) { return byId[id].name; }),
      message: '前置依赖形成闭环：' +
        cycleIds.map(function (id) { return byId[id].name; }).join(' → ') +
        '。闭环内项目均无法进入可分配状态。'
    });
  }

  /*
   * 2. 可分配集合：未排除、不在闭环中，且全部前置均获足额支持。
   *    先只做“移除”迭代到不动点（每轮至少移出一个，必然收敛）；
   *    再按优先级从高到低，把前置已足额的项目逐个尝试加回——
   *    仅当加回后所有在册项目的前置仍然足额时才接受。
   *    加回只会消耗资金，被挤占拒绝的项目不会随后续加回而翻身，
   *    因此单趟扫描即可，结果自洽、确定，不会出现振荡。
   */
  var note = {}; // id -> 'deps' | 'crowd'：记录项目被阻断的原因
  function structuralOk(p) { return !p.excluded && !inCycle[p.id]; }
  function depsFunded(p, allocMap) {
    for (var j = 0; j < p.deps.length; j++) {
      var dp = byId[p.deps[j]];
      if (dp && (allocMap[dp.id] || 0) + EPS < dp.requested) return false;
    }
    return true;
  }

  var eligible = {};
  projects.forEach(function (p) { if (structuralOk(p)) eligible[p.id] = true; });
  var alloc = {};
  for (var iter = 0; iter <= projects.length + 1; iter++) {
    alloc = allocate(projects, eligible, budget);
    var dropped = false;
    projects.forEach(function (p) {
      if (eligible[p.id] && !depsFunded(p, alloc)) {
        eligible[p.id] = false;
        note[p.id] = 'deps';
        dropped = true;
      }
    });
    if (!dropped) break;
  }

  var candidates = projects
    .filter(function (p) { return structuralOk(p) && !eligible[p.id]; })
    .sort(function (a, b) { return b.priority - a.priority || (a.id < b.id ? -1 : 1); });
  for (var c = 0; c < candidates.length; c++) {
    var cp = candidates[c];
    if (!depsFunded(cp, alloc)) { note[cp.id] = 'deps'; continue; }
    eligible[cp.id] = true;
    var trial = allocate(projects, eligible, budget);
    var ok = true;
    for (var q = 0; q < projects.length; q++) {
      if (eligible[projects[q].id] && !depsFunded(projects[q], trial)) { ok = false; break; }
    }
    if (ok) {
      alloc = trial;
      delete note[cp.id];
    } else {
      eligible[cp.id] = false;
      note[cp.id] = 'crowd';
    }
  }
  alloc = allocate(projects, eligible, budget);

  /* 3. 资金类冲突：锁定超支 / 最低投入之和超过可用资金 */
  var lockedSum = 0, minSum = 0;
  projects.forEach(function (p) {
    if (!eligible[p.id]) return;
    if (p.locked !== null) lockedSum += p.locked; else minSum += p.min;
  });
  if (lockedSum > budget + EPS) {
    conflicts.push({
      type: 'locked_overflow',
      projects: projects.filter(function (p) { return eligible[p.id] && p.locked !== null; })
        .map(function (p) { return p.name; }),
      required: round2(lockedSum),
      available: budget,
      message: '锁定金额合计 ' + round2(lockedSum) + ' 已超过总资金上限 ' + round2(budget) + '。'
    });
  }
  if (minSum + lockedSum > budget + EPS) {
    var unmet = projects.filter(function (p) {
      return eligible[p.id] && p.locked === null && (alloc[p.id] || 0) + EPS < p.min;
    }).map(function (p) { return p.name; });
    conflicts.push({
      type: 'min_overflow',
      projects: unmet,
      required: round2(minSum + lockedSum),
      available: budget,
      message: '最低投入与锁定金额合计需 ' + round2(minSum + lockedSum) +
        '，超过可用资金 ' + round2(budget) + '；以下项目无法获得最低投入：' +
        (unmet.join('、') || '无') + '。'
    });
  }

  /* 4. 逐项目结果与主导约束说明 */
  var results = projects.map(function (p) {
    var amount = alloc[p.id] || 0;
    var status, constraint;
    if (p.excluded) {
      status = 'excluded'; constraint = '已被手工排除，不参与本次分配';
    } else if (inCycle[p.id]) {
      status = 'conflict'; constraint = '前置依赖形成闭环，无法进入可分配状态';
    } else if (!eligible[p.id]) {
      status = 'blocked';
      if (note[p.id] === 'crowd') {
        constraint = '若纳入本项目，其最低投入将挤占前置项目的足额支持，故不进入可分配状态';
      } else {
        var bad = p.deps.map(function (d) { return byId[d]; }).filter(function (dp) {
          return dp && (alloc[dp.id] || 0) + EPS < dp.requested;
        });
        constraint = '前置项目未获足额支持：' + (bad.map(function (dp) {
          return dp.name + '（' + round2(alloc[dp.id] || 0) + '/' + round2(dp.requested) + '）';
        }).join('、') || '前置链上游未获足额支持');
      }
    } else if (p.locked !== null) {
      status = 'locked'; constraint = '金额已手工锁定，不参与自动分配';
    } else if (amount + EPS >= p.requested) {
      status = 'full'; constraint = '已足额满足申请金额';
    } else if (amount + EPS < p.min) {
      status = 'unmet'; constraint = '可用资金不足以覆盖其最低投入（资金被更高优先级项目占用）';
    } else if (amount <= p.min + EPS) {
      status = 'partial'; constraint = '仅保住最低投入：受总资金上限与更高优先级项目挤占';
    } else {
      status = 'partial'; constraint = '受总资金上限约束，在同优先级内按缺口均衡分配';
    }
    return {
      id: p.id, name: p.name, requested: p.requested, min: p.min, priority: p.priority,
      amount: round2(amount),
      satisfaction: p.requested > EPS ? amount / p.requested : 1,
      status: status, constraint: constraint
    };
  });
  var total = results.reduce(function (s, r) { return s + r.amount; }, 0);
  return { budget: budget, results: results, conflicts: conflicts, totalAllocated: round2(total) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { solve: budgetSolve };
}
