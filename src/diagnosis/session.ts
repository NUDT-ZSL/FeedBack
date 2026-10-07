/**
 * 推演会话：维护采集记录与裁决结果，提供全量推演与增量重推。
 *
 * 增量重推的正确性由引擎的纯函数结构保证：
 * - 每个证候只依赖自身消费的输入 key 与被依赖证候的得分；
 * - 每个方剂只依赖证候集合与自身体质/病史禁忌；
 * 因此只重算受影响节点、其余沿用缓存，结果与全量重推严格一致。
 * 离线校验脚本会对每个样例断言「增量结果 === 全量结果」。
 */
import { collectConflicts, resolveInputs } from './collection';
import { buildDependencyPlan, type DependencyPlan } from './dependencies';
import {
  deduce,
  evaluateSyndrome,
  runDosageStage,
  runEfficacyStage,
  runFormulaStage,
  type DeductionCoreResult,
} from './engine';
import { SYNDROME_RULES } from './data/rules';
import type {
  Adjudication,
  CollectionConflict,
  CollectionRecord,
  DeductionResult,
  ExamSource,
  RecordKind,
  ResolvedInputs,
  SyndromeConclusion,
} from './types';

export interface CollectParams {
  kind: RecordKind;
  key: string;
  value: string;
  source: ExamSource;
  /** 逻辑时刻，由调用方提供；引擎不读系统时钟。 */
  recordedAt: number;
  note?: string;
}

export class DeductionSession {
  private records: CollectionRecord[] = [];
  private adjudications: Adjudication[] = [];
  private counter = 0;
  private seqByTime = new Map<number, number>();
  private cached: DeductionCoreResult | null = null;
  private cachedInputs: ResolvedInputs | null = null;

  /** 采集一条四诊记录；重复采集同项不会覆盖旧记录。 */
  collect(params: CollectParams): CollectionRecord {
    this.counter += 1;
    const seq = (this.seqByTime.get(params.recordedAt) ?? 0) + 1;
    this.seqByTime.set(params.recordedAt, seq);
    const record: CollectionRecord = {
      id: `rec-${String(this.counter).padStart(4, '0')}`,
      kind: params.kind,
      key: params.key,
      value: params.value,
      source: params.source,
      recordedAt: params.recordedAt,
      seq,
      note: params.note,
    };
    this.records.push(record);
    return record;
  }

  /** 修正某条采集记录的取值（保留原记录 id 与时刻，仅改值）。 */
  correctRecord(recordId: string, newValue: string): CollectionRecord {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) throw new Error(`采集记录不存在：${recordId}`);
    record.value = newValue;
    return record;
  }

  /** 裁决某个采集项：采用某条记录或忽略该项。 */
  adjudicate(adjudication: Adjudication): void {
    this.adjudications = [
      ...this.adjudications.filter(
        (a) => !(a.kind === adjudication.kind && a.key === adjudication.key),
      ),
      adjudication,
    ];
  }

  getRecords(): CollectionRecord[] {
    return [...this.records];
  }

  getConflicts(): CollectionConflict[] {
    return collectConflicts(this.records, this.adjudications);
  }

  resolve(): ResolvedInputs {
    return resolveInputs(this.records, this.adjudications);
  }

  /** 全量推演，并刷新缓存。 */
  deduceFull(): DeductionResult {
    const inputs = this.resolve();
    const core = deduce(inputs);
    this.cached = core;
    this.cachedInputs = inputs;
    return this.toResult(core);
  }

  /**
   * 增量重推：只重算受 changedGroupKeys（kind:key）影响的证候与下游方剂，
   * 其余沿用缓存。调用前需至少执行过一次 deduceFull 或 deduceIncremental。
   */
  deduceIncremental(changedGroupKeys: string[]): DeductionResult {
    if (!this.cached || !this.cachedInputs) {
      return this.deduceFull();
    }
    const inputs = this.resolve();
    const changed = new Set(changedGroupKeys);
    const plan: DependencyPlan = buildDependencyPlan();
    const ruleById = new Map(SYNDROME_RULES.map((r) => [r.id, r]));

    // 1) 找出直接受影响的证候：规则声明的证据/修正项引用了被改动的输入 key。
    //    注意必须用规则的“潜在消费集合”而非上一轮的实际消费集合——
    //    否则被挂起的冲突项裁决生效后，会因上轮未消费而被漏判。
    const affected = new Set<string>();
    for (const rule of SYNDROME_RULES) {
      const potentialKeys = [
        ...Object.keys(rule.evidenceWeights),
        ...Object.keys(rule.modifiers),
      ];
      if (potentialKeys.some((key) => changed.has(key))) {
        affected.add(rule.id);
      }
    }
    // 2) 沿 dependsOn 边传递：被依赖证候变了，依赖者也要重算。
    let grew = true;
    while (grew) {
      grew = false;
      for (const rule of SYNDROME_RULES) {
        if (affected.has(rule.id)) continue;
        for (const depId of Object.keys(rule.dependsOn)) {
          if (affected.has(depId)) {
            affected.add(rule.id);
            grew = true;
            break;
          }
        }
      }
    }

    // 3) 按拓扑序重算受影响证候，未受影响的沿用缓存得分。
    const prevById = new Map(this.cached.syndromes.map((s) => [s.syndromeId, s]));
    const concludedScores = new Map<string, number>();
    const nextSyndromes: SyndromeConclusion[] = [];
    const nextConsumption = new Map<string, Set<string>>();
    for (const id of plan.evalOrder) {
      const rule = ruleById.get(id);
      if (!rule) continue;
      let conclusion: SyndromeConclusion;
      if (affected.has(id)) {
        conclusion = evaluateSyndrome(rule, inputs, concludedScores);
        const consumed = new Set<string>();
        for (const ev of conclusion.evidence) consumed.add(ev);
        for (const mod of conclusion.modifiers) {
          if (mod.id.startsWith('constitution:') || mod.id.startsWith('history:')) {
            consumed.add(mod.id);
          }
        }
        nextConsumption.set(id, consumed);
      } else {
        conclusion = prevById.get(id)!;
        nextConsumption.set(id, this.cached.consumptionIndex.get(id) ?? new Set());
      }
      nextSyndromes.push(conclusion);
      concludedScores.set(
        id,
        conclusion.status === 'concluded' && conclusion.score >= conclusion.threshold
          ? conclusion.score
          : 0,
      );
    }
    for (const [id, reason] of [...plan.blocked.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : 1,
    )) {
      const rule = ruleById.get(id);
      if (!rule) continue;
      nextSyndromes.push({
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

    // 4) 下游阶段：证候结论有变化才重推方剂/剂量/疗效。
    const syndromeChanged = nextSyndromes.some((s) => {
      const prev = prevById.get(s.syndromeId);
      return (
        !prev ||
        prev.status !== s.status ||
        prev.score !== s.score ||
        prev.evidence.join('|') !== s.evidence.join('|')
      );
    });
    const contextChanged =
      changedGroupKeys.some((k) => k.startsWith('constitution:') || k.startsWith('history:'));

    let core: DeductionCoreResult;
    if (syndromeChanged || contextChanged) {
      const formulas = runFormulaStage(nextSyndromes, inputs);
      const dosages = runDosageStage(formulas, inputs);
      const efficacy = runEfficacyStage(formulas, nextSyndromes, inputs);
      core = {
        syndromes: nextSyndromes,
        formulas,
        dosages,
        efficacy,
        dependencyIssues: plan.issues,
        consumptionIndex: nextConsumption,
      };
    } else {
      core = {
        ...this.cached,
        syndromes: nextSyndromes,
        dependencyIssues: plan.issues,
        consumptionIndex: nextConsumption,
      };
    }
    this.cached = core;
    this.cachedInputs = inputs;
    return this.toResult(core);
  }

  private toResult(core: DeductionCoreResult): DeductionResult {
    return {
      syndromes: core.syndromes,
      formulas: core.formulas,
      dosages: core.dosages,
      efficacy: core.efficacy,
      conflicts: this.getConflicts(),
      dependencyIssues: core.dependencyIssues,
    };
  }
}
