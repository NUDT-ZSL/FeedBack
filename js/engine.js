/* ============================================================
 * 生产链推演引擎：纯逻辑，无 DOM 依赖，浏览器与 Node 通用。
 * ============================================================ */
(function (global) {
'use strict';

var EPS = 1e-9;

function createState() {
  return {
    resourceEntries: [],   // {source,id,stock}
    recipeEntries: [],     // {source,id,output:{resource,qty},inputs:[{resource,qty}],enabled,seq}
    stockOverrides: {},    // 人工修正库存：resourceId -> stock
    disabledRecipes: {},   // 人工停用：recipeId -> true
    resolved: { resources: {}, recipes: {} }, // 冲突人工裁决
    target: { resource: null, qty: 0 },
    model: null,           // buildModel 缓存
    cache: null,           // 增量重推用的逐资源缓存
    result: null,          // 最近一次推演结果
    log: []
  };
}

function addLog(state, msg) {
  state.log.unshift({ time: new Date().toLocaleTimeString(), msg: msg });
  if (state.log.length > 100) state.log.length = 100;
}

/* ---------------- 数据录入与即时校验 ---------------- */

function addResource(state, source, id, stock) {
  var loc = '来源「' + source + '」资源表第 ' + (state.resourceEntries.length + 1) + ' 条';
  id = String(id == null ? '' : id).trim();
  if (!id) return { ok: false, error: loc + '：资源标识不能为空' };
  stock = Number(stock);
  if (!isFinite(stock) || stock < 0) {
    return { ok: false, error: loc + '：资源「' + id + '」初始库存必须为非负数字，当前值「' + stock + '」' };
  }
  for (var i = 0; i < state.resourceEntries.length; i++) {
    var e = state.resourceEntries[i];
    if (e.source === source && e.id === id) {
      return { ok: false, error: loc + '：资源标识「' + id + '」与本来源第 ' + (i + 1) + ' 条重复，已拒绝' };
    }
  }
  state.resourceEntries.push({ source: source, id: id, stock: stock });
  state.model = null;
  return { ok: true };
}

function addRecipe(state, source, rec) {
  rec = rec || {};
  var loc = '来源「' + source + '」配方表第 ' + (state.recipeEntries.length + 1) + ' 条';
  var id = String(rec.id == null ? '' : rec.id).trim();
  if (!id) return { ok: false, error: loc + '：配方标识不能为空' };
  var i, e;
  for (i = 0; i < state.recipeEntries.length; i++) {
    e = state.recipeEntries[i];
    if (e.source === source && e.id === id) {
      return { ok: false, error: loc + '：配方标识「' + id + '」与本来源第 ' + (i + 1) + ' 条重复，已拒绝' };
    }
  }
  var out = rec.output || {};
  var output = { resource: String(out.resource == null ? '' : out.resource).trim(), qty: Number(out.qty) };
  if (!output.resource) return { ok: false, error: loc + '：配方「' + id + '」的产出资源不能为空' };
  if (!isFinite(output.qty) || output.qty <= 0) {
    return { ok: false, error: loc + '：配方「' + id + '」的产出用量必须为正数，当前值「' + out.qty + '」' };
  }
  var inputs = [], seen = {}, list = rec.inputs || [];
  for (i = 0; i < list.length; i++) {
    var raw = list[i] || {};
    var inp = { resource: String(raw.resource == null ? '' : raw.resource).trim(), qty: Number(raw.qty) };
    if (!inp.resource) return { ok: false, error: loc + '：配方「' + id + '」第 ' + (i + 1) + ' 项投入的资源不能为空' };
    if (!isFinite(inp.qty) || inp.qty <= 0) {
      return { ok: false, error: loc + '：配方「' + id + '」投入「' + inp.resource + '」的用量必须为正数，当前值「' + raw.qty + '」' };
    }
    if (seen[inp.resource]) return { ok: false, error: loc + '：配方「' + id + '」投入「' + inp.resource + '」重复出现' };
    seen[inp.resource] = true;
    inputs.push(inp);
  }
  state.recipeEntries.push({
    source: source, id: id, output: output, inputs: inputs,
    enabled: rec.enabled !== false, seq: state.recipeEntries.length
  });
  state.model = null;
  return { ok: true };
}

function loadDataset(state, source, data) {
  var errors = [];
  (data.resources || []).forEach(function (r) {
    var res = addResource(state, source, r.id, r.stock);
    if (!res.ok) errors.push(res.error);
  });
  (data.recipes || []).forEach(function (r) {
    var res = addRecipe(state, source, r);
    if (!res.ok) errors.push(res.error);
  });
  return { ok: errors.length === 0, errors: errors };
}
/* ---------------- 模型构建：多来源合并 / 冲突 / 引用与环校验 ---------------- */

// 缺失资源的涉及链条：缺失资源 → 引用它的配方 → 产物 → 下游消费配方 …
function chainText(recipes, missingRes, fromRid) {
  var parts = ['资源「' + missingRes + '」(缺失)', '配方「' + fromRid + '」'];
  var cur = recipes[fromRid] ? recipes[fromRid].output.resource : null;
  for (var guard = 0; cur && guard < 10; guard++) {
    parts.push('资源「' + cur + '」');
    var consumer = null;
    for (var id in recipes) {
      if (recipes[id].inputs.some(function (i) { return i.resource === cur; })) { consumer = id; break; }
    }
    if (!consumer) break;
    parts.push('配方「' + consumer + '」');
    cur = recipes[consumer].output.resource;
  }
  return parts.join(' → ');
}

function buildModel(state) {
  if (state.model) return state.model;
  var errors = [], conflicts = [], resources = {}, recipes = {};

  // 资源：按标识合并各来源；库存不一致时保留双方并记冲突，未裁决前临时取最小值
  var rById = {};
  state.resourceEntries.forEach(function (e) { (rById[e.id] = rById[e.id] || []).push(e); });
  Object.keys(rById).forEach(function (id) {
    var values = rById[id].map(function (e) { return { source: e.source, stock: e.stock }; });
    var distinct = [];
    values.forEach(function (v) { if (distinct.indexOf(v.stock) < 0) distinct.push(v.stock); });
    var conflict = distinct.length > 1;
    var tentative = false, stock;
    if (id in state.stockOverrides) stock = state.stockOverrides[id];
    else if (id in state.resolved.resources) stock = state.resolved.resources[id];
    else { stock = conflict ? Math.min.apply(null, distinct) : distinct[0]; tentative = conflict; }
    if (conflict) conflicts.push({ kind: 'resource-stock', id: id, values: values, tentative: tentative });
    resources[id] = {
      id: id, stock: stock, values: values, conflict: conflict, tentative: tentative,
      overridden: id in state.stockOverrides, resolvedByUser: id in state.resolved.resources
    };
  });

  // 配方：按标识合并；定义不一致时保留各变体并记冲突，未裁决前临时用首个变体
  var pById = {};
  state.recipeEntries.forEach(function (e) { (pById[e.id] = pById[e.id] || []).push(e); });
  Object.keys(pById).forEach(function (id) {
    var variants = [];
    pById[id].forEach(function (e) {
      var sig = JSON.stringify({ o: e.output, i: e.inputs });
      for (var i = 0; i < variants.length; i++) if (variants[i].sig === sig) return;
      variants.push({ sig: sig, source: e.source, output: e.output, inputs: e.inputs, enabled: e.enabled, seq: e.seq });
    });
    var conflict = variants.length > 1;
    var idx = state.resolved.recipes[id] != null ? state.resolved.recipes[id] : 0;
    if (idx >= variants.length) idx = 0;
    var eff = variants[idx];
    if (conflict) conflicts.push({ kind: 'recipe-def', id: id, variants: variants, tentative: !(id in state.resolved.recipes) });
    recipes[id] = {
      id: id, output: eff.output, inputs: eff.inputs,
      enabled: eff.enabled && !state.disabledRecipes[id],
      conflict: conflict, variants: variants, seq: eff.seq
    };
  });

  // 引用不存在的资源：拒绝该配方并给出涉及链条
  var valid = {};
  Object.keys(recipes).forEach(function (id) {
    var r = recipes[id], missing = [];
    r.inputs.forEach(function (inp) { if (!resources[inp.resource]) missing.push(inp.resource); });
    if (!resources[r.output.resource]) missing.push(r.output.resource);
    if (missing.length) {
      missing.forEach(function (m) {
        errors.push('配方「' + id + '」引用不存在的资源「' + m + '」，已拒绝。涉及链条：' + chainText(recipes, m, id));
      });
      r.invalid = true;
    } else {
      valid[id] = r;
    }
  });

  // 循环依赖检测：成环配方整环拒绝并给出环链
  var producersOf = {};
  Object.keys(valid).forEach(function (id) {
    var o = valid[id].output.resource;
    (producersOf[o] = producersOf[o] || []).push(id);
  });
  var color = {}, cyclic = {}, cycleSeen = {};
  function dfs(rid, stack) {
    color[rid] = 1; stack.push(rid);
    var rec = valid[rid];
    for (var i = 0; i < rec.inputs.length; i++) {
      var prods = producersOf[rec.inputs[i].resource] || [];
      for (var j = 0; j < prods.length; j++) {
        var pid = prods[j];
        if (color[pid] === 1) {
          var cyc = stack.slice(stack.indexOf(pid)).concat([pid]);
          var key = cyc.slice().sort().join('|');
          if (!cycleSeen[key]) {
            cycleSeen[key] = true;
            errors.push('检测到循环依赖，整环已拒绝：' + cyc.map(function (c) {
              return '配方「' + c + '」(产出 ' + valid[c].output.resource + ')';
            }).join(' → '));
          }
          cyc.forEach(function (c) { cyclic[c] = true; });
        } else if (!color[pid]) {
          dfs(pid, stack);
        }
      }
    }
    stack.pop(); color[rid] = 2;
  }
  Object.keys(valid).forEach(function (id) { if (!color[id]) dfs(id, []); });
  Object.keys(cyclic).forEach(function (id) { if (valid[id]) { valid[id].cyclic = true; delete valid[id]; } });

  state.model = { resources: resources, recipes: recipes, valid: valid, errors: errors, conflicts: conflicts };
  return state.model;
}
/* ---------------- 推演核心：全量与增量共用同一套节点求值 ---------------- */

function emptyVals() { return { req: 0, produceNeed: 0, produced: 0, supply: 0, shortage: 0, plan: {} }; }

function valsChanged(a, b) {
  function d(x, y) { return Math.abs(x - y) > EPS; }
  if (d(a.req, b.req) || d(a.produceNeed, b.produceNeed) || d(a.produced, b.produced) ||
      d(a.supply, b.supply) || d(a.shortage, b.shortage)) return true;
  var ka = Object.keys(a.plan), kb = Object.keys(b.plan);
  if (ka.length !== kb.length) return true;
  for (var i = 0; i < ka.length; i++) {
    var k = ka[i];
    if (b.plan[k] == null || d(a.plan[k], b.plan[k])) return true;
  }
  return false;
}

/* 不动点推演。seeds 为 null 表示全量；否则只从受影响资源出发沿依赖双向扩散，
 * 未被波及的节点沿用缓存值，从而实现只重推受影响资源。 */
function compute(model, target, seeds, cache) {
  var tRes = target.resource;
  var producers = {}, consumers = {};
  Object.keys(model.valid).forEach(function (id) {
    var r = model.valid[id];
    if (!r.enabled) return;
    (producers[r.output.resource] = producers[r.output.resource] || []).push(r);
    r.inputs.forEach(function (inp) {
      (consumers[inp.resource] = consumers[inp.resource] || []).push({ recipe: r, qty: inp.qty });
    });
  });
  Object.keys(producers).forEach(function (res) {
    producers[res].sort(function (a, b) { return a.seq - b.seq; });
  });

  // 层级：从目标沿启用配方的投入方向逐级向下
  var level = {};
  if (tRes && model.resources[tRes]) {
    level[tRes] = 0;
    var q = [tRes];
    while (q.length) {
      var cur = q.shift();
      (producers[cur] || []).forEach(function (rec) {
        rec.inputs.forEach(function (inp) {
          if (level[inp.resource] == null) { level[inp.resource] = level[cur] + 1; q.push(inp.resource); }
        });
      });
    }
  }
  var nodes = Object.keys(model.resources).filter(function (id) { return level[id] != null; });

  var vals = {};
  nodes.forEach(function (id) {
    var c = cache && cache[id];
    vals[id] = c ? { req: c.req, produceNeed: c.produceNeed, produced: c.produced,
                     supply: c.supply, shortage: c.shortage, plan: Object.assign({}, c.plan) }
                 : emptyVals();
  });

  function evalNode(r) {
    var req = (r === tRes) ? target.qty : 0;
    (consumers[r] || []).forEach(function (c) {
      var cv = vals[c.recipe.output.resource];
      var runs = cv && cv.plan ? (cv.plan[c.recipe.id] || 0) : 0;
      req += runs * c.qty;
    });
    var stock = model.resources[r].stock;
    var produceNeed = Math.max(0, req - stock);
    var prods = producers[r] || [];
    function capOf(rec) {
      var cap = Infinity;
      rec.inputs.forEach(function (inp) {
        var iv = vals[inp.resource];
        var s = iv ? iv.supply : (model.resources[inp.resource] ? model.resources[inp.resource].stock : 0);
        cap = Math.min(cap, s / inp.qty);
      });
      return cap;
    }
    // 需求侧：产出需求优先压给主配方，产能不足依次转替代配方；
    // 仍不足的部分压回主配方，让缺口沿其上游链条暴露出来。
    var rem = produceNeed, plan = {};
    prods.forEach(function (rec) {
      if (rem <= EPS) return;
      var dr = Math.min(rem / rec.output.qty, capOf(rec));
      if (dr > EPS) { plan[rec.id] = dr; rem -= dr * rec.output.qty; }
    });
    if (rem > EPS && prods.length) {
      var p0 = prods[0];
      plan[p0.id] = (plan[p0.id] || 0) + rem / p0.output.qty;
    }
    // 供给侧：实际产出受投入供给约束，缺口不得当作已满足。
    var produced = 0;
    prods.forEach(function (rec) {
      var runs = Math.min(plan[rec.id] || 0, capOf(rec));
      if (runs > EPS) produced += runs * rec.output.qty;
    });
    var supply = stock + produced;
    return { req: req, produceNeed: produceNeed, produced: produced, supply: supply,
             shortage: Math.max(0, req - supply), plan: plan };
  }

  var worklist = seeds ? seeds.filter(function (s) { return level[s] != null; }) : nodes.slice();
  var inQ = {};
  worklist.forEach(function (s) { inQ[s] = true; });
  var recomputed = {}, guard = 0, maxGuard = nodes.length * 30 + 200;
  while (worklist.length && guard++ < maxGuard) {
    var r = worklist.shift(); inQ[r] = false;
    var nv = evalNode(r);
    if (valsChanged(vals[r], nv)) {
      vals[r] = nv; recomputed[r] = true;
      (consumers[r] || []).forEach(function (c) {
        var o = c.recipe.output.resource;
        if (level[o] != null && !inQ[o]) { worklist.push(o); inQ[o] = true; }
      });
      (producers[r] || []).forEach(function (rec) {
        rec.inputs.forEach(function (inp) {
          if (level[inp.resource] != null && !inQ[inp.resource]) { worklist.push(inp.resource); inQ[inp.resource] = true; }
        });
      });
    }
  }
  return { vals: vals, level: level, nodes: nodes, recomputed: recomputed,
           producers: producers, consumers: consumers };
}

/* 执行推演并强制校验：增量结果必须与从头全量重推完全一致，否则回退全量。 */
function runRecompute(state, seeds, modeLabel) {
  var model = buildModel(state);
  var out = compute(model, state.target, seeds, seeds ? state.cache : null);
  var full = compute(model, state.target, null, null);
  var consistent = true, diffs = [];
  full.nodes.forEach(function (id) {
    if (valsChanged(full.vals[id], out.vals[id] || emptyVals())) { consistent = false; diffs.push(id); }
  });
  if (seeds && !consistent) {
    out = full;
    addLog(state, '增量重推与全量结果不一致（涉及：' + diffs.join('、') + '），已回退为全量结果');
  }
  out.mode = modeLabel;
  out.consistent = consistent;
  state.cache = out.vals;
  state.result = out;
  return out;
}
/* ---------------- 视图组装与操作入口 ---------------- */

function getView(state) {
  var model = buildModel(state);
  var r = state.result || runRecompute(state, null, '全量');
  var tq = state.target.qty;
  var rows = r.nodes.map(function (id) {
    var v = r.vals[id], res = model.resources[id];
    var consumers = (r.consumers[id] || []).map(function (c) {
      var cv = r.vals[c.recipe.output.resource];
      var runs = cv && cv.plan ? (cv.plan[c.recipe.id] || 0) : 0;
      return { recipe: c.recipe.id, output: c.recipe.output.resource, qty: c.qty,
               outQty: c.recipe.output.qty, demand: runs * c.qty,
               edgeMult: c.qty / c.recipe.output.qty };
    }).filter(function (c) { return c.demand > EPS; });
    var prods = (r.producers[id] || []).map(function (rec) { return rec.id; });
    return {
      id: id, level: r.level[id], stock: res.stock, req: v.req, produceNeed: v.produceNeed,
      produced: v.produced, supply: v.supply, shortage: v.shortage,
      cumMult: tq > 0 ? v.req / tq : 0,
      conflict: res.conflict, tentative: res.tentative, overridden: res.overridden,
      producers: prods, consumers: consumers,
      rootCause: v.shortage > EPS && prods.length === 0
    };
  });
  rows.sort(function (a, b) { return a.level - b.level || (a.id < b.id ? -1 : 1); });
  var firstShortLevel = null, rootCauses = [];
  rows.forEach(function (row) {
    if (row.shortage > EPS) {
      if (firstShortLevel == null || row.level < firstShortLevel) firstShortLevel = row.level;
      if (row.rootCause) rootCauses.push(row.id);
    }
  });
  return {
    rows: rows, firstShortLevel: firstShortLevel, rootCauses: rootCauses,
    errors: model.errors, conflicts: model.conflicts,
    resources: model.resources, recipes: model.recipes,
    meta: { mode: r.mode, recomputed: Object.keys(r.recomputed).length,
            total: r.nodes.length, consistent: r.consistent },
    target: state.target
  };
}

function setTarget(state, resource, qty) {
  qty = Number(qty);
  if (!isFinite(qty) || qty < 0) return { ok: false, error: '目标数量必须为非负数字，当前值「' + qty + '」' };
  var model = buildModel(state);
  if (!model.resources[resource]) return { ok: false, error: '目标产物「' + resource + '」不存在' };
  state.target = { resource: resource, qty: qty };
  runRecompute(state, null, '全量');
  return { ok: true };
}

function setStock(state, id, stock) {
  stock = Number(stock);
  if (!isFinite(stock) || stock < 0) return { ok: false, error: '库存必须为非负数字，当前值「' + stock + '」' };
  var model = buildModel(state);
  if (!model.resources[id]) return { ok: false, error: '资源「' + id + '」不存在' };
  state.stockOverrides[id] = stock;
  state.model = null;
  runRecompute(state, [id], '增量');
  addLog(state, '资源「' + id + '」库存修正为 ' + stock + '：增量重推 ' +
    Object.keys(state.result.recomputed).length + '/' + state.result.nodes.length +
    ' 个节点，与全量重推一致 ✓');
  return { ok: true };
}

function setRecipeEnabled(state, id, enabled) {
  var model = buildModel(state);
  if (!model.recipes[id]) return { ok: false, error: '配方「' + id + '」不存在' };
  if (enabled) delete state.disabledRecipes[id]; else state.disabledRecipes[id] = true;
  state.model = null;
  // 种子 = 产物 + 全部投入（投入的需求来源于该配方，必须一并重推）
  var rec = buildModel(state).recipes[id];
  var seeds = [rec.output.resource].concat(rec.inputs.map(function (i) { return i.resource; }));
  runRecompute(state, seeds, '增量');
  addLog(state, '配方「' + id + '」已' + (enabled ? '启用' : '停用') + '：增量重推 ' +
    Object.keys(state.result.recomputed).length + '/' + state.result.nodes.length +
    ' 个节点，与全量重推一致 ✓');
  return { ok: true };
}

function resolveConflict(state, kind, id, choice) {
  if (kind === 'resource-stock') {
    state.resolved.resources[id] = Number(choice);
    state.model = null;
    runRecompute(state, [id], '增量');
  } else if (kind === 'recipe-def') {
    state.resolved.recipes[id] = Number(choice);
    state.model = null;
    var model = buildModel(state);
    var rec2 = model.recipes[id];
    var seeds2 = [rec2.output.resource];
    rec2.variants.forEach(function (v) {
      v.inputs.forEach(function (i) { if (seeds2.indexOf(i.resource) < 0) seeds2.push(i.resource); });
    });
    runRecompute(state, seeds2, '增量');
  } else {
    return { ok: false, error: '未知冲突类型「' + kind + '」' };
  }
  addLog(state, '冲突「' + id + '」已人工裁决，下游已重推');
  return { ok: true };
}
/* ---------------- 持久化与示例数据 ---------------- */

function serialize(state) {
  return JSON.stringify({
    resourceEntries: state.resourceEntries, recipeEntries: state.recipeEntries,
    stockOverrides: state.stockOverrides, disabledRecipes: state.disabledRecipes,
    resolved: state.resolved, target: state.target, log: state.log
  });
}

function restore(state, json) {
  try {
    var d = JSON.parse(json);
    state.resourceEntries = d.resourceEntries || [];
    state.recipeEntries = d.recipeEntries || [];
    state.stockOverrides = d.stockOverrides || {};
    state.disabledRecipes = d.disabledRecipes || {};
    state.resolved = d.resolved || { resources: {}, recipes: {} };
    state.target = d.target || { resource: null, qty: 0 };
    state.log = d.log || [];
    state.model = null; state.cache = null; state.result = null;
    return true;
  } catch (e) { return false; }
}

function clearAll(state) {
  var s = createState();
  for (var k in s) state[k] = s[k];
}

var SAMPLE = {
  resources: [
    { id: '芯片', stock: 100 }, { id: '电路板', stock: 50 },
    { id: '外壳', stock: 80 }, { id: '螺丝', stock: 500 },
    { id: '包装箱', stock: 200 }, { id: '主机', stock: 10 }, { id: '套件', stock: 0 }
  ],
  recipes: [
    { id: 'R-BOARD', output: { resource: '电路板', qty: 1 }, inputs: [{ resource: '芯片', qty: 2 }] },
    { id: 'R-ASSY', output: { resource: '主机', qty: 1 }, inputs: [
      { resource: '电路板', qty: 1 }, { resource: '外壳', qty: 1 }, { resource: '螺丝', qty: 4 }] },
    { id: 'R-KIT', output: { resource: '套件', qty: 1 }, inputs: [
      { resource: '主机', qty: 1 }, { resource: '包装箱', qty: 1 }] }
  ]
};

// 第二来源：包含库存冲突、配方定义冲突、循环依赖与缺失引用，用于演示
var CONFLICT = {
  resources: [
    { id: '芯片', stock: 140 },
    { id: '螺丝', stock: 500 },
    { id: '包装箱', stock: 150 }
  ],
  recipes: [
    { id: 'R-ASSY', output: { resource: '主机', qty: 1 }, inputs: [
      { resource: '电路板', qty: 1 }, { resource: '外壳', qty: 1 }, { resource: '螺丝', qty: 6 }] },
    { id: 'R-RETRO', output: { resource: '芯片', qty: 1 }, inputs: [{ resource: '电路板', qty: 1 }] },
    { id: 'R-GHOST', output: { resource: '主机', qty: 1 }, inputs: [{ resource: '显卡', qty: 1 }] }
  ]
};

var Engine = {
  createState: createState, addLog: addLog,
  addResource: addResource, addRecipe: addRecipe, loadDataset: loadDataset,
  buildModel: buildModel, getView: getView, runRecompute: runRecompute,
  setTarget: setTarget, setStock: setStock, setRecipeEnabled: setRecipeEnabled,
  resolveConflict: resolveConflict,
  serialize: serialize, restore: restore, clearAll: clearAll,
  SAMPLE: SAMPLE, CONFLICT: CONFLICT
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
global.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
