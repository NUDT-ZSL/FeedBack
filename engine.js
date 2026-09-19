(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProductionEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const r6 = (v) => num(v) ? Math.round(v * 1e6) / 1e6 : v;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const key = (v) => JSON.stringify(v, Object.keys(v).sort());
  const fail = (code, location, message, extra = {}) => Object.assign({ code, location, message }, extra);

  function normalizeModel(input = {}) {
    return {
      resources: (input.resources || []).map((r) => ({
        id: String(r.id || "").trim(), name: r.name || r.id || "", initialStock: r.initialStock,
        source: r.source || "manual"
      })),
      recipes: (input.recipes || []).map((p) => ({
        id: String(p.id || "").trim(), name: p.name || p.id || "",
        outputId: String(p.outputId || p.output || "").trim(), outputQty: p.outputQty,
        enabled: p.enabled !== false, source: p.source || "manual",
        inputs: (p.inputs || []).map((x) => ({
          resourceId: String(x.resourceId || x.id || "").trim(), qty: x.qty,
          source: x.source || p.source || "manual"
        }))
      })),
      conflicts: input.conflicts || []
    };
  }

  function validateModel(input) {
    const model = normalizeModel(input), errors = [], resources = new Map(), firstRecipe = new Map();
    model.resources.forEach((r, i) => {
      const location = `资源第 ${i + 1} 行（id=${r.id || "<空>"}，来源=${r.source}）`;
      if (!r.id) errors.push(fail("EMPTY_RESOURCE_ID", location, "资源唯一标识不能为空"));
      if (!num(r.initialStock) || r.initialStock < 0)
        errors.push(fail("INVALID_STOCK", location, "初始库存必须是非负数字", { value: r.initialStock }));
      if (resources.has(r.id) && resources.get(r.id).source === r.source)
        errors.push(fail("DUPLICATE_RESOURCE_ID", location,
          `资源标识 ${r.id} 在同一来源内重复；首次位置：${resources.get(r.id).location}`));
      if (!resources.has(r.id)) resources.set(r.id, { ...r, location });
    });
    model.recipes.forEach((p, i) => {
      const location = `配方第 ${i + 1} 行（id=${p.id || "<空>"}，来源=${p.source}）`;
      if (!p.id) errors.push(fail("EMPTY_RECIPE_ID", location, "配方唯一标识不能为空"));
      if (!p.outputId) errors.push(fail("EMPTY_OUTPUT", location, "配方缺少产出资源"));
      if (p.outputId && !resources.has(p.outputId))
        errors.push(fail("UNKNOWN_OUTPUT", location, `配方引用不存在的产出资源：${p.outputId}`,
          { resourceId: p.outputId, chain: [p.id, p.outputId] }));
      if (!num(p.outputQty) || p.outputQty <= 0)
        errors.push(fail("INVALID_OUTPUT_QTY", location, "配方产出用量必须是正数", { value: p.outputQty }));
      if (!p.inputs.length) errors.push(fail("NO_INPUTS", location, "配方至少需要一个投入"));
      const seen = new Set();
      p.inputs.forEach((x, j) => {
        const where = `${location} > 投入第 ${j + 1} 项`;
        if (!x.resourceId) errors.push(fail("EMPTY_INPUT", where, "投入资源标识不能为空"));
        if (x.resourceId && !resources.has(x.resourceId))
          errors.push(fail("UNKNOWN_INPUT", where, `配方引用不存在的投入资源：${x.resourceId}`,
            { resourceId: x.resourceId, chain: [p.id, x.resourceId] }));
        if (!num(x.qty) || x.qty <= 0)
          errors.push(fail("INVALID_INPUT_QTY", where, "投入用量必须是正数", { value: x.qty }));
        const k = `${x.resourceId}@${x.source}`;
        if (seen.has(k)) errors.push(fail("DUPLICATE_INPUT", where, `配方 ${p.id} 的投入 ${x.resourceId} 重复`));
        seen.add(k);
      });
      if (firstRecipe.has(p.id) && firstRecipe.get(p.id).source === p.source)
        errors.push(fail("DUPLICATE_RECIPE_ID", location,
          `配方标识 ${p.id} 在同一来源内重复；首次位置：${firstRecipe.get(p.id).location}`));
      if (!firstRecipe.has(p.id)) firstRecipe.set(p.id, { ...p, location });
    });
    if (!errors.some((e) => e.code === "CYCLE")) {
      const edges = new Map();
      model.recipes.forEach((p) => {
        if (!edges.has(p.outputId)) edges.set(p.outputId, []);
        p.inputs.forEach((x) => edges.get(p.outputId).push({ to: x.resourceId, recipe: p.id }));
      });
      const color = new Map(), stack = [];
      let cycle = null;
      function visit(id) {
        color.set(id, 1); stack.push(id);
        for (const edge of edges.get(id) || []) {
          if (cycle) return;
          if (color.get(edge.to) === 1) {
            const nodes = stack.slice(stack.indexOf(edge.to)).concat(edge.to), lines = [];
            for (let i = 0; i < nodes.length - 1; i++) {
              const used = edges.get(nodes[i]).find((x) => x.to === nodes[i + 1]);
              lines.push(`${nodes[i]} --[${used.recipe}]--> ${nodes[i + 1]}`);
            }
            cycle = fail("CYCLE", lines.join("，"), "生产依赖不能成环", { chain: nodes, recipeChain: lines });
          } else if (!color.has(edge.to)) visit(edge.to);
        }
        stack.pop(); color.set(id, 2);
      }
      model.resources.forEach((r) => { if (!cycle && !color.has(r.id)) visit(r.id); });
      if (cycle) errors.push(cycle);
    }
    return { model, valid: errors.length === 0, errors };
  }

  function buildConflicts(input) {
    const checked = validateModel(input), conflicts = [];
    const resourceClaims = new Map();
    checked.model.resources.forEach((r, i) => {
      if (!r.id) return;
      if (!resourceClaims.has(r.id)) resourceClaims.set(r.id, []);
      resourceClaims.get(r.id).push({ source: r.source, initialStock: r.initialStock,
        location: `资源第 ${i + 1} 行` });
    });
    resourceClaims.forEach((claims, id) => {
      const unique = claims.filter((c, i) => !claims.slice(0, i)
        .some((o) => o.source === c.source && Number(o.initialStock) === Number(c.initialStock)));
      if (new Set(unique.map((x) => Number(x.initialStock))).size > 1)
        conflicts.push({ id: `resource:${id}`, kind: "resource", resourceId: id,
          message: `资源 ${id} 库存矛盾：` +
            unique.map((x) => `${x.source}=${r6(x.initialStock)}（${x.location}）`).join("，"),
          claims: unique, resolution: null });
    });
    const recipeClaims = new Map();
    checked.model.recipes.forEach((p, i) => {
      if (!p.id) return;
      if (!recipeClaims.has(p.id)) recipeClaims.set(p.id, []);
      recipeClaims.get(p.id).push({ recipe: p, location: `配方第 ${i + 1} 行` });
    });
    recipeClaims.forEach((claims, id) => {
      const signatures = claims.map(({ recipe }) => key({
        outputId: recipe.outputId, outputQty: recipe.outputQty,
        inputs: recipe.inputs.map((x) => [x.resourceId, x.qty]).sort()
      }));
      if (new Set(signatures).size > 1)
        conflicts.push({ id: `recipe:${id}`, kind: "recipe", recipeId: id,
          message: `配方 ${id} 的产出或用量矛盾，已保留双方并暂停该配方。`,
          claims: claims.map((x) => ({ source: x.recipe.source, location: x.location,
            outputId: x.recipe.outputId, outputQty: x.recipe.outputQty, inputs: x.recipe.inputs })),
          resolution: null });
    });
    (checked.model.conflicts || []).forEach((saved) => {
      const current = conflicts.find((x) => x.id === saved.id);
      if (current && saved.resolution) current.resolution = clone(saved.resolution);
    });
    return Object.assign(checked, { conflicts,
      conflictedResources: new Set(conflicts.filter((x) => x.kind === "resource" && !x.resolution)
        .map((x) => x.resourceId)),
      conflictedRecipes: new Set(conflicts.filter((x) => x.kind === "recipe" && !x.resolution)
        .map((x) => x.recipeId)) });
  }

  function affectedResources(input, change) {
    const checked = buildConflicts(input), downstream = new Map();
    checked.model.recipes.forEach((p) => p.inputs.forEach((x) => {
      if (!downstream.has(x.resourceId)) downstream.set(x.resourceId, new Set());
      downstream.get(x.resourceId).add(p.outputId);
    }));
    const seeds = new Set(change.resourceIds || []);
    if (change.recipeId) {
      const p = checked.model.recipes.find((x) => x.id === change.recipeId);
      if (p) {
        seeds.add(p.outputId);
      }
    }
    const affected = new Set(), queue = [...seeds];
    while (queue.length) {
      const current = queue.shift();
      if (affected.has(current)) continue;
      affected.add(current);
      [...(downstream.get(current) || [])].forEach((x) => queue.push(x));
    }
    return { affected, seeds, reason: change.reason || "本地修正", recipeId: change.recipeId || null };
  }

  function project(input, request, runtime = {}) {
    const checked = buildConflicts(input);
    if (!checked.valid)
      return { feasible: false, validationErrors: checked.errors, conflicts: checked.conflicts,
        levels: [], groups: [], production: [], alternativesTried: [] };
    const targetQty = Number(request.targetQty);
    if (!num(targetQty) || targetQty <= 0)
      return { feasible: false, validationErrors: [fail("INVALID_TARGET", "目标产出量", "目标产出量必须是正数")] };
    const resourceMap = new Map(checked.model.resources.map((x) => [x.id, x]));
    const producers = new Map(checked.model.resources.map((x) => [x.id, []]));
    checked.model.recipes.forEach((p) => {
      if (p.enabled && !checked.conflictedRecipes.has(p.id)) producers.get(p.outputId).push(p);
    });
    const state = { used: new Map(), groups: [], production: [], attempts: [],
      affected: runtime.affected || null, cache: runtime.cache || new Map(), hits: [], rejects: [] };
    function nodeKey(n) {
      return key({ resourceId: n.resourceId, requested: n.requested,
        recipeId: n.recipeId, parentResourceId: n.parentResourceId });
    }
    function snapshot() {
      return { used: new Map(state.used), groups: state.groups.map(clone),
        production: state.production.map(clone) };
    }
    function restore(s) {
      state.used = new Map(s.used); state.groups = s.groups.map(clone);
      state.production = s.production.map(clone);
    }
    function addNode(n) {
      let g = state.groups.find((x) => x.level === n.level && x.resourceId === n.resourceId);
      if (!g) {
        g = { level: n.level, resourceId: n.resourceId, requested: 0, sources: [], nodes: [], amplification: 0 };
        state.groups.push(g);
      }
      const item = clone(n);
      item.id = `${g.resourceId}-${g.nodes.length + 1}`;
      g.nodes.push(item);
      g.sources.push(...clone(n.sources || []));
      g.requested = r6(g.requested + n.requested);
      g.amplification = r6(g.requested / targetQty);
    }

    function entryTouchesAffected(entry) {
      if (!state.affected) return true;
      return (entry.groups || []).some((item) => state.affected.has(item.resourceId));
    }

    function satisfy(n, chain) {
      const k = nodeKey(n);
      if (state.affected && !state.affected.has(n.resourceId) && state.cache.has(k)) {
        const cached = state.cache.get(k);
        const subtreeResourceIds = new Set(cached.groups.map((item) => item.resourceId));
        const sameStart = cached.startMap &&
          [...cached.startMap.keys()].filter((id) => subtreeResourceIds.has(id))
            .every((id) => r6(cached.startMap.get(id)) === r6(state.used.get(id) || 0));
        if (sameStart && cached.feasible) {
          cached.groups.forEach(addNode);
          cached.production.forEach((x) => state.production.push(clone(x)));
          cached.usedMap.forEach((value, id) =>
            state.used.set(id, r6((state.used.get(id) || 0) + value)));
          state.hits.push({ resourceId: n.resourceId, level: n.level, requested: n.requested });
          return { feasible: true };
        }
        state.rejects.push({ resourceId: n.resourceId, sameStart: Boolean(sameStart) });
      }
      const startMap = new Map(state.used);
      const start = snapshot();
      addNode(n);
      if (!resourceMap.has(n.resourceId))
        return failed(n.level, n.resourceId, "引用的资源不存在", chain);
      if (checked.conflictedResources.has(n.resourceId))
        return failed(n.level, n.resourceId, "存在未解决库存冲突，不能任选一个库存继续推演", chain);
      const stock = Number(resourceMap.get(n.resourceId).initialStock);
      const usedBefore = state.used.get(n.resourceId) || 0;
      const available = r6(stock - usedBefore);
      const fromStock = Math.max(0, Math.min(available, n.requested));
      if (fromStock) state.used.set(n.resourceId, r6(usedBefore + fromStock));
      const shortage = r6(n.requested - fromStock);
      function cacheFor(children) {
        const entries = children || [];
        const groups = [clone(n)];
        entries.forEach((entry) => groups.push(...(entry.groups || []).map(clone)));
        const production = entries.flatMap((entry) => (entry.production || []).map(clone));
        const usedMap = new Map([[n.resourceId, fromStock]]);
        entries.forEach((entry) => {
          (entry.usedMap || new Map()).forEach((value, id) =>
            usedMap.set(id, r6((usedMap.get(id) || 0) + value)));
        });
        const cacheEntry = { feasible: true, groups, production, usedMap, startMap };
        if (entryTouchesAffected(cacheEntry)) state.cache.set(k, cacheEntry);
        return { feasible: true, cacheEntry };
      }
      if (shortage <= 1e-9) return cacheFor([]);
      if (chain.includes(n.resourceId)) return failed(n.level, n.resourceId, "配方组合形成环，已停止展开", chain);
      const options = producers.get(n.resourceId) || [];
      if (!options.length) {
        state.attempts.push({ level: n.level, resourceId: n.resourceId, recipeId: null,
          shortage, result: "无启用配方" });
        return failed(n.level, n.resourceId,
          `库存 ${r6(Math.max(available, 0))} 不足，缺口 ${shortage}，且无替代配方`, chain);
      }
      const failures = [];
      for (const p of options) {
        restore(start); addNode(n);
        const runs = shortage / p.outputQty;
        const production = { level: n.level, resourceId: n.resourceId, recipeId: p.id,
          outputQty: p.outputQty, runs: r6(runs), produced: shortage, shortageBefore: shortage,
          amplificationToTarget: r6(shortage / targetQty) };
        state.production.push(production);
        const children = [];
        let stop = null;
        for (const input of p.inputs) {
          const requested = r6(input.qty * runs);
          const child = { level: n.level + 1, resourceId: input.resourceId, requested,
            recipeId: p.id, parentResourceId: n.resourceId,
            multiplier: r6(input.qty / p.outputQty), amplification: r6(requested / targetQty),
            sources: [{ fromResource: n.resourceId, recipeId: p.id,
              qtyPerOutput: r6(input.qty / p.outputQty), requested, shortageAtParent: shortage }] };
          const childResult = satisfy(child, chain.concat(n.resourceId));
          if (!childResult.feasible) { stop = childResult; break; }
          if (childResult.cacheEntry) children.push(childResult.cacheEntry);
        }
        if (stop) {
          failures.push(stop.earliestShortage);
          state.attempts.push({ level: n.level, resourceId: n.resourceId, recipeId: p.id, shortage,
            result: `被第 ${stop.earliestShortage.level} 级 ${stop.earliestShortage.resourceId} 阻断` });
        } else {
          return cacheFor(children.concat([{ production: [production], usedMap: new Map() }]));
        }
      }
      const earliest = failures.concat([{ level: n.level, resourceId: n.resourceId }])
        .sort((a, b) => b.level - a.level || a.resourceId.localeCompare(b.resourceId))[0];
      restore(start);
      return failed(earliest.level, earliest.resourceId,
        earliest.level === n.level
          ? `第 ${n.level} 级 ${n.resourceId} 缺口 ${shortage} 无法由库存与替代配方补齐`
          : `第 ${earliest.level} 级 ${earliest.resourceId} 最早断供，缺口未满足`, chain);
      function failed(level, resourceId, reason, failedChain) {
        return { feasible: false, earliestShortage: { level, resourceId, reason,
          sources: clone(n.sources || []), chain: failedChain }, attempts: clone(state.attempts) };
      }
    }

    const root = { level: 0, resourceId: request.targetId, requested: targetQty, recipeId: null,
      parentResourceId: null, multiplier: 1, amplification: 1,
      sources: [{ fromResource: "目标", recipeId: null, qtyPerOutput: 1, requested: targetQty }] };
    const result = satisfy(root, []);
    const groups = state.groups.slice().sort((a, b) => a.level - b.level ||
      a.resourceId.localeCompare(b.resourceId)).map((g) => {
      const stock = resourceMap.has(g.resourceId) ? resourceMap.get(g.resourceId).initialStock : 0;
      const produced = state.production
        .filter((x) => x.level === g.level && x.resourceId === g.resourceId)
        .reduce((sum, x) => sum + x.produced, 0);
      const stockUsed = Math.min(stock, g.requested);
      return Object.assign(clone(g), { initialStock: stock, stockUsed: r6(stockUsed),
        produced: r6(produced),
        shortage: r6(Math.max(0, g.requested - stockUsed - produced)),
        remainingStock: r6(Math.max(0, stock - (state.used.get(g.resourceId) || 0))) });
    });
    const levels = [];
    groups.forEach((g) => {
      let level = levels.find((x) => x.level === g.level);
      if (!level) { level = { level: g.level, totalRequested: 0, totalShortage: 0, resources: [] };
        levels.push(level); }
      level.totalRequested = r6(level.totalRequested + g.requested);
      level.totalShortage = r6(level.totalShortage + g.shortage);
      level.resources.push(g.resourceId);
    });
    const sortedProduction = state.production.slice().sort((a, b) =>
      a.level - b.level || a.resourceId.localeCompare(b.resourceId) ||
      String(a.recipeId).localeCompare(String(b.recipeId))).map(clone);
    return Object.assign({}, result, { targetId: request.targetId, targetQty, conflicts: checked.conflicts,
      validationErrors: [], levels: levels.sort((a, b) => a.level - b.level), groups,
      production: sortedProduction, alternativesTried: state.attempts.map(clone),
      stats: { cacheHits: state.hits, cacheRejects: state.rejects } });
  }

  function projectIncremental(input, request, previous) {
    const baseline = previous || {};
    const cache = baseline.cache instanceof Map ? baseline.cache : new Map();
    const propagation = baseline.change ? affectedResources(input, baseline.change)
      : { affected: null, seeds: new Set(), reason: "初始推演" };
    const result = project(input, request, { cache, affected: propagation.affected,
      version: (baseline.version || 0) + 1 });
    result.cache = cache;
    result.version = (baseline.version || 0) + 1;
    result.stats = result.stats || {};
    result.stats.affectedResourceIds = [...(propagation.affected || [])].sort();
    result.stats.seedResourceIds = [...propagation.seeds].sort();
    result.stats.changeReason = propagation.reason;
    return result;
  }

  function comparableProjection(result) {
    return {
      feasible: result.feasible,
      earliestShortage: result.earliestShortage
        ? { level: result.earliestShortage.level, resourceId: result.earliestShortage.resourceId } : null,
      groups: (result.groups || []).map((g) => ({ level: g.level, resourceId: g.resourceId,
        requested: g.requested, stockUsed: g.stockUsed, produced: g.produced,
        shortage: g.shortage, amplification: g.amplification })),
      production: (result.production || []).map((p) => ({ level: p.level, resourceId: p.resourceId,
        recipeId: p.recipeId, runs: p.runs, produced: p.produced }))
    };
  }

  return { normalizeModel, validateModel, buildConflicts, project, projectIncremental,
    affectedResources, comparableProjection, round: r6 };
});
