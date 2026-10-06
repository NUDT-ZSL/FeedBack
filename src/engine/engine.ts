/**
 * 推演引擎：给定四诊采集记录（含体质、病史），确定性地产出
 * 证候判定 → 候选方剂排序 → 剂量配比 → 疗效预估。
 *
 * 确定性保证：
 * - 不读取系统时间、不使用随机数；记录时刻由调用方提供；
 * - 所有分值为整数运算；排序一律「分值降序 + id 字典序」兜底；
 * - 同一输入在任意入口（界面 / 脚本 / 批量）下产出完全一致的结果。
 *
 * 增量重推：deriveIncremental 只重算受变更记录影响的下游节点，
 * 结果与全量重推逐字节一致（由 scripts/verify-engine.ts 强制校验）。
 */
import { DEFAULT_KNOWLEDGE, type KnowledgeBase } from './knowledge.js';
import {
  buildGraph,
  partitionRecords,
  RECORD_PREFIX,
  MOD_PREFIX,
  SYN_PREFIX,
  FOR_PREFIX,
  EFF_PREFIX,
  type InferenceGraph,
} from './graph.js';
import type {
  CaseInput,
  Contribution,
  Diagnostic,
  EfficacyEstimate,
  FormulaCandidate,
  HerbDose,
  InferenceResult,
  ObservationRecord,
  SyndromeScore,
} from './types.js';

export type NodeValue =
  | { kind: 'modifier'; applied: boolean; delta: number; description: string }
  | { kind: 'syndrome'; score: SyndromeScore }
  | { kind: 'formula'; candidate: FormulaCandidate }
  | { kind: 'efficacy'; estimate: EfficacyEstimate };

export interface Derivation {
  input: CaseInput;
  knowledge: KnowledgeBase;
  graph: InferenceGraph;
  values: Map<string, NodeValue>;
  result: InferenceResult;
}

interface EvalContext {
  knowledge: KnowledgeBase;
  graph: InferenceGraph;
  activeById: Map<string, ObservationRecord>;
  values: Map<string, NodeValue>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function evalModifier(nodeId: string, ctx: EvalContext): NodeValue {
  const modId = nodeId.slice(MOD_PREFIX.length);
  const rule = ctx.knowledge.modifiers.find((m) => m.id === modId);
  if (!rule) return { kind: 'modifier', applied: false, delta: 0, description: '规则缺失' };

  const node = ctx.graph.nodes.get(nodeId)!;
  let satisfied = true;
  for (const dep of node.deps) {
    if (!dep.startsWith(SYN_PREFIX)) continue;
    // 闭环内依赖视为不成立（已在 diagnostics 中显式暴露）
    if (ctx.graph.cyclicNodes.has(nodeId) && ctx.graph.cyclicNodes.has(dep)) {
      satisfied = false;
      continue;
    }
    const depValue = ctx.values.get(dep);
    if (!depValue || depValue.kind !== 'syndrome' || !depValue.score.determined) {
      satisfied = false;
    }
  }
  return {
    kind: 'modifier',
    applied: satisfied,
    delta: satisfied ? rule.delta : 0,
    description: rule.description,
  };
}

function evalSyndrome(nodeId: string, ctx: EvalContext): NodeValue {
  const synId = nodeId.slice(SYN_PREFIX.length);
  const rule = ctx.knowledge.syndromes.find((s) => s.id === synId);
  if (!rule) {
    return {
      kind: 'syndrome',
      score: {
        syndromeId: synId,
        name: synId,
        score: 0,
        threshold: 0,
        determined: false,
        contributions: [],
      },
    };
  }

  const contributions: Contribution[] = [];
  let score = 0;
  const active = [...ctx.activeById.values()].sort((a, b) => a.id.localeCompare(b.id));

  for (const rec of active) {
    let delta = 0;
    let detail = '';
    if (rec.kind === 'symptom' && rule.symptomWeights[rec.key] !== undefined) {
      delta = rule.symptomWeights[rec.key];
      detail = `症状「${rec.key}」`;
    } else if (rec.kind === 'pulse' && rule.pulseWeights[rec.value] !== undefined) {
      delta = rule.pulseWeights[rec.value];
      detail = `脉象「${rec.value}」`;
    } else if (rec.kind === 'tongue' && rule.tongueWeights[rec.value] !== undefined) {
      delta = rule.tongueWeights[rec.value];
      detail = `舌象「${rec.value}」`;
    }
    if (delta !== 0) {
      score += delta;
      contributions.push({ from: rec.id, detail: `${detail}（${rec.source}）`, delta });
    }
  }

  const node = ctx.graph.nodes.get(nodeId)!;
  for (const dep of [...node.deps].sort()) {
    if (!dep.startsWith(MOD_PREFIX)) continue;
    const modValue = ctx.values.get(dep);
    if (!modValue || modValue.kind !== 'modifier') continue;
    if (ctx.graph.cyclicNodes.has(nodeId) && ctx.graph.cyclicNodes.has(dep)) continue;
    if (modValue.delta !== 0) {
      score += modValue.delta;
      contributions.push({ from: dep, detail: modValue.description, delta: modValue.delta });
    }
  }

  return {
    kind: 'syndrome',
    score: {
      syndromeId: rule.id,
      name: rule.name,
      score,
      threshold: rule.threshold,
      determined: score >= rule.threshold,
      contributions,
    },
  };
}

function evalFormula(nodeId: string, ctx: EvalContext): NodeValue {
  const formulaId = nodeId.slice(FOR_PREFIX.length);
  const def = ctx.knowledge.formulas.find((f) => f.id === formulaId);
  const empty: FormulaCandidate = {
    formulaId,
    name: def?.name ?? formulaId,
    score: 0,
    matchedSyndromes: [],
    herbs: [],
    totalDose: 0,
  };
  if (!def) return { kind: 'formula', candidate: empty };

  const matched: string[] = [];
  let score = 0;
  for (const sid of def.syndromes) {
    const synValue = ctx.values.get(SYN_PREFIX + sid);
    if (synValue && synValue.kind === 'syndrome' && synValue.score.determined) {
      matched.push(sid);
      score += synValue.score.score;
    }
  }
  matched.sort();

  const totalDose = def.herbs.reduce((sum, h) => sum + h.dose, 0);
  const herbs: HerbDose[] = def.herbs.map((h) => ({
    name: h.name,
    role: h.role,
    dose: h.dose,
    ratio: totalDose > 0 ? Math.round((h.dose / totalDose) * 10000) / 10000 : 0,
  }));

  return {
    kind: 'formula',
    candidate: { formulaId, name: def.name, score, matchedSyndromes: matched, herbs, totalDose },
  };
}

function evalEfficacy(nodeId: string, ctx: EvalContext): NodeValue {
  const formulaId = nodeId.slice(EFF_PREFIX.length);
  const def = ctx.knowledge.formulas.find((f) => f.id === formulaId);
  const formulaValue = ctx.values.get(FOR_PREFIX + formulaId);
  const candidate =
    formulaValue && formulaValue.kind === 'formula' ? formulaValue.candidate : null;

  const constitution = [...ctx.activeById.values()].find((r) => r.kind === 'constitution');
  const history = [...ctx.activeById.values()].find((r) => r.kind === 'history');

  const constDelta =
    ctx.knowledge.efficacyByConstitution[constitution?.value ?? '平和质'] ?? 0;
  const histRule =
    ctx.knowledge.efficacyByHistory[history?.value ?? '无'] ?? { rateDelta: 0, onsetDeltaDays: 0 };

  const matchedCount = candidate?.matchedSyndromes.length ?? 0;
  const matchBonus = matchedCount > 0 ? (matchedCount - 1) * 2 : 0;
  const expectedRate = clamp(
    (def?.baseEfficacy ?? 0) + constDelta + histRule.rateDelta + matchBonus,
    5,
    98
  );
  const onsetDays = Math.max(1, 3 + histRule.onsetDeltaDays - (matchedCount > 1 ? 1 : 0));

  const topScore = candidate
    ? Math.max(
        0,
        ...candidate.matchedSyndromes.map((sid) => {
          const v = ctx.values.get(SYN_PREFIX + sid);
          return v && v.kind === 'syndrome' ? v.score.score : 0;
        })
      )
    : 0;
  const threshold = def
    ? Math.max(
        0,
        ...def.syndromes.map(
          (sid) => ctx.knowledge.syndromes.find((s) => s.id === sid)?.threshold ?? 0
        )
      )
    : 0;
  const confidence = topScore >= threshold + 10 ? '高' : topScore >= threshold ? '中' : '低';

  const notes: string[] = [];
  if (def) notes.push(...def.cautions);
  if (constitution) notes.push(`体质「${constitution.value}」对疗效修正 ${constDelta} 分`);
  if (history && history.value !== '无')
    notes.push(`既往「${history.value}」：疗效 ${histRule.rateDelta} 分，取效约延后 ${histRule.onsetDeltaDays} 日`);

  return {
    kind: 'efficacy',
    estimate: {
      formulaId,
      formulaName: def?.name ?? formulaId,
      expectedRate,
      onsetDays,
      confidence,
      notes,
    },
  };
}

function evaluateNode(nodeId: string, ctx: EvalContext): NodeValue {
  if (nodeId.startsWith(MOD_PREFIX)) return evalModifier(nodeId, ctx);
  if (nodeId.startsWith(SYN_PREFIX)) return evalSyndrome(nodeId, ctx);
  if (nodeId.startsWith(FOR_PREFIX)) return evalFormula(nodeId, ctx);
  if (nodeId.startsWith(EFF_PREFIX)) return evalEfficacy(nodeId, ctx);
  throw new Error(`未知推演节点: ${nodeId}`);
}

function assembleResult(
  graph: InferenceGraph,
  values: Map<string, NodeValue>,
  partitionDiagnostics: Diagnostic[],
  activeIds: string[],
  withheldIds: string[],
  knowledge: KnowledgeBase
): InferenceResult {
  const syndromes: SyndromeScore[] = [];
  const formulas: FormulaCandidate[] = [];
  const efficacy: EfficacyEstimate[] = [];

  for (const syn of knowledge.syndromes) {
    const v = values.get(SYN_PREFIX + syn.id);
    if (v && v.kind === 'syndrome') syndromes.push(v.score);
  }
  syndromes.sort((a, b) => b.score - a.score || a.syndromeId.localeCompare(b.syndromeId));

  for (const [id, v] of values) {
    if (id.startsWith(FOR_PREFIX) && v.kind === 'formula' && v.candidate.score > 0) {
      formulas.push(v.candidate);
    }
  }
  formulas.sort((a, b) => b.score - a.score || a.formulaId.localeCompare(b.formulaId));

  for (const f of formulas) {
    const v = values.get(EFF_PREFIX + f.formulaId);
    if (v && v.kind === 'efficacy') efficacy.push(v.estimate);
  }

  return {
    syndromes,
    formulas,
    efficacy,
    diagnostics: [...partitionDiagnostics, ...graph.diagnostics],
    activeRecordIds: activeIds,
    withheldRecordIds: withheldIds,
  };
}

/** 全量推演：从输入完整重建依赖图并求值 */
export function derive(
  input: CaseInput,
  knowledge: KnowledgeBase = DEFAULT_KNOWLEDGE
): Derivation {
  const partition = partitionRecords(input.records);
  const graph = buildGraph(partition.active, knowledge);
  const activeById = new Map(partition.active.map((r) => [r.id, r]));
  const values = new Map<string, NodeValue>();
  const ctx: EvalContext = { knowledge, graph, activeById, values };
  for (const nodeId of graph.order) values.set(nodeId, evaluateNode(nodeId, ctx));

  const result = assembleResult(
    graph,
    values,
    partition.diagnostics,
    partition.active.map((r) => r.id),
    partition.withheld.map((r) => r.id),
    knowledge
  );
  return { input, knowledge, graph, values, result };
}

export function runInference(
  input: CaseInput,
  knowledge: KnowledgeBase = DEFAULT_KNOWLEDGE
): InferenceResult {
  return derive(input, knowledge).result;
}

/**
 * 增量重推：仅重算受 changedRecordIds 影响的下游节点，其余复用上次结果。
 * 受影响集合 = 变更记录在新图中的一阶及传递下游 ∪ 新增节点 ∪ 激活状态变化的记录下游。
 */
export function deriveIncremental(
  prev: Derivation,
  input: CaseInput,
  changedRecordIds: string[]
): Derivation {
  const knowledge = prev.knowledge;
  const partition = partitionRecords(input.records);
  const graph = buildGraph(partition.active, knowledge);
  const activeById = new Map(partition.active.map((r) => [r.id, r]));

  const prevActive = new Set(prev.result.activeRecordIds);
  const nextActive = new Set(partition.active.map((r) => r.id));
  const seedRecordIds = new Set(changedRecordIds);
  for (const id of prevActive) if (!nextActive.has(id)) seedRecordIds.add(id);
  for (const id of nextActive) if (!prevActive.has(id)) seedRecordIds.add(id);

  // 下游闭包需同时覆盖新图与旧图：旧图中存在、新图中被移除的依赖边
  // （如记录被裁决弃用后证候不再依赖它）同样会使下游节点失效。
  const dependents = new Map<string, string[]>();
  for (const g of [graph, prev.graph]) {
    for (const [id, node] of g.nodes) {
      for (const dep of node.deps) {
        const arr = dependents.get(dep) ?? [];
        if (!arr.includes(id)) arr.push(id);
        dependents.set(dep, arr);
      }
    }
  }
  const affected = new Set<string>();
  const queue: string[] = [];
  for (const rid of seedRecordIds) {
    const nodeId = RECORD_PREFIX + rid;
    if (graph.nodes.has(nodeId) || prev.graph.nodes.has(nodeId)) queue.push(nodeId);
  }
  while (queue.length) {
    const id = queue.pop()!;
    for (const child of dependents.get(id) ?? []) {
      if (!affected.has(child)) {
        affected.add(child);
        queue.push(child);
      }
    }
  }
  // 新增派生节点一律重算
  for (const nodeId of graph.order) {
    if (!prev.values.has(nodeId)) affected.add(nodeId);
  }

  const values = new Map<string, NodeValue>();
  const ctx: EvalContext = { knowledge, graph, activeById, values };
  for (const nodeId of graph.order) {
    if (affected.has(nodeId)) {
      values.set(nodeId, evaluateNode(nodeId, ctx));
    } else {
      const cached = prev.values.get(nodeId);
      values.set(nodeId, cached ?? evaluateNode(nodeId, ctx));
    }
  }

  const result = assembleResult(
    graph,
    values,
    partition.diagnostics,
    partition.active.map((r) => r.id),
    partition.withheld.map((r) => r.id),
    knowledge
  );
  return { input, knowledge, graph, values, result };
}
