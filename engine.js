/* 物料-替代-成品 推导引擎：纯逻辑，浏览器与 Node 通用。
 * 数据模型 state = {
 *   materials: [{id, name, source, arrival}],
 *   subs:      [{from, to}],            // from 可用 to 替代
 *   products:  [{id, name, minOutput, ingredients:[{material, qty}]}],
 *   decisions: { [materialId]: toId }   // 用户对多分支替代链的裁决
 * } */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function matMap(state) {
    const m = new Map();
    for (const x of state.materials) m.set(x.id, x);
    return m;
  }

  function subEdges(state) {
    const g = new Map();
    for (const e of state.subs) {
      if (!g.has(e.from)) g.set(e.from, []);
      g.get(e.from).push(e.to);
    }
    return g;
  }

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  // 结构检查：从 start 可达的替代子图中，凡有环或指向不存在物料的边，一律报告，不静默跳过
  function structuralCheck(state, start) {
    const mats = matMap(state);
    const g = subEdges(state);
    const issues = [];
    const seen = new Set();
    const color = new Map(); // 1=在栈中 2=已完成
    const stack = [];
    function dfs(u) {
      color.set(u, 1);
      stack.push(u);
      for (const v of g.get(u) || []) {
        if (!mats.has(v)) {
          const d = u + ' -> ' + v + '（替代目标物料不存在）';
          if (!seen.has(d)) { seen.add(d); issues.push({ type: 'missing', detail: d }); }
          continue;
        }
        const c = color.get(v) || 0;
        if (c === 1) {
          const d = '替代环: ' + stack.slice(stack.indexOf(v)).concat(v).join(' -> ');
          if (!seen.has(d)) { seen.add(d); issues.push({ type: 'cycle', detail: d }); }
        } else if (c === 0) {
          dfs(v);
        }
      }
      stack.pop();
      color.set(u, 2);
    }
    if (mats.has(start)) dfs(start);
    return issues;
  }

  // 枚举从 start 出发的全部简单替代路径，supply 为路径上各物料到货量之和（裁决依据）
  function enumeratePaths(state, start) {
    const mats = matMap(state);
    const g = subEdges(state);
    const paths = [];
    function walk(path) {
      const last = path[path.length - 1];
      const outs = (g.get(last) || []).filter(t => mats.has(t) && path.indexOf(t) < 0);
      paths.push({ nodes: path.slice(), terminal: outs.length === 0 });
      for (const t of outs) { path.push(t); walk(path); path.pop(); }
    }
    if (mats.has(start)) walk([start]);
    for (const p of paths) {
      p.supply = p.nodes.reduce((s, id) => s + num(mats.get(id).arrival), 0);
    }
    return paths;
  }
  // 按用户裁决沿替代链行进：单出边自动跟随，多分支未裁决则停下并报告待裁决节点
  function chosenPath(state, start) {
    const mats = matMap(state);
    const g = subEdges(state);
    const path = [start];
    const pending = [];
    for (;;) {
      const last = path[path.length - 1];
      const outs = (g.get(last) || []).filter(t => mats.has(t) && path.indexOf(t) < 0);
      if (outs.length === 0) break;
      const d = state.decisions ? state.decisions[last] : null;
      if (d && outs.indexOf(d) >= 0) { path.push(d); continue; }
      if (outs.length === 1) { path.push(outs[0]); continue; }
      pending.push(last);
      break;
    }
    return { path, pending };
  }

  // 裁决依据预览：从 node 经 target 出发，之后自动跟随单出边，返回路径与合计供给
  function pathPreview(state, node, target) {
    const mats = matMap(state);
    const g = subEdges(state);
    const path = [node, target];
    for (;;) {
      const last = path[path.length - 1];
      const outs = (g.get(last) || []).filter(t => mats.has(t) && path.indexOf(t) < 0);
      if (outs.length !== 1) break;
      path.push(outs[0]);
    }
    const supply = path.reduce((s, id) => s + num(mats.get(id).arrival), 0);
    return { nodes: path, supply };
  }

  // 单个物料的供给分析：结构问题 -> untrusted；多分支未裁决 -> pending；否则给出有效供给
  function analyzeMaterial(state, id) {
    const mats = matMap(state);
    const m = mats.get(id);
    if (!m) {
      return { id, exists: false, status: 'untrusted', arrival: 0, supply: null,
        issues: [{ type: 'missing', detail: '物料 ' + id + ' 不存在' }], paths: [], chosen: null, pending: [] };
    }
    const issues = structuralCheck(state, id);
    const paths = enumeratePaths(state, id).filter(p => p.terminal);
    const res = { id, exists: true, arrival: num(m.arrival), issues, paths,
      status: 'ok', supply: null, chosen: null, pending: [] };
    if (issues.length) { res.status = 'untrusted'; return res; }
    const c = chosenPath(state, id);
    res.chosen = c.path;
    res.pending = c.pending;
    if (c.pending.length) { res.status = 'pending'; return res; }
    res.supply = c.path.reduce((s, x) => s + num(mats.get(x).arrival), 0);
    return res;
  }
  // 单个成品推导：逐项配料核对需求与有效供给，标出缺口来源物料与替代链
  function analyzeProduct(state, p, matCache) {
    const ing = [];
    let status = 'ok';
    let feasible = Infinity;
    for (const it of p.ingredients) {
      const demand = num(it.qty) * num(p.minOutput);
      let a = matCache.get(it.material);
      if (!a) { a = analyzeMaterial(state, it.material); matCache.set(it.material, a); }
      const row = { material: it.material, qty: num(it.qty), demand, supply: a.supply,
        chain: a.chosen, status: a.status, issues: a.issues, gap: 0 };
      if (a.status === 'untrusted') {
        status = 'untrusted';
      } else if (a.status === 'pending') {
        if (status === 'ok') status = 'pending';
      } else {
        row.gap = Math.max(0, demand - a.supply);
        if (row.gap > 0 && status === 'ok') status = 'shortage';
        if (row.qty > 0) feasible = Math.min(feasible, Math.floor(a.supply / row.qty));
      }
      ing.push(row);
    }
    if (status !== 'ok' && status !== 'shortage') feasible = null;
    if (feasible === Infinity) feasible = num(p.minOutput);
    return { id: p.id, name: p.name, minOutput: num(p.minOutput), status,
      feasibleOutput: feasible, ingredients: ing };
  }

  function fullAnalysis(state) {
    const matCache = new Map();
    const products = {};
    for (const p of state.products) products[p.id] = analyzeProduct(state, p, matCache);
    const materials = {};
    for (const m of state.materials) {
      materials[m.id] = matCache.get(m.id) || analyzeMaterial(state, m.id);
    }
    return { materials, products, recomputed: state.products.map(p => p.id) };
  }

  // 成品依赖的物料集合：配方直接物料 + 这些物料沿替代边可达的全部物料
  function productDeps(state, p) {
    const g = subEdges(state);
    const deps = new Set();
    const stack = [];
    for (const it of p.ingredients) { deps.add(it.material); stack.push(it.material); }
    while (stack.length) {
      const u = stack.pop();
      for (const v of g.get(u) || []) {
        if (!deps.has(v)) { deps.add(v); stack.push(v); }
      }
    }
    return deps;
  }

  // 变更物料（到货量变化、替代边源点、裁决节点）波及哪些成品
  function affectedProducts(state, changedMaterialIds) {
    const changed = new Set(changedMaterialIds);
    const out = [];
    for (const p of state.products) {
      const deps = productDeps(state, p);
      for (const d of deps) {
        if (changed.has(d)) { out.push(p.id); break; }
      }
    }
    return out;
  }

  // 增量重推：只重算受影响成品，其余沿用上次结论；结果与 fullAnalysis 一致
  function incrementalAnalysis(state, prev, changedMaterialIds) {
    if (!prev || !prev.products) return fullAnalysis(state);
    const affected = new Set(affectedProducts(state, changedMaterialIds));
    const matCache = new Map();
    const products = {};
    for (const p of state.products) {
      if (affected.has(p.id) || !prev.products[p.id]) {
        products[p.id] = analyzeProduct(state, p, matCache);
      } else {
        products[p.id] = prev.products[p.id];
      }
    }
    const materials = {};
    for (const m of state.materials) {
      materials[m.id] = matCache.get(m.id) || analyzeMaterial(state, m.id);
    }
    return { materials, products, recomputed: Array.from(affected) };
  }
  function sampleState() {
    return {
      materials: [
        { id: 'M-ST-A', name: '钢材A', source: '供应商甲', arrival: 100 },
        { id: 'M-ST-B', name: '钢材B', source: '供应商乙', arrival: 40 },
        { id: 'M-AL', name: '铝材', source: '供应商丙', arrival: 60 },
        { id: 'M-PL', name: '塑料粒子', source: '供应商丁', arrival: 30 },
        { id: 'M-EM', name: '电子模块', source: '供应商戊', arrival: 25 }
      ],
      subs: [
        { from: 'M-ST-A', to: 'M-ST-B' },
        { from: 'M-ST-A', to: 'M-AL' },
        { from: 'M-PL', to: 'M-AL' }
      ],
      products: [
        { id: 'P-CASE', name: '机箱', minOutput: 40, ingredients: [
          { material: 'M-ST-A', qty: 2 }, { material: 'M-PL', qty: 1 }] },
        { id: 'P-CTRL', name: '控制盒', minOutput: 30, ingredients: [
          { material: 'M-AL', qty: 1 }, { material: 'M-EM', qty: 1 }] },
        { id: 'P-SUPT', name: '支架', minOutput: 50, ingredients: [
          { material: 'M-ST-A', qty: 1 }] }
      ],
      decisions: {}
    };
  }

  return {
    matMap, subEdges, structuralCheck, enumeratePaths, chosenPath, pathPreview,
    analyzeMaterial, analyzeProduct, fullAnalysis,
    productDeps, affectedProducts, incrementalAnalysis, sampleState
  };
});
