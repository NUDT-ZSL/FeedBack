import { DocumentStore } from './document.ts';
import type {
  Candidate,
  ChangeSet,
  ConflictRecord,
  DanglingIssue,
  ExplanationNode,
  Fragment,
  MatchSpec,
  PositionState,
  Report,
  RuleSpec,
} from './types.ts';

/** 无规则命中时的基底标记 */
export const BASE_LABEL = 'O';

interface Pin {
  label: string;
  note: string;
}

/**
 * 处理与状态收敛侧。
 *
 * 推导规则：
 * - 每个位置收集作用范围内全部命中候选，绝不按遍历顺序静默择一；
 * - 最高优先级候选结论唯一 -> resolved；同优先级结论分歧 -> conflict，
 *   各方依据全部保留，等待 adjudicate() 人工裁决；
 * - 规则可声明相对依赖 deps，依赖位置标记变化时沿依赖边重推下游；
 * - 不动点迭代收敛；振荡位置列入 unconverged，不伪造收敛；
 * - 依赖成环、指向不存在位置（悬空）均以可观察结构输出。
 */
export class Engine {
  readonly doc = new DocumentStore();
  private rules: RuleSpec[];
  private states: PositionState[] = [];
  /** 依赖反向边：target -> 读取 target 的下游位置集合 */
  private dependents = new Map<number, Set<number>>();
  private conflicts = new Map<number, ConflictRecord>();
  /** 观察到的悬空依赖：只有规则实际求值到依赖节点且目标缺失时才记录 */
  private danglingByIndex = new Map<number, DanglingIssue[]>();
  private cycles: number[][] = [];
  private pins = new Map<number, Pin>();
  /** 上一轮未收敛位置：后续每轮都强制重查，避免漏推被掩盖 */
  private unstable = new Set<number>();
  private pass = 0;
  private lastChange: ChangeSet = {
    derived: [],
    changed: [],
    iterations: 0,
    converged: true,
    unconverged: [],
  };

  private maxIterations: number;

  constructor(rules: RuleSpec[], maxIterations = 1000) {
    this.rules = [...rules];
    this.maxIterations = maxIterations;
  }

  get lastChangeSet(): ChangeSet {
    return this.lastChange;
  }

  // ---------------------------------------------------------------- 输入侧

  submit(frag: Fragment): ChangeSet {
    const result = this.doc.submit(frag);
    if (!result.changed) {
      this.lastChange = {
        derived: [],
        changed: [],
        iterations: 0,
        converged: this.unstable.size === 0,
        unconverged: [...this.unstable].sort((a, b) => a - b),
      };
      return this.lastChange;
    }
    const len = this.doc.length;
    const dirty = new Set<number>();
    if (len === result.oldLength) {
      // 原位修正：仅重推内容变化区间
      for (let i = result.firstDiff; i <= result.lastDiff; i++) dirty.add(i);
    } else if (len > result.oldLength) {
      // 增长（追加/插入）：变化区间之后全部重推；此前悬空依赖可能变为可解析
      for (let i = result.firstDiff; i < len; i++) dirty.add(i);
      for (const issue of this.currentDangling()) dirty.add(issue.index);
    } else {
      // 收缩：下游依赖目标可能整体失效，保守全量
      for (let i = 0; i < len; i++) dirty.add(i);
    }
    this.rebuildGraph();
    return this.run(dirty);
  }

  // ---------------------------------------------------------------- 规则改写

  /** 规则集改写：只重推发生变化规则的作用范围，下游沿依赖边传播 */
  setRules(next: RuleSpec[]): ChangeSet {
    const prevById = new Map(this.rules.map((r) => [r.id, r]));
    const nextById = new Map(next.map((r) => [r.id, r]));
    const dirty = new Set<number>();
    const len = this.doc.length;
    const markScope = (rule: RuleSpec) => {
      const [start, end] = rule.scope;
      for (let i = Math.max(0, start); i <= Math.min(end, len - 1); i++) {
        dirty.add(i);
      }
    };
    for (const rule of next) {
      const prev = prevById.get(rule.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(rule)) markScope(rule);
    }
    for (const rule of this.rules) {
      if (!nextById.has(rule.id)) markScope(rule);
    }
    this.rules = [...next];
    this.rebuildGraph();
    return this.run(dirty);
  }

  // ---------------------------------------------------------------- 人工裁决

  /** 裁决：钉住某位置的标记，只重推该位置并沿依赖边传播到下游 */
  adjudicate(index: number, label: string, note = '人工裁决'): ChangeSet {
    this.pins.set(index, { label, note });
    return this.run(new Set([index]));
  }

  release(index: number): ChangeSet {
    this.pins.delete(index);
    return this.run(new Set([index]));
  }

  // ---------------------------------------------------------------- 推导核心

  private evalMatch(
    spec: MatchSpec,
    index: number,
    ruleId: string,
    depTargets: number[],
    depLabels: Array<string | null>,
    missingDangling: DanglingIssue[],
  ): boolean {
    const pos = this.doc.at(index);
    if (!pos) return false;
    const recordMissingDeps = (): void => {
      depTargets.forEach((target, k) => {
        if (target < 0 || target >= this.doc.length) {
          missingDangling.push({ index, ruleId, target });
          depLabels[k] = null;
        }
      });
    };
    switch (spec.kind) {
      case 'charEq':
        return pos.char === spec.value;
      case 'charIn':
        return spec.values.includes(pos.char);
      case 'regex': {
        const half = spec.window ?? 0;
        const text = this.doc.text;
        const from = Math.max(0, index - half);
        const to = Math.min(text.length, index + half + 1);
        return new RegExp(spec.pattern).test(text.slice(from, to));
      }
      case 'depLabelEq':
        recordMissingDeps();
        return depLabels.length > 0 && depLabels.every((l) => l === spec.value);
      case 'depLabelIn':
        recordMissingDeps();
        return depLabels.length > 0 && depLabels.every((l) => l !== null && spec.values.includes(l));
      case 'all':
        return spec.of.every((s) =>
          this.evalMatch(s, index, ruleId, depTargets, depLabels, missingDangling),
        );
      case 'any':
        return spec.of.some((s) =>
          this.evalMatch(s, index, ruleId, depTargets, depLabels, missingDangling),
        );
      case 'not':
        return !this.evalMatch(spec.of, index, ruleId, depTargets, depLabels, missingDangling);
    }
  }

  private evidenceWindow(index: number): string {
    const text = this.doc.text;
    const from = Math.max(0, index - 2);
    const to = Math.min(text.length, index + 3);
    return `${text.slice(from, index)}[${text[index] ?? ''}]${text.slice(index + 1, to)}`;
  }

  /** 推导单个位置；返回标记/状态是否变化 */
  private derive(index: number): boolean {
    const pos = this.doc.at(index);
    if (!pos) return false;
    const prev = this.states[index];
    const pin = this.pins.get(index);

    // 候选与悬空观察始终收集：裁决/解释需要完整依据，与是否被钉住无关
    const candidates: Candidate[] = [];
    const danglingHere: DanglingIssue[] = [];
    for (const rule of this.rules) {
      const [start, end] = rule.scope;
      if (index < start || index > end) continue;
      const depTargets = (rule.deps ?? []).map((offset) => index + offset);
      const depLabels = depTargets.map((target) =>
        target >= 0 && target < this.doc.length
          ? (this.states[target]?.label ?? null)
          : null,
      );
      const missing: DanglingIssue[] = [];
      if (this.evalMatch(rule.match, index, rule.id, depTargets, depLabels, missing)) {
        candidates.push({
          ruleId: rule.id,
          priority: rule.priority,
          label: rule.label,
          evidence: this.evidenceWindow(index),
          depInputs: depTargets.map((target, k) => ({ index: target, label: depLabels[k] })),
        });
      }
      for (const issue of missing) {
        if (
          !danglingHere.some(
            (d) => d.ruleId === issue.ruleId && d.target === issue.target,
          )
        ) {
          danglingHere.push(issue);
        }
      }
    }
    if (danglingHere.length > 0) {
      this.danglingByIndex.set(index, danglingHere);
    } else {
      this.danglingByIndex.delete(index);
    }

    let label: string | null;
    let status: PositionState['status'];

    if (pin) {
      label = pin.label;
      status = 'pinned';
      this.conflicts.delete(index);
    } else if (candidates.length === 0) {
      label = BASE_LABEL;
      status = 'resolved';
      this.conflicts.delete(index);
    } else {
      const top = Math.max(...candidates.map((c) => c.priority));
      const tied = candidates.filter((c) => c.priority === top);
      const distinct = new Set(tied.map((c) => c.label));
      if (distinct.size === 1) {
        label = tied[0].label;
        status = 'resolved';
        this.conflicts.delete(index);
      } else {
        // 同优先级结论分歧：不静默择一，保留各方依据等待裁决
        label = null;
        status = 'conflict';
        this.conflicts.set(index, { index, tied, all: candidates });
      }
    }

    const changed = !prev || prev.label !== label || prev.status !== status;
    this.states[index] = {
      index,
      char: pos.char,
      fragmentKey: pos.fragmentKey,
      label,
      status,
      candidates,
      derivedAtPass: ++this.pass,
      pinnedNote: pin?.note,
    };
    return changed;
  }

  /** 不动点迭代：只重推 dirty 及其下游，超限未收敛则如实列出 */
  private run(dirty: Set<number>): ChangeSet {
    for (const i of this.unstable) {
      if (i < this.doc.length) dirty.add(i);
    }
    const queue = new Set<number>([...dirty].filter((i) => i >= 0 && i < this.doc.length));
    const derived = new Set<number>();
    const changed = new Set<number>();
    let iterations = 0;
    let converged = true;

    while (queue.size > 0) {
      if (iterations >= this.maxIterations) {
        converged = false;
        break;
      }
      const index = Math.min(...queue);
      queue.delete(index);
      iterations++;
      if (this.derive(index)) {
        changed.add(index);
        for (const downstream of this.dependents.get(index) ?? []) {
          queue.add(downstream);
        }
      }
      derived.add(index);
    }

    this.unstable = converged ? new Set() : new Set(queue);
    for (const i of this.unstable) {
      const st = this.states[i];
      if (st) this.states[i] = { ...st, status: 'unconverged' };
    }
    this.lastChange = {
      derived: [...derived].sort((a, b) => a - b),
      changed: [...changed].sort((a, b) => a - b),
      iterations,
      converged,
      unconverged: [...this.unstable].sort((a, b) => a - b),
    };
    return this.lastChange;
  }

  /** 重建位置级依赖图并静态检测环；悬空依赖在求值时动态观察（见 derive） */
  private rebuildGraph(): void {
    this.dependents = new Map();
    const edges = new Map<number, Set<number>>();
    const len = this.doc.length;
    for (let i = 0; i < len; i++) {
      for (const rule of this.rules) {
        const [start, end] = rule.scope;
        if (i < start || i > end) continue;
        for (const offset of rule.deps ?? []) {
          const target = i + offset;
          if (target < 0 || target >= len) continue;
          if (!this.dependents.has(target)) this.dependents.set(target, new Set());
          this.dependents.get(target)!.add(i);
          if (!edges.has(i)) edges.set(i, new Set());
          edges.get(i)!.add(target);
        }
      }
    }
    this.cycles = findCycles(edges, len);
  }

  private currentDangling(): DanglingIssue[] {
    return [...this.danglingByIndex.values()]
      .flat()
      .sort((a, b) => a.index - b.index || a.ruleId.localeCompare(b.ruleId) || a.target - b.target);
  }

  // ---------------------------------------------------------------- 输出侧

  /** 整体重推：用于校验增量结果是否与之一致 */
  recomputeAll(): ChangeSet {
    this.states = [];
    this.conflicts.clear();
    this.danglingByIndex.clear();
    this.rebuildGraph();
    const all = new Set<number>();
    for (let i = 0; i < this.doc.length; i++) all.add(i);
    return this.run(all);
  }

  report(): Report {
    return {
      text: this.doc.text,
      positions: this.states.filter(Boolean),
      conflicts: [...this.conflicts.values()].sort((a, b) => a.index - b.index),
      unconverged: [...this.unstable].sort((a, b) => a - b),
      cycles: this.cycles.map((c) => [...c].sort((a, b) => a - b)),
      dangling: this.currentDangling(),
      ingestLog: [...this.doc.ingestLog],
    };
  }

  /** 一致性快照：增量与整体重推应逐位一致 */
  snapshot(): {
    labels: Array<string | null>;
    statuses: string[];
    candidates: string[][];
    conflicts: number[];
    unconverged: number[];
    dangling: DanglingIssue[];
    cycles: number[][];
  } {
    const report = this.report();
    return {
      labels: report.positions.map((p) => p.label),
      statuses: report.positions.map((p) => p.status),
      candidates: report.positions.map((p) =>
        p.candidates.map((c) => `${c.ruleId}:${c.label}@${c.priority}`).sort(),
      ),
      conflicts: report.conflicts.map((c) => c.index),
      unconverged: report.unconverged,
      dangling: report.dangling,
      cycles: report.cycles,
    };
  }

  /** 传播路径解释：递归展开某位置标记所依据的规则与上游位置 */
  explain(index: number, maxDepth = 32): ExplanationNode {
    const seen = new Set<number>();
    const walk = (i: number, depth: number): ExplanationNode => {
      const st = this.states[i];
      if (!st) {
        return { index: i, char: '', label: null, status: 'resolved', via: [] };
      }
      if (depth >= maxDepth || seen.has(i)) {
        return { index: i, char: st.char, label: st.label, status: st.status, via: [] };
      }
      seen.add(i);
      const node: ExplanationNode = {
        index: i,
        char: st.char,
        label: st.label,
        status: st.status,
        via: st.candidates.map((c) => ({
          ruleId: c.ruleId,
          priority: c.priority,
          label: c.label,
          evidence: c.evidence,
          depInputs: c.depInputs
            .filter((d) => d.index !== i)
            .map((d) => walk(d.index, depth + 1)),
        })),
      };
      seen.delete(i);
      return node;
    };
    return walk(index, 0);
  }
}

/** Tarjan 强连通分量：size>1 或自环即依赖成环 */
function findCycles(edges: Map<number, Set<number>>, nodeCount: number): number[][] {
  const indexOf = new Map<number, number>();
  const lowlink = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const cycles: number[][] = [];
  let counter = 0;

  const strongconnect = (v: number): void => {
    indexOf.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!indexOf.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indexOf.get(w)!));
      }
    }
    if (lowlink.get(v) === indexOf.get(v)) {
      const component: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1 || (edges.get(v)?.has(v) ?? false)) {
        cycles.push(component.sort((a, b) => a - b));
      }
    }
  };

  for (let v = 0; v < nodeCount; v++) {
    if (!indexOf.has(v)) strongconnect(v);
  }
  return cycles;
}
