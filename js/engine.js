/* 推导引擎：沿依赖关系计算每项交接的可完成性与上下文完整度。
 * - 支持全量推导与增量重推（只重算受影响链路），并保证两者结果一致。
 * - 纯逻辑、无 DOM 依赖，可在 Node 中独立测试。
 */
(function (global) {
  "use strict";

  const STATUS = { COMPLETE: "complete", PARTIAL: "partial", UNTRUSTED: "untrusted", BLOCKED: "blocked" };

  function now() { return Engine.clock ? Engine.clock() : new Date(); }

  function isExpired(iso) {
    if (!iso) return false;
    const t = new Date(iso);
    return !isNaN(t) && t < now();
  }

  /* Tarjan 强连通分量：找出所有成环节点（含自环） */
  function findCycleNodes(items) {
    const ids = new Set(items.map(i => i.id));
    const graph = new Map(items.map(i => [i.id, i.dependsOn.filter(d => ids.has(d))]));
    const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    let counter = 0;
    const cyclic = new Set();
    function strongconnect(v) {
      index.set(v, counter); low.set(v, counter); counter++;
      stack.push(v); onStack.add(v);
      for (const w of graph.get(v) || []) {
        if (w === v) { cyclic.add(v); continue; } // 自环
        if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), index.get(w))); }
      }
      if (low.get(v) === index.get(v)) {
        const scc = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
        if (scc.length > 1) scc.forEach(n => cyclic.add(n));
      }
    }
    for (const id of ids) if (!index.has(id)) strongconnect(id);
    return cyclic;
  }

  /* 反向依赖闭包：changed 集合 + 所有（传递）依赖它们的事项 */
  function affectedClosure(items, changedIds) {
    const reverse = new Map();
    for (const it of items) for (const d of it.dependsOn) {
      if (!reverse.has(d)) reverse.set(d, []);
      reverse.get(d).push(it.id);
    }
    const affected = new Set(changedIds);
    const queue = [...changedIds];
    while (queue.length) {
      const cur = queue.shift();
      for (const nxt of reverse.get(cur) || []) {
        if (!affected.has(nxt)) { affected.add(nxt); queue.push(nxt); }
      }
    }
    return affected;
  }

  /* 检测某事项的未裁决冲突：同 key 的 active 上下文存在多个不同取值 */
  function detectConflicts(contexts, itemId) {
    const byKey = new Map();
    for (const c of contexts) {
      if (c.itemId !== itemId || c.status !== "active") continue;
      if (!byKey.has(c.key)) byKey.set(c.key, []);
      byKey.get(c.key).push(c);
    }
    const conflicts = [];
    for (const [key, list] of byKey) {
      const values = new Set(list.map(c => c.value));
      if (values.size > 1) conflicts.push({ key, ctxIds: list.map(c => c.id) });
    }
    return conflicts;
  }

  class Engine {
    constructor(state) {
      this.state = state;          // { items, contexts }
      this.results = new Map();    // itemId -> 推导结果（缓存）
      this.cycleNodes = new Set();
    }

    itemById(id) { return this.state.items.find(i => i.id === id); }
    contextsOf(id) { return this.state.contexts.filter(c => c.itemId === id); }

    /* 全量推导：所有事项按拓扑序从头重算 */
    fullDerive() {
      this.cycleNodes = findCycleNodes(this.state.items);
      const next = new Map();
      const order = this.topoOrder(this.state.items.map(i => i.id));
      for (const id of order) next.set(id, this.deriveOne(this.itemById(id), next));
      this.results = next;
      return this.results;
    }

    /* 增量重推：只重算 changedIds 及其下游，其余沿用缓存 */
    incrementalDerive(changedIds) {
      this.cycleNodes = findCycleNodes(this.state.items);
      const affected = affectedClosure(this.state.items, changedIds);
      // 按依赖深度排序，保证先算上游（环内顺序无意义，结果均为不可信）
      const order = this.topoOrder([...affected]);
      for (const id of order) {
        const it = this.itemById(id);
        if (it) this.results.set(id, this.deriveOne(it, this.results));
      }
      return { affected: order, results: this.results };
    }

    topoOrder(ids) {
      const inSet = new Set(ids);
      const depth = new Map();
      const visit = (id, seen) => {
        if (depth.has(id)) return depth.get(id);
        if (seen.has(id)) return 0; // 环
        seen.add(id);
        const it = this.itemById(id);
        let d = 0;
        if (it) for (const dep of it.dependsOn) {
          if (inSet.has(dep)) d = Math.max(d, visit(dep, new Set(seen)) + 1);
        }
        depth.set(id, d);
        return d;
      };
      ids.forEach(id => visit(id, new Set()));
      return [...ids].sort((a, b) => depth.get(a) - depth.get(b));
    }

    /* 单项推导。depResults：已可用的（缓存或本次新算的）结果表 */
    deriveOne(item, depResults) {
      const reasons = [];
      const ctxStates = new Map();
      let hardFail = false;   // 环 / 依赖缺失 / 自身过期
      let blocked = false;
      let depUntrusted = false;

      // 1) 依赖检查
      for (const depId of item.dependsOn) {
        const depItem = this.itemById(depId);
        if (!depItem) {
          reasons.push({ level: "bad", text: `前置依赖 ${depId} 指向的事项不存在（依赖缺失）` });
          hardFail = true;
          continue;
        }
        if (this.cycleNodes.has(depId) || this.cycleNodes.has(item.id)) {
          reasons.push({ level: "bad", text: `与 ${depId} 之间存在依赖成环` });
          hardFail = true;
          continue;
        }
        const depRes = depResults.get(depId);
        if (depRes) {
          if (depRes.status === STATUS.BLOCKED) {
            reasons.push({ level: "warn", text: `上游 ${depId} 存在未裁决的来源冲突，需先裁决` });
            blocked = true;
          } else if (depRes.status === STATUS.UNTRUSTED) {
            reasons.push({ level: "bad", text: `上游 ${depId} 不可信，本项随之不可信` });
            depUntrusted = true;
          } else if (depRes.status === STATUS.PARTIAL) {
            reasons.push({ level: "warn", text: `上游 ${depId} 上下文不完整（${depRes.completeness}%）` });
          }
        }
      }
      if (this.cycleNodes.has(item.id) && !hardFail) {
        reasons.push({ level: "bad", text: "本项处于依赖环中" });
        hardFail = true;
      }

      // 2) 自身时效
      if (isExpired(item.deadline)) {
        reasons.push({ level: "bad", text: `事项时效已过（截止 ${item.deadline}）` });
        hardFail = true;
      }

      // 3) 上下文条目
      const conflicts = detectConflicts(this.state.contexts, item.id);
      if (conflicts.length) {
        reasons.push({ level: "warn", text: `存在 ${conflicts.length} 组来源矛盾（${conflicts.map(c => c.key).join("、")}），裁决前暂停推导` });
        blocked = true;
      }
      let trustedCtx = 0, totalCtx = 0;
      for (const c of this.contextsOf(item.id)) {
        if (c.status !== "active") {
          ctxStates.set(c.id, { trusted: false, note: "已被裁决弃用" });
          continue;
        }
        totalCtx++;
        if (isExpired(c.expiresAt)) {
          ctxStates.set(c.id, { trusted: false, note: `已过期（${c.expiresAt}）` });
          reasons.push({ level: "bad", text: `上下文「${c.key}」已过有效期，不可信` });
        } else {
          ctxStates.set(c.id, { trusted: true, note: "有效" });
          trustedCtx++;
        }
      }

      // 4) 完整度 = 可信单元 / 全部单元（上下文 + 依赖）
      const totalDeps = item.dependsOn.length;
      let trustedDeps = 0;
      for (const depId of item.dependsOn) {
        const depRes = depResults.get(depId);
        const depItem = this.itemById(depId);
        if (depItem && !this.cycleNodes.has(depId) && depRes &&
            (depRes.status === STATUS.COMPLETE || depRes.status === STATUS.PARTIAL)) {
          trustedDeps++;
        }
      }
      const totalUnits = totalCtx + totalDeps;
      const trustedUnits = trustedCtx + trustedDeps;
      const completeness = totalUnits === 0 ? 100 : Math.round(100 * trustedUnits / totalUnits);
      if (totalCtx === 0 && totalDeps === 0) {
        reasons.push({ level: "warn", text: "本项没有任何上下文条目与依赖，请确认是否遗漏交接内容" });
      }

      // 5) 状态判定
      let status;
      if (hardFail || depUntrusted) status = STATUS.UNTRUSTED;
      else if (blocked) status = STATUS.BLOCKED;
      else if (completeness === 100) { status = STATUS.COMPLETE; reasons.push({ level: "ok", text: "全部上下文可信，依赖链完整" }); }
      else status = STATUS.PARTIAL;

      return { itemId: item.id, status, completeness, reasons, conflicts,
               contextStates: Object.fromEntries(ctxStates) };
    }

    /* 校验：缓存（可能来自增量）与全新全量推导逐项比对 */
    verifyConsistency() {
      const saved = this.results;
      const fresh = new Map();
      const savedCycles = this.cycleNodes;
      this.cycleNodes = findCycleNodes(this.state.items);
      const order = this.topoOrder(this.state.items.map(i => i.id));
      for (const id of order) fresh.set(id, this.deriveOne(this.itemById(id), fresh));
      this.cycleNodes = savedCycles;
      for (const [id, r] of fresh) {
        const c = saved.get(id);
        if (!c || c.status !== r.status || c.completeness !== r.completeness) {
          return { consistent: false, itemId: id, cached: c, fresh: r };
        }
      }
      return { consistent: true };
    }
  }

  Engine.STATUS = STATUS;
  Engine.clock = null; // 测试时可注入
  global.HandoverEngine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
})(typeof window !== "undefined" ? window : globalThis);
