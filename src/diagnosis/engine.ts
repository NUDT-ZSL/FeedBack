/**
 * 推演主引擎：给定解析后的四诊输入，确定性地产出
 * 证候判定、候选方剂排序、剂量配比与疗效预估。
 * 全部函数为纯函数：不读时钟、不用随机数、不依赖外部服务。
 */
import {
  CONSTITUTION_DOSAGE_FACTOR,
  CONSTITUTION_FEEDBACK,
  FORMULAS,
  HERBS,
  HISTORY_DOSAGE_FACTOR,
  SYNDROME_RULES,
  type FormulaDef,
  type SyndromeRule,
} from './data/rules';
import { buildDependencyPlan, type DependencyPlan } from './dependencies';
import type {
  DependencyIssue,
  EfficacyEstimate,
  FormulaCandidate,
  FormulaDosage,
  HerbDosage,
  ResolvedInputs,
  SyndromeConclusion,
} from './types';

export interface SyndromeStageResult {
  syndromes: SyndromeConclusion[];
  dependencyIssues: DependencyIssue[];
  /** 每个证候实际消费掉的输入 key（kind:key），供增量重推建立索引。 */
  consumptionIndex: Map<string, Set<string>>;
}

function modifierKeys(rule: SyndromeRule): string[] {
  return Object.keys(rule.modifiers).sort();
}

/** 单个证候的确定性评分。被依赖证候成立时按 dependsOn 传导加分。 */
export function evaluateSyndrome(
  rule: SyndromeRule,
  inputs: ResolvedInputs,
  concludedScores: Map<string, number>,
): SyndromeConclusion {
  const evidence: string[] = [];
  let score = 0;
  for (const key of Object.keys(rule.evidenceWeights).sort()) {
    const [kind, item] = splitEvidenceKey(key);
    const present =
      (kind === 'symptom' && inputs.symptoms.includes(item)) ||
      (kind === 'pulse' && inputs.pulses.includes(item)) ||
      (kind === 'tongue' && inputs.tongues.includes(item));
    if (present) {
      score += rule.evidenceWeights[key];
      evidence.push(key);
    }
  }
  const modifiers: SyndromeConclusion['modifiers'] = [];
  for (const modId of modifierKeys(rule)) {
    const [kind, item] = splitEvidenceKey(modId);
    const present =
      (kind === 'constitution' && inputs.constitutions.includes(item)) ||
      (kind === 'history' && inputs.histories.includes(item));
    if (present) {
      const mod = rule.modifiers[modId];
      score += mod.delta;
      modifiers.push({ id: modId, delta: mod.delta, reason: mod.reason });
    }
  }
  for (const depId of Object.keys(rule.dependsOn).sort()) {
    const depScore = concludedScores.get(depId);
    if (depScore !== undefined && depScore > 0) {
      score += rule.dependsOn[depId];
      modifiers.push({
        id: depId,
        delta: rule.dependsOn[depId],
        reason: `证候 ${depId} 成立，传变加分`,
      });
    }
  }
  return {
    syndromeId: rule.id,
    name: rule.name,
    status: 'concluded',
    score,
    threshold: rule.threshold,
    evidence,
    modifiers,
  };
}

function splitEvidenceKey(key: string): [string, string] {
  const sep = key.indexOf(':');
  return [key.slice(0, sep), key.slice(sep + 1)];
}

/** 证候阶段：按依赖计划顺序评估，闭环/缺失引用证候标记 blocked。 */
export function runSyndromeStage(
  inputs: ResolvedInputs,
  plan?: DependencyPlan,
  rules: SyndromeRule[] = SYNDROME_RULES,
): SyndromeStageResult {
  const effectivePlan = plan ?? buildDependencyPlan(rules);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const syndromes: SyndromeConclusion[] = [];
  const consumptionIndex = new Map<string, Set<string>>();
  const concludedScores = new Map<string, number>();

  for (const id of effectivePlan.evalOrder) {
    const rule = ruleById.get(id);
    if (!rule) continue;
    const conclusion = evaluateSyndrome(rule, inputs, concludedScores);
    syndromes.push(conclusion);
    concludedScores.set(
      id,
      conclusion.status === 'concluded' && conclusion.score >= conclusion.threshold
        ? conclusion.score
        : 0,
    );
    const consumed = new Set<string>();
    for (const ev of conclusion.evidence) consumed.add(ev);
    for (const mod of conclusion.modifiers) {
      if (mod.id.startsWith('constitution:') || mod.id.startsWith('history:')) {
        consumed.add(mod.id);
      }
    }
    consumptionIndex.set(id, consumed);
  }

  for (const [id, reason] of [...effectivePlan.blocked.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const rule = ruleById.get(id);
    if (!rule) continue;
    syndromes.push({
      syndromeId: id,
      name: rule.name,
      status: 'blocked',
      score: 0,
      threshold: rule.threshold,
      evidence: [],
      modifiers: [],
      blockReason: reason,
    });
  }

  return { syndromes, dependencyIssues: effectivePlan.issues, consumptionIndex };
}

/** 方剂阶段：按证候集合匹配打分并稳定排序。 */
export function runFormulaStage(
  syndromes: SyndromeConclusion[],
  inputs: ResolvedInputs,
  formulas: FormulaDef[] = FORMULAS,
): FormulaCandidate[] {
  const concluded = new Map(
    syndromes
      .filter((s) => s.status === 'concluded' && s.score >= s.threshold)
      .map((s) => [s.syndromeId, s.score]),
  );
  const candidates: FormulaCandidate[] = [];
  for (const formula of formulas) {
    const matched: string[] = [];
    let matchScore = 0;
    const reasons: string[] = [];
    for (const synId of Object.keys(formula.indications).sort()) {
      const synScore = concluded.get(synId);
      if (synScore !== undefined) {
        matched.push(synId);
        matchScore += formula.indications[synId];
        reasons.push(`主治 ${synId}（证候得分 ${synScore}）`);
      }
    }
    if (matched.length === 0) continue;
    const contraindications: string[] = [];
    for (const contraId of Object.keys(formula.contraindications).sort()) {
      const [kind, item] = splitEvidenceKey(contraId);
      const present =
        (kind === 'constitution' && inputs.constitutions.includes(item)) ||
        (kind === 'history' && inputs.histories.includes(item));
      if (present) {
        const contra = formula.contraindications[contraId];
        matchScore -= contra.penalty;
        contraindications.push(contraId);
        reasons.push(`禁忌：${contra.note}（-${contra.penalty}）`);
      }
    }
    candidates.push({
      formulaId: formula.id,
      name: formula.name,
      rank: 0,
      matchScore,
      matchedSyndromes: matched,
      contraindications,
      reasons,
    });
  }
  candidates.sort((a, b) =>
    b.matchScore !== a.matchScore
      ? b.matchScore - a.matchScore
      : a.formulaId < b.formulaId
        ? -1
        : 1,
  );
  candidates.forEach((c, i) => {
    c.rank = i + 1;
  });
  return candidates;
}

function roundHalf(grams: number): number {
  return Math.round(grams * 2) / 2;
}

/** 剂量阶段：按体质/病史对基准剂量做确定性修正。 */
export function runDosageStage(
  candidates: FormulaCandidate[],
  inputs: ResolvedInputs,
  formulas: FormulaDef[] = FORMULAS,
): FormulaDosage[] {
  const formulaById = new Map(formulas.map((f) => [f.id, f]));
  const dosages: FormulaDosage[] = [];
  for (const candidate of candidates) {
    const def = formulaById.get(candidate.formulaId);
    if (!def) continue;
    const composition: HerbDosage[] = def.composition.map((slot) => {
      const herb = HERBS[slot.herbId];
      let factor = 1;
      const notes: string[] = [];
      for (const cid of inputs.constitutions.slice().sort()) {
        const fix = CONSTITUTION_DOSAGE_FACTOR[`constitution:${cid}`];
        if (fix) {
          factor *= fix.factor;
          notes.push(fix.note);
        }
      }
      for (const hid of inputs.histories.slice().sort()) {
        const fix = HISTORY_DOSAGE_FACTOR[`history:${hid}`];
        if (!fix) continue;
        const isCold = herb.nature < 0;
        const isHot = herb.nature > 0;
        if ((fix.natureSign === 'cold' && isCold) || (fix.natureSign === 'hot' && isHot)) {
          factor *= fix.factor;
          notes.push(fix.note);
        }
      }
      const roundedFactor = Math.round(factor * 100) / 100;
      return {
        herbId: herb.id,
        name: herb.name,
        role: slot.role,
        baseGrams: herb.baseGrams,
        factor: roundedFactor,
        grams: roundHalf(herb.baseGrams * roundedFactor),
        adjustment: notes.length > 0 ? notes.join('；') : undefined,
      };
    });
    const natureBias =
      Math.round(
        composition.reduce((sum, slot) => sum + HERBS[slot.herbId].nature * slot.grams, 0) * 100,
      ) / 100;
    dosages.push({
      formulaId: def.id,
      name: def.name,
      composition,
      natureBias,
    });
  }
  return dosages;
}

/** 疗效阶段：由匹配分、体质相合度、病史风险确定性推算。 */
export function runEfficacyStage(
  candidates: FormulaCandidate[],
  syndromes: SyndromeConclusion[],
  inputs: ResolvedInputs,
  formulas: FormulaDef[] = FORMULAS,
): EfficacyEstimate[] {
  const formulaById = new Map(formulas.map((f) => [f.id, f]));
  const concludedCount = syndromes.filter(
    (s) => s.status === 'concluded' && s.score >= s.threshold,
  ).length;
  return candidates.map((candidate) => {
    const def = formulaById.get(candidate.formulaId);
    const rationale: string[] = [];
    let rate = 40 + candidate.matchScore * 4;
    rationale.push(`基础有效率 40 + 匹配分 ${candidate.matchScore} × 4`);

    let constitutionFit = 80;
    for (const fb of CONSTITUTION_FEEDBACK) {
      const item = fb.constitutionId.split(':')[1];
      if (!inputs.constitutions.includes(item)) continue;
      for (const synId of Object.keys(fb.whenSyndrome).sort()) {
        if (candidate.matchedSyndromes.includes(synId)) {
          constitutionFit += fb.whenSyndrome[synId];
          rationale.push(
            `体质 ${fb.constitutionId} 与证候 ${synId} 相参，相合度 ${fb.whenSyndrome[synId]}`,
          );
        }
      }
    }
    rate += Math.round((constitutionFit - 80) / 2);

    const riskNotes: string[] = [];
    for (const contraId of candidate.contraindications) {
      riskNotes.push(`存在禁忌 ${contraId}，需密切观察`);
      rate -= 6;
    }
    if (concludedCount > 1) {
      rate -= (concludedCount - 1) * 3;
      rationale.push(`兼夹 ${concludedCount} 证，病机复杂，有效率 -${(concludedCount - 1) * 3}`);
    }
    const effectiveRate = Math.max(5, Math.min(98, Math.round(rate)));
    const estimatedCourses =
      (def?.baseCourses ?? 5) + Math.max(0, concludedCount - 1) + candidate.contraindications.length;
    rationale.push(`预估有效率 ${effectiveRate}%，疗程 ${estimatedCourses} 剂`);
    return {
      formulaId: candidate.formulaId,
      name: candidate.name,
      effectiveRate,
      estimatedCourses,
      constitutionFit,
      riskNotes,
      rationale,
    };
  });
}

export interface DeductionCoreResult {
  syndromes: SyndromeConclusion[];
  formulas: FormulaCandidate[];
  dosages: FormulaDosage[];
  efficacy: EfficacyEstimate[];
  dependencyIssues: DependencyIssue[];
  consumptionIndex: Map<string, Set<string>>;
}

/** 全量推演：证候 -> 方剂 -> 剂量 -> 疗效。 */
export function deduce(
  inputs: ResolvedInputs,
  rules: SyndromeRule[] = SYNDROME_RULES,
): DeductionCoreResult {
  const syndromeStage = runSyndromeStage(inputs, undefined, rules);
  const formulas = runFormulaStage(syndromeStage.syndromes, inputs);
  const dosages = runDosageStage(formulas, inputs);
  const efficacy = runEfficacyStage(formulas, syndromeStage.syndromes, inputs);
  return {
    syndromes: syndromeStage.syndromes,
    formulas,
    dosages,
    efficacy,
    dependencyIssues: syndromeStage.dependencyIssues,
    consumptionIndex: syndromeStage.consumptionIndex,
  };
}
