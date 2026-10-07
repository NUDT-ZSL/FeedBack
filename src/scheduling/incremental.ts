/**
 * 局部调整后的增量重推。
 *
 * 受影响集合（对“真实受影响”的可靠超集，规则可追溯）：
 *  种子：
 *   - 依赖调整：被改工序本身；
 *   - 能力调整：该工序类型对应的全部工序。
 *  闭包传播（BFS，规则对两类调整统一生效）：
 *   规则1 依赖传播：受影响工序的全部后继（传递闭包）；
 *   规则2a 同工序类型：同类型全部工序——受影响工序改变能力池空档后，
 *          共用该能力池（含其它织机）的工序比较结论可能随之改变；
 *   规则2b 能力池织机：受影响工序只在其能力池（含基线织机）内改换档期，
 *          基线落在这些织机上的任意类型工序所见空档都可能变化。
 * 未受影响工序作为锚点保持基线结论，仅对受影响集合在锚点空档中重排，
 * 结果与整体重排完全一致（由验证器对每条用例断言）。
 */
import { runSchedule, type ScheduleAnchors } from './engine.ts';
import type {
  Adjudication,
  IncrementalResult,
  ScheduledStep,
  SchedulingChange,
  SchedulingInput,
  ScheduleResult,
} from './types.ts';
import { hasErrors, validateInput } from './validate.ts';

export function applyChange(input: SchedulingInput, change: SchedulingChange): SchedulingInput {
  if (change.kind === 'dependency') {
    return {
      ...input,
      steps: input.steps.map((s) =>
        s.id === change.stepId ? { ...s, dependsOn: [...change.dependsOn] } : s,
      ),
    };
  }
  const capabilities =
    change.priority === null
      ? input.capabilities.filter(
          (c) => !(c.loomId === change.loomId && c.processType === change.processType),
        )
      : [
          ...input.capabilities.filter(
            (c) => !(c.loomId === change.loomId && c.processType === change.processType),
          ),
          { loomId: change.loomId, processType: change.processType, priority: change.priority },
        ];
  return { ...input, capabilities };
}

export function computeAffected(
  input: SchedulingInput,
  baseline: ScheduleResult,
  change: SchedulingChange,
): string[] {
  const stepById = new Map(input.steps.map((s) => [s.id, s]));
  const entryByStep = new Map(baseline.entries.map((e) => [e.stepId, e]));
  const dependents = new Map<string, string[]>();
  const stepsOfType = new Map<string, string[]>();
  const poolOfType = new Map<string, Set<string>>();
  for (const step of input.steps) {
    dependents.set(step.id, []);
    stepsOfType.set(step.processType, [...(stepsOfType.get(step.processType) ?? []), step.id]);
  }
  for (const step of input.steps) {
    for (const dep of step.dependsOn) dependents.get(dep)?.push(step.id);
  }
  for (const cap of input.capabilities) {
    poolOfType.set(cap.processType, new Set([...(poolOfType.get(cap.processType) ?? []), cap.loomId]));
  }

  const seeds = new Set<string>();
  if (change.kind === 'dependency') {
    seeds.add(change.stepId);
  } else {
    for (const id of stepsOfType.get(change.processType) ?? []) seeds.add(id);
  }

  // BFS 闭包
  const affected = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const tryAdd = (id: string): void => {
      if (!affected.has(id) && stepById.has(id)) {
        affected.add(id);
        queue.push(id);
      }
    };
    // 规则1：依赖传播（后继传递闭包）
    for (const child of dependents.get(current) ?? []) tryAdd(child);
    // 规则2a：同工序类型传播——受影响工序在能力池中的空档变化，
    //         可能改变所有共用该能力池的工序对织机的比较结论（含其它织机）。
    const currentStep = stepById.get(current);
    if (currentStep) {
      for (const id of stepsOfType.get(currentStep.processType) ?? []) tryAdd(id);
    }
    // 规则2b：能力池织机传播——受影响工序只会在其工序类型的能力池
    //         （含基线所在织机）内改换档期；凡基线落在这些织机上的工序，
    //         所见空档都可能变化（含其它工序类型）。
    const entry = entryByStep.get(current);
    const pool = new Set(poolOfType.get(currentStep?.processType ?? '') ?? []);
    if (entry) pool.add(entry.loomId);
    for (const other of baseline.entries) {
      if (pool.has(other.loomId)) tryAdd(other.stepId);
    }
  }
  return [...affected].sort();
}

export function rescheduleIncremental(
  input: SchedulingInput,
  baseline: ScheduleResult,
  change: SchedulingChange,
): IncrementalResult {
  const changed = applyChange(input, change);
  const findings = validateInput(changed);
  if (hasErrors(findings)) {
    return {
      ok: false,
      findings,
      affectedStepIds: [],
      result: { ok: false, findings, entries: [], adjudications: [], loomSummaries: [], orderSummaries: [] },
    };
  }
  const affectedStepIds = computeAffected(changed, baseline, change);
  const affectedSet = new Set(affectedStepIds);
  const anchorEntries = new Map<string, ScheduledStep>();
  const anchorAdjudications = new Map<string, Adjudication>();
  for (const entry of baseline.entries) {
    if (!affectedSet.has(entry.stepId)) anchorEntries.set(entry.stepId, entry);
  }
  for (const adj of baseline.adjudications) {
    if (!affectedSet.has(adj.stepId)) anchorAdjudications.set(adj.stepId, adj);
  }
  const anchors: ScheduleAnchors = { entries: anchorEntries, adjudications: anchorAdjudications };
  const result = runSchedule(changed, anchors);
  return { ok: result.ok, findings: result.findings, affectedStepIds, result };
}
