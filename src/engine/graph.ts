/**
 * 依赖图：采集记录 → 体质/病史影响规则 → 证候 → 方剂 → 疗效预估。
 *
 * 职责：
 * 1. 将追加式采集记录按「同项不同值」拆成冲突组，冲突未裁决则整组暂不参与辨证；
 * 2. 依据知识库构造推演节点与依赖边；
 * 3. 显式检出依赖闭环（SCC）与指向缺失（missing-reference），
 *    产出 Diagnostic，绝不静默跳过；
 * 4. 给出确定性的求值顺序（拓扑序 + 同闭环内按节点号字典序）。
 */
import type { Diagnostic, ObservationRecord } from './types.js';
import type { KnowledgeBase } from './knowledge.js';

export const RECORD_PREFIX = 'rec:';
export const MOD_PREFIX = 'mod:';
export const SYN_PREFIX = 'syn:';
export const FOR_PREFIX = 'for:';
export const EFF_PREFIX = 'eff:';

export interface ActivePartition {
  /** 参与辨证的记录（每个采集项至多一条） */
  active: ObservationRecord[];
  /** 因值冲突未裁决而暂不参与的记录 */
  withheld: ObservationRecord[];
  /** 已裁决弃用 */
  rejected: ObservationRecord[];
  conflicts: { kind: ObservationRecord['kind']; key: string; records: ObservationRecord[] }[];
  diagnostics: Diagnostic[];
}

const byTimeThenId = (a: ObservationRecord, b: ObservationRecord) =>
  a.collectedAt - b.collectedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 采集项分组规则：
 * - 同 kind+key 同值的重复采集：保留全部记录用于追溯，取「最新一条」参与辨证；
 * - 同 kind+key 出现互异的有效值：形成冲突，全部候选暂不参与辨证，
 *   直到某条被裁决采纳；若异常地存在多条互异的采纳记录，取最新一条并同样上报冲突。
 */
export function partitionRecords(records: ObservationRecord[]): ActivePartition {
  const sorted = [...records].sort(byTimeThenId);
  const groups = new Map<string, ObservationRecord[]>();
  for (const rec of sorted) {
    const gk = `${rec.kind}|${rec.key}`;
    const list = groups.get(gk) ?? [];
    list.push(rec);
    groups.set(gk, list);
  }

  const active: ObservationRecord[] = [];
  const withheld: ObservationRecord[] = [];
  const rejected: ObservationRecord[] = [];
  const conflicts: ActivePartition['conflicts'] = [];
  const diagnostics: Diagnostic[] = [];

  for (const list of groups.values()) {
    const kept = list.filter((r) => r.status !== 'rejected');
    for (const r of list) if (r.status === 'rejected') rejected.push(r);
    if (kept.length === 0) continue;

    const distinctValues = [...new Set(kept.map((r) => r.value))].sort();
    if (distinctValues.length === 1) {
      active.push(kept[kept.length - 1]);
      continue;
    }

    const adjudicated = kept.filter((r) => r.status === 'adjudicated').sort(byTimeThenId);
    const chosen = adjudicated.length > 0 ? adjudicated[adjudicated.length - 1] : null;
    if (chosen) {
      active.push(chosen);
      for (const r of kept) if (r.id !== chosen.id) withheld.push(r);
    } else {
      for (const r of kept) withheld.push(r);
    }
    conflicts.push({ kind: list[0].kind, key: list[0].key, records: kept });
    diagnostics.push({
      type: 'unresolved-conflict',
      kind: list[0].kind,
      key: list[0].key,
      recordIds: kept.map((r) => r.id),
      detail: `采集项「${list[0].kind}/${list[0].key}」存在互异值 ${distinctValues.join(
        '、'
      )}，需使用者裁决后方可参与辨证`,
    });
  }

  active.sort(byTimeThenId);
  withheld.sort(byTimeThenId);
  rejected.sort(byTimeThenId);
  conflicts.sort((a, b) =>
    a.kind === b.kind ? (a.key < b.key ? -1 : 1) : a.kind < b.kind ? -1 : 1
  );
  return { active, withheld, rejected, conflicts, diagnostics };
}

export interface GraphNode {
  id: string;
  kind: 'record' | 'modifier' | 'syndrome' | 'formula' | 'efficacy';
  /** 依赖的节点 id */
  deps: Set<string>;
}

export interface InferenceGraph {
  nodes: Map<string, GraphNode>;
  /** 派生节点（非 record）的确定性求值顺序 */
  order: string[];
  diagnostics: Diagnostic[];
  /** 处于依赖闭环中的节点，求值时闭环内依赖视为不成立 */
  cyclicNodes: Set<string>;
}

export function buildGraph(
  active: ObservationRecord[],
  knowledge: KnowledgeBase
): InferenceGraph {
  const nodes = new Map<string, GraphNode>();
  const diagnostics: Diagnostic[] = [];

  const addNode = (id: string, kind: GraphNode['kind'], deps: string[] = []) => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, kind, deps: new Set<string>() };
      nodes.set(id, node);
    }
    for (const d of deps) node.deps.add(d);
    return node;
  };

  for (const r of active) addNode(RECORD_PREFIX + r.id, 'record');

  const findActive = (kind: ObservationRecord['kind'], key: string) =>
    active.find((r) => r.kind === kind && r.key === key);

  const syndromeIds = new Set(knowledge.syndromes.map((s) => s.id));
  for (const syn of knowledge.syndromes) addNode(SYN_PREFIX + syn.id, 'syndrome');

  // 体质/病史影响规则：触发条件为对应记录已生效（采集端约定
  // constitution/history 记录的 key 为 'constitution'/'history'，value 为具体取值）
  for (const mod of knowledge.modifiers) {
    const triggerRec = active.find(
      (r) => r.kind === mod.triggerKind && r.value === mod.triggerValue
    );
    if (!triggerRec) continue;

    const nodeId = MOD_PREFIX + mod.id;
    const deps: string[] = [RECORD_PREFIX + triggerRec.id];
    if (!syndromeIds.has(mod.syndrome)) {
      diagnostics.push({
        type: 'missing-reference',
        from: nodeId,
        target: SYN_PREFIX + mod.syndrome,
        detail: `规则「${mod.id}」作用的证候「${mod.syndrome}」在知识库中不存在`,
      });
    }
    for (const ref of mod.dependsOn) {
      const targetSynId = ref.startsWith('syndrome:') ? ref.slice('syndrome:'.length) : '';
      const targetId = targetSynId ? SYN_PREFIX + targetSynId : ref;
      if (targetSynId && !syndromeIds.has(targetSynId)) {
        diagnostics.push({
          type: 'missing-reference',
          from: nodeId,
          target: targetId,
          detail: `规则「${mod.id}」依赖的证候「${targetSynId}」在知识库中不存在`,
        });
      } else {
        deps.push(targetId);
      }
    }
    addNode(nodeId, 'modifier', deps);
    if (syndromeIds.has(mod.syndrome)) {
      addNode(SYN_PREFIX + mod.syndrome, 'syndrome', [nodeId]);
    }
  }

  // 方剂 → 证候
  for (const formula of knowledge.formulas) {
    const deps: string[] = [];
    for (const sid of formula.syndromes) {
      if (syndromeIds.has(sid)) deps.push(SYN_PREFIX + sid);
      else
        diagnostics.push({
          type: 'missing-reference',
          from: FOR_PREFIX + formula.id,
          target: SYN_PREFIX + sid,
          detail: `方剂「${formula.id}」主治证候「${sid}」在知识库中不存在`,
        });
    }
    addNode(FOR_PREFIX + formula.id, 'formula', deps);
  }

  // 疗效回推 → 方剂 + 当前体质/病史记录
  const constitutionRec = findActive('constitution', 'constitution');
  const historyRec = findActive('history', 'history');
  for (const formula of knowledge.formulas) {
    const deps = [FOR_PREFIX + formula.id];
    if (constitutionRec) deps.push(RECORD_PREFIX + constitutionRec.id);
    if (historyRec) deps.push(RECORD_PREFIX + historyRec.id);
    addNode(EFF_PREFIX + formula.id, 'efficacy', deps);
  }

  // 证候与四诊记录的直接依赖
  for (const syn of knowledge.syndromes) {
    const node = nodes.get(SYN_PREFIX + syn.id)!;
    for (const key of Object.keys(syn.symptomWeights)) {
      const rec = findActive('symptom', key);
      if (rec) node.deps.add(RECORD_PREFIX + rec.id);
    }
    for (const value of Object.keys(syn.pulseWeights)) {
      const rec = active.find((r) => r.kind === 'pulse' && r.value === value);
      if (rec) node.deps.add(RECORD_PREFIX + rec.id);
    }
    for (const value of Object.keys(syn.tongueWeights)) {
      const rec = active.find((r) => r.kind === 'tongue' && r.value === value);
      if (rec) node.deps.add(RECORD_PREFIX + rec.id);
    }
  }

  const { order, cyclicNodes, cycleDiagnostics } = topologicalOrder(nodes);
  diagnostics.push(...cycleDiagnostics);
  diagnostics.sort((a, b) => (a.detail < b.detail ? -1 : 1));

  return { nodes, order, diagnostics, cyclicNodes };
}

/**
 * 确定性拓扑排序：
 * - Kahn 算法，每轮取字典序最小的入度零节点；
 * - 残留节点（处于强连通分量闭环）按 SCC 分组，每个闭环产出一条 diagnostic，
 *   闭环内节点按字典序追加，求值时闭环内依赖视为不成立（见 engine）。
 */
function topologicalOrder(nodes: Map<string, GraphNode>) {
  const diagnostics: Diagnostic[] = [];
  const cyclicNodes = new Set<string>();
  const derived = [...nodes.values()]
    .filter((n) => n.kind !== 'record')
    .map((n) => n.id)
    .sort();

  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of derived) indeg.set(id, 0);
  for (const id of derived) {
    for (const dep of nodes.get(id)!.deps) {
      if (!indeg.has(dep)) continue;
      indeg.set(id, (indeg.get(id) ?? 0) + 1);
      const arr = dependents.get(dep) ?? [];
      arr.push(id);
      dependents.set(dep, arr);
    }
  }

  const ready = derived.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of (dependents.get(id) ?? []).slice().sort()) {
      const d = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, d);
      if (d === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  const inOrder = new Set(order);
  const remaining = derived.filter((id) => !inOrder.has(id));
  if (remaining.length) {
    const sccs = findSccs(remaining, nodes);
    sccs.sort((a, b) => a[0].localeCompare(b[0]));
    for (const scc of sccs) {
      scc.sort();
      scc.forEach((id) => cyclicNodes.add(id));
      diagnostics.push({
        type: 'dependency-cycle',
        nodes: scc,
        detail: `检测到依赖闭环：${scc.join(' → ')}（闭环内影响在本次推演中不成立，需修正规则）`,
      });
    }
    order.push(...remaining.sort());
  }

  return { order, cyclicNodes, cycleDiagnostics: diagnostics };
}

/** 仅在残留子图上做 Tarjan 求强连通分量（含自环） */
function findSccs(ids: string[], nodes: Map<string, GraphNode>): string[][] {
  const inSet = new Set(ids);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sccs: string[][] = [];

  const strongConnect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of nodes.get(v)!.deps) {
      if (!inSet.has(w)) continue;
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || nodes.get(v)!.deps.has(v)) sccs.push(comp);
    }
  };

  for (const id of [...ids].sort()) if (!index.has(id)) strongConnect(id);
  return sccs;
}
