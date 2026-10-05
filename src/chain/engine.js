import { FragmentStore } from './fragment-store.js';
import { RuleSet } from './rule-set.js';

/**
 * 标记链路引擎：输入 -> 规则匹配 -> 依赖传播 -> 状态收敛 -> 结果输出。
 *
 * - 每个位置保留全部命中候选（依据），同优先级冲突不静默择一，
 *   进入可裁决的 conflict 中间状态。
 * - 规则 apply 内通过 api.read/api.readOffset 读取其它位置标记，
 *   读取被追踪为依赖边；上游变化沿依赖方向传播到下游位置。
 * - 片段修正 / 规则改写 / 人工裁决只把受影响位置放入脏集做增量重推，
 *   recomputeAll() 提供整体重推，二者结果必须一致（验收用）。
 * - 依赖成环（不动点迭代不收敛）与指向不存在位置的读取，
 *   都以可观察状态呈现（unconverged / dangling），不跳过不丢弃。
 */
export class TagEngine {
  constructor() {
    this.store = new FragmentStore();
    this.ruleSet = new RuleSet();
    this.state = new Map();        // pid -> {pos, candidates, finalTag, status, reads:Set}
    this.rdeps = new Map();        // 被读位置 -> 读者位置集合（反向依赖边）
    this.overrides = new Map();    // pid -> {tag, reason} 人工裁决
    this.danglingReads = new Map();// 读者 pid -> Set<不存在的位置 id>
    this.unconverged = new Set();  // 未收敛位置
    this.events = [];
    this._byIndex = [];
    this._staticLogged = new Set();
  }

  // ---------- 输入侧 ----------

  positions() {
    return this.store.positions();
  }

  submitFragment(fragment) {
    const res = this.store.submit(fragment);
    if (!res.accepted || !res.changed) return { ...res, rederived: 0, iterations: 0 };
    const affected = this._syncPositions();
    return { ...res, ...this._derive(affected) };
  }

  upsertRule(rule) {
    const { kind, prev } = this.ruleSet.upsert(rule);
    this._staticRuleChecks();
    const current = this.ruleSet.get(rule.id);
    const dirty = new Set();
    // 旧作用域 ∪ 新作用域内的位置都需要重推
    for (const [pid, st] of this.state) {
      if (this._inScope(current, st.pos) || (prev && this._inScope(prev, st.pos))) dirty.add(pid);
    }
    // 下游联动由已追踪的动态依赖边（rdeps）在 _derive 中传播，无需按 requires 静态扩脏
    return { kind, ...this._derive(dirty) };
  }

  adjudicate(pid, tag, reason = '') {
    if (!this.state.has(pid)) {
      this._log({ type: 'adjudication-rejected', position: pid, reason: 'position-not-found' });
      return { accepted: false, rederived: 0, iterations: 0 };
    }
    this.overrides.set(pid, { tag, reason });
    this._log({ type: 'adjudicated', position: pid, tag, reason });
    return { accepted: true, ...this._derive(new Set([pid])) };
  }

  clearAdjudication(pid) {
    if (!this.overrides.has(pid)) return { accepted: false, rederived: 0, iterations: 0 };
    this.overrides.delete(pid);
    this._log({ type: 'adjudication-cleared', position: pid });
    return { accepted: true, ...this._derive(new Set([pid])) };
  }

  /** 整体重推：清空派生状态（保留输入：片段/规则/裁决），从脏集=全量位置重推。 */
  recomputeAll() {
    this.state.clear();
    this.rdeps.clear();
    this.danglingReads.clear();
    this.unconverged.clear();
    const affected = this._syncPositions();
    return this._derive(affected);
  }

  // ---------- 处理侧 ----------

  _syncPositions() {
    const current = this.store.positions();
    const ids = new Set(current.map((p) => p.id));
    const affected = new Set();

    for (const p of current) {
      const prev = this.state.get(p.id);
      if (!prev) {
        this.state.set(p.id, { pos: p, candidates: [], finalTag: null, status: 'pending', reads: new Set() });
        affected.add(p.id);
      } else {
        if (prev.pos.char !== p.char || prev.pos.index !== p.index) affected.add(p.id);
        prev.pos = p;
      }
    }
    for (const pid of [...this.state.keys()]) {
      if (ids.has(pid)) continue;
      const readers = this.rdeps.get(pid);
      if (readers) for (const r of readers) affected.add(r); // 读到已消失位置的读者需重推
      this.state.delete(pid);
      this.rdeps.delete(pid);
      this.danglingReads.delete(pid);
      this.unconverged.delete(pid);
      for (const set of this.rdeps.values()) set.delete(pid);
    }
    this._byIndex = current;
    return affected;
  }

  _inScope(rule, pos) {
    const s = rule.scope;
    if (s == null) return true;
    if (typeof s === 'function') return !!s(pos);
    if (s.sources && !s.sources.includes(pos.source)) return false;
    if (s.pattern && !s.pattern.test(pos.char)) return false;
    return true;
  }

  _evalPosition(pid) {
    const st = this.state.get(pid);
    // 先拆除旧的依赖边，评估时按实际读取重建
    for (const target of st.reads) {
      const set = this.rdeps.get(target);
      if (set) {
        set.delete(pid);
        if (set.size === 0) this.rdeps.delete(target);
      }
    }
    st.reads = new Set();
    this.danglingReads.delete(pid);

    const api = {
      read: (targetId) => {
        st.reads.add(targetId);
        if (!this.rdeps.has(targetId)) this.rdeps.set(targetId, new Set());
        this.rdeps.get(targetId).add(pid);
        const tgt = this.state.get(targetId);
        if (!tgt) {
          if (!this.danglingReads.has(pid)) this.danglingReads.set(pid, new Set());
          this.danglingReads.get(pid).add(targetId);
          return null;
        }
        return tgt.finalTag;
      },
      readOffset: (delta) => {
        const target = this._byIndex[st.pos.index + delta];
        return api.read(target ? target.id : `@index:${st.pos.index + delta}`);
      },
    };

    const candidates = [];
    for (const rule of this.ruleSet.all()) {
      if (!this._inScope(rule, st.pos)) continue;
      let tag = null;
      try {
        tag = rule.apply(st.pos, api);
      } catch (err) {
        this._log({ type: 'rule-error', ruleId: rule.id, position: pid, message: String((err && err.message) || err) });
      }
      if (tag !== null && tag !== undefined) {
        candidates.push({ ruleId: rule.id, priority: rule.priority, tag });
      }
    }
    candidates.sort((a, b) =>
      b.priority - a.priority || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
    );

    let finalTag = null;
    let status;
    const override = this.overrides.get(pid);
    if (override) {
      finalTag = override.tag;
      status = 'adjudicated';
    } else if (candidates.length === 0) {
      status = 'untagged';
    } else {
      const top = candidates[0].priority;
      const topTags = new Set(candidates.filter((c) => c.priority === top).map((c) => JSON.stringify(c.tag)));
      if (topTags.size === 1) {
        finalTag = candidates[0].tag;
        status = 'ok';
      } else {
        status = 'conflict'; // 同优先级冲突：保留各方依据，等待裁决
      }
    }

    const changed =
      st.finalTag !== finalTag ||
      st.status !== status ||
      JSON.stringify(st.candidates) !== JSON.stringify(candidates);
    st.candidates = candidates;
    st.finalTag = finalTag;
    st.status = status;
    this.unconverged.delete(pid);
    return changed;
  }

  /** 不动点迭代：从脏集出发，沿反向依赖边把变化传播到下游，直至收敛或超限。 */
  _derive(seeds) {
    const dirty = new Set([...seeds].filter((pid) => this.state.has(pid)));
    const maxIterations = Math.max(64, this.state.size * 8);
    let iterations = 0;
    let rederived = 0;
    let lastChanged = new Set();

    while (dirty.size > 0 && iterations < maxIterations) {
      iterations++;
      const batch = [...dirty].sort();
      dirty.clear();
      lastChanged = new Set();
      for (const pid of batch) {
        if (!this.state.has(pid)) continue;
        rederived++;
        if (this._evalPosition(pid)) {
          lastChanged.add(pid);
          const readers = this.rdeps.get(pid);
          if (readers) for (const r of readers) dirty.add(r);
        }
      }
    }

    if (iterations >= maxIterations && (dirty.size > 0 || lastChanged.size > 0)) {
      const tainted = new Set([...dirty, ...lastChanged].filter((pid) => this.state.has(pid)));
      // 传染：依赖未收敛位置的下游同样拿不到稳定结论
      let grew = true;
      while (grew) {
        grew = false;
        for (const pid of [...tainted]) {
          for (const reader of this.rdeps.get(pid) ?? []) {
            if (!tainted.has(reader) && this.state.has(reader)) {
              tainted.add(reader);
              grew = true;
            }
          }
        }
      }
      for (const pid of tainted) {
        this.unconverged.add(pid);
        const st = this.state.get(pid);
        if (st.status !== 'adjudicated') {
          st.status = 'unconverged';
          st.finalTag = null; // 未收敛不产出静默结论，依据保留在 candidates
        }
      }
      this._log({ type: 'unconverged', positions: [...this.unconverged].sort(), iterations });
    }
    return { rederived, iterations };
  }

  _staticRuleChecks() {
    for (const r of this.ruleSet.all()) {
      for (const dep of r.requires) {
        if (!this.ruleSet.get(dep)) this._logStatic({ type: 'dangling-rule-ref', ruleId: r.id, missing: dep });
      }
    }
    const graph = new Map(this.ruleSet.all().map((r) => [r.id, r.requires.filter((d) => this.ruleSet.get(d))]));
    const color = new Map();
    const stack = [];
    const visit = (n) => {
      color.set(n, 1);
      stack.push(n);
      for (const m of graph.get(n) ?? []) {
        if (color.get(m) === 1) {
          this._logStatic({ type: 'rule-dependency-cycle', cycle: [...stack.slice(stack.indexOf(m)), m] });
        } else if (!color.get(m)) {
          visit(m);
        }
      }
      stack.pop();
      color.set(n, 2);
    };
    for (const id of graph.keys()) if (!color.has(id)) visit(id);
  }

  _log(event) {
    this.events.push({ ...event, at: this.events.length });
  }

  _logStatic(event) {
    const key = JSON.stringify(event);
    if (this._staticLogged.has(key)) return;
    this._staticLogged.add(key);
    this._log(event);
  }

  // ---------- 输出侧 ----------

  _upstream(pid) {
    const seen = new Set();
    const stack = [pid];
    while (stack.length > 0) {
      const cur = stack.pop();
      const st = this.state.get(cur);
      if (!st) continue;
      for (const t of st.reads) {
        if (t !== pid && !seen.has(t) && this.state.has(t)) {
          seen.add(t);
          stack.push(t);
        }
      }
    }
    return [...seen]
      .map((id) => this.state.get(id))
      .filter(Boolean)
      .sort((a, b) => a.pos.index - b.pos.index)
      .map((st) => ({ position: st.pos.id, tag: st.finalTag }));
  }

  _cycles() {
    const nodes = this.unconverged;
    const cycles = [];
    const color = new Map();
    const stack = [];
    const visit = (n) => {
      color.set(n, 1);
      stack.push(n);
      const st = this.state.get(n);
      for (const t of st ? st.reads : []) {
        if (!nodes.has(t)) continue;
        if (color.get(t) === 1) cycles.push([...stack.slice(stack.indexOf(t)), t]);
        else if (!color.get(t)) visit(t);
      }
      stack.pop();
      color.set(n, 2);
    };
    for (const n of [...nodes].sort()) if (!color.has(n)) visit(n);
    // 规范化：旋转到最小节点开头，便于比较稳定
    return cycles
      .map((cyc) => {
        const body = cyc.slice(0, -1);
        const min = body.indexOf([...body].sort()[0]);
        return [...body.slice(min), ...body.slice(0, min), body[min]];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  report() {
    const positions = [...this.state.values()]
      .sort((a, b) => a.pos.index - b.pos.index)
      .map((st) => ({
        position: st.pos.id,
        index: st.pos.index,
        char: st.pos.char,
        finalTag: st.finalTag,
        status: this.unconverged.has(st.pos.id) ? 'unconverged' : st.status,
        hits: st.candidates,
        override: this.overrides.get(st.pos.id) ?? null,
        reads: [...st.reads].sort(),
        propagationPath: this._upstream(st.pos.id),
      }));
    return {
      positions,
      conflicts: positions.filter((p) => p.status === 'conflict').map((p) => p.position),
      unconverged: [...this.unconverged].sort(),
      dangling: [...this.danglingReads.entries()]
        .flatMap(([reader, missing]) => [...missing].sort().map((m) => ({ reader, missing: m })))
        .sort((a, b) => a.reader.localeCompare(b.reader) || a.missing.localeCompare(b.missing)),
      cycles: this._cycles(),
      events: [...this.store.events, ...this.ruleSet.events, ...this.events],
    };
  }
}
