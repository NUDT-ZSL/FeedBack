/**
 * 整体从头重推：结构定序 → 逐工序结算 → 冲突与结论。
 * 纯函数、确定性：同一配置任意时刻重推结果一致。
 */
import { effectiveSandUse, isApplicable, jadeLoss, round3 } from "./formula.js";
import { buildIndex, topoOrder, type GraphIndex, type TopoResult } from "./graph.js";
import type {
  Conflict,
  ConsumptionRow,
  InferenceResult,
  ProcessStep,
  StepOutcome,
  WorkshopConfig,
} from "./types.js";

export interface SimState {
  idx: GraphIndex;
  topo: TopoResult;
  materialAvail: Map<string, number>;
  sandAvail: Map<string, number>;
  outcomes: Map<string, StepOutcome>;
  consumption: ConsumptionRow[];
  conflicts: Conflict[];
  completed: Set<string>;
  execOrder: number;
}

export function initSim(cfg: WorkshopConfig): SimState {
  const idx = buildIndex(cfg);
  const topo = topoOrder(idx);
  return {
    idx,
    topo,
    materialAvail: new Map(cfg.materials.map((m) => [m.id, m.remaining])),
    sandAvail: new Map(cfg.sands.map((s) => [s.id, s.stock])),
    outcomes: new Map(),
    consumption: [],
    conflicts: [],
    completed: new Set(),
    execOrder: 0,
  };
}

/** 结构类冲突（环 / 引用缺失）：保留全部相关方。 */
export function structuralConflicts(sim: SimState): void {
  for (const group of sim.idx.cycleGroups) {
    sim.conflicts.push({
      id: `cycle:${group.join("+")}`,
      kind: "cycle",
      subjectId: group[0],
      partyIds: [...group],
      message: `依赖成环：${group.join(" → ")} 互相前置，无法定序`,
      detail: { members: group },
    });
  }
  for (const [stepId, miss] of [...sim.idx.missing.entries()].sort()) {
    const parts: string[] = [];
    if (miss.material) parts.push("玉料引用缺失");
    if (miss.sand) parts.push("解玉砂引用缺失");
    if (miss.prereqs.length) parts.push(`前置引用缺失: ${miss.prereqs.join("、")}`);
    sim.conflicts.push({
      id: `missing-ref:${stepId}`,
      kind: "missing-ref",
      subjectId: stepId,
      partyIds: [stepId],
      message: `「${stepId}」${parts.join("；")}`,
      detail: { ...miss },
    });
  }
}

/** 结算单个工序（就地推进 sim 状态）。 */
export function settleStep(sim: SimState, stepId: string): StepOutcome {
  const { idx } = sim;
  const step = idx.stepById.get(stepId)!;
  const reasons: string[] = [];
  const base: StepOutcome = {
    stepId,
    status: "blocked",
    order: -1,
    sandUsed: 0,
    jadeLoss: 0,
    sandId: step.sandId,
    materialId: step.materialId,
    materialAfter: null,
    sandAfter: null,
    reasons,
  };

  const miss = idx.missing.get(stepId);
  if (miss) {
    base.status = "skipped";
    if (miss.material) reasons.push("玉料引用缺失");
    if (miss.sand) reasons.push("解玉砂引用缺失");
    for (const p of miss.prereqs) reasons.push(`前置引用缺失: ${p}`);
    sim.outcomes.set(stepId, base);
    return base;
  }

  const unDone = [...idx.preds.get(stepId)!].filter((p) => !sim.completed.has(p)).sort();
  if (unDone.length) {
    reasons.push(`前置工序未执行: ${unDone.join("、")}`);
    sim.outcomes.set(stepId, base);
    return base;
  }

  const material = idx.materialById.get(step.materialId);
  const sand = step.sandId ? idx.sandById.get(step.sandId) : undefined;

  if (sand && !isApplicable(sand, step.name)) {
    reasons.push(`砂「${sand.name}」不适用于工序「${step.name}」`);
    sim.conflicts.push({
      id: `sand-not-applicable:${stepId}`,
      kind: "sand-not-applicable",
      subjectId: stepId,
      partyIds: [stepId],
      resourceId: sand.id,
      message: `砂「${sand.name}」的适用工序不含「${step.name}」`,
      detail: { applicable: sand.applicable },
    });
    sim.outcomes.set(stepId, base);
    return base;
  }

  const sandNeed = sand ? effectiveSandUse(step, sand) : 0;
  const jadeNeed = material ? jadeLoss(step, material, sand ?? null) : 0;
  const matAvail = material ? sim.materialAvail.get(material.id)! : Infinity;
  const sandAvailNow = sand ? sim.sandAvail.get(sand.id)! : Infinity;

  if (material && jadeNeed > matAvail + 1e-9) {
    reasons.push(`玉料余量不足：需 ${jadeNeed}，余 ${round3(matAvail)}`);
    sim.conflicts.push(shortageConflict(sim, step, "material-shortage", material.id, jadeNeed, matAvail));
    sim.outcomes.set(stepId, base);
    return base;
  }
  if (sand && sandNeed > sandAvailNow + 1e-9) {
    reasons.push(`砂库存不足：需 ${sandNeed}，余 ${round3(sandAvailNow)}`);
    sim.conflicts.push(shortageConflict(sim, step, "sand-shortage", sand.id, sandNeed, sandAvailNow));
    sim.outcomes.set(stepId, base);
    return base;
  }

  // 执行：扣减资源，记录消耗分布
  if (material) {
    const after = round3(matAvail - jadeNeed);
    sim.materialAvail.set(material.id, after);
    base.jadeLoss = jadeNeed;
    base.materialAfter = after;
    sim.consumption.push({
      order: sim.execOrder,
      stepId,
      stepName: step.name,
      resource: material.name,
      resourceKind: "jade",
      before: round3(matAvail),
      used: jadeNeed,
      after,
    });
  }
  if (sand) {
    const after = round3(sandAvailNow - sandNeed);
    sim.sandAvail.set(sand.id, after);
    base.sandUsed = sandNeed;
    base.sandAfter = after;
    sim.consumption.push({
      order: sim.execOrder,
      stepId,
      stepName: step.name,
      resource: sand.name,
      resourceKind: "sand",
      before: round3(sandAvailNow),
      used: sandNeed,
      after,
    });
  }
  base.status = "ready";
  base.order = sim.execOrder;
  sim.execOrder += 1;
  sim.completed.add(stepId);
  sim.outcomes.set(stepId, base);
  return base;
}

/** 资源不足冲突：保留本工序与所有同资源竞争方，不静默择一。 */
function shortageConflict(
  sim: SimState,
  step: ProcessStep,
  kind: "material-shortage" | "sand-shortage",
  resourceId: string,
  required: number,
  available: number,
): Conflict {
  const contenders = [...sim.idx.activeIds]
    .filter((id) => {
      const s = sim.idx.stepById.get(id)!;
      return kind === "material-shortage" ? s.materialId === resourceId : s.sandId === resourceId;
    })
    .sort();
  const resourceName =
    kind === "material-shortage"
      ? sim.idx.materialById.get(resourceId)?.name ?? resourceId
      : sim.idx.sandById.get(resourceId)?.name ?? resourceId;
  return {
    id: `${kind}:${step.id}`,
    kind,
    subjectId: step.id,
    partyIds: contenders,
    resourceId,
    message: `「${step.name}」${kind === "material-shortage" ? "玉料" : "砂"}不足：需 ${required}，余 ${round3(available)}；竞争方：${contenders.join("、")}`,
    detail: {
      resource: resourceName,
      required,
      available: round3(available),
      contenders,
    },
  };
}

/** 禁用工序的占位结论。 */
export function skippedOutcomes(sim: SimState, cfg: WorkshopConfig): void {
  for (const step of cfg.steps) {
    if (!step.disabled) continue;
    sim.outcomes.set(step.id, {
      stepId: step.id,
      status: "skipped",
      order: -1,
      sandUsed: 0,
      jadeLoss: 0,
      sandId: step.sandId,
      materialId: step.materialId,
      materialAfter: null,
      sandAfter: null,
      reasons: ["已禁用（裁决暂停）"],
    });
  }
}

export function finalize(sim: SimState, cfg: WorkshopConfig, mode: "full" | "incremental", recomputed: number, reused: number): InferenceResult {
  // 执行序号是全局序列号：按定序结果统一重排，
  // 保证复用的工序结算在序号维度也与整体重推一致。
  const orderOf = new Map<string, number>();
  let seq = 0;
  for (const id of sim.topo.order) {
    const o = sim.outcomes.get(id);
    if (o && o.status === "ready") orderOf.set(id, seq++);
  }
  const outcomes: Record<string, StepOutcome> = {};
  let executed = 0, blocked = 0, skipped = 0;
  for (const [id, o] of sim.outcomes) {
    const normalized = o.status === "ready" ? { ...o, order: orderOf.get(id)! } : { ...o, order: -1 };
    outcomes[id] = normalized;
    if (normalized.status === "ready") executed++;
    else if (normalized.status === "blocked") blocked++;
    else skipped++;
  }
  const consumption = sim.consumption.map((row) => ({
    ...row,
    order: orderOf.get(row.stepId) ?? row.order,
  }));
  const materialFinal: Record<string, number> = {};
  for (const m of cfg.materials) materialFinal[m.id] = round3(sim.materialAvail.get(m.id) ?? m.remaining);
  const sandFinal: Record<string, number> = {};
  for (const s of cfg.sands) sandFinal[s.id] = round3(sim.sandAvail.get(s.id) ?? s.stock);

  const executedSteps = cfg.steps.filter((s) => outcomes[s.id]?.status === "ready");
  const last = executedSteps[executedSteps.length - 1];
  const lastMaterial = last ? cfg.materials.find((m) => m.id === last.materialId) : undefined;
  const totalDuration = executedSteps.reduce((acc, s) => acc + s.duration, 0);
  const completable = sim.conflicts.length === 0 && blocked === 0;
  const product = {
    productName: last && lastMaterial ? `${lastMaterial.name}·${last.name}器` : "（无成品）",
    completable,
    executedSteps: executed,
    totalSteps: cfg.steps.filter((s) => !s.disabled).length,
    totalDuration,
    endingMaterialId: last?.materialId ?? null,
    endingMaterialRemaining: last && lastMaterial ? materialFinal[lastMaterial.id] : null,
    summary: completable
      ? `全部 ${executed} 道工序可顺次完成，累计 ${totalDuration} 刻，产出「${lastMaterial?.name}·${last?.name}器」。`
      : `存在 ${sim.conflicts.length} 项冲突 / ${blocked} 道受阻工序，需裁决后重推。`,
  };

  return {
    order: sim.topo.order.filter((id) => outcomes[id]?.status === "ready"),
    outcomes,
    conflicts: sim.conflicts,
    consumption,
    materialFinal,
    sandFinal,
    product,
    structure: {
      topoOrder: sim.topo.order,
      blocked: Object.fromEntries(sim.topo.structurallyBlocked),
      cycles: sim.idx.cycleGroups,
      missing: [...sim.idx.missing.keys()].sort(),
    },
    meta: { mode, executed, blocked, skipped, recomputed, reused },
  };
}


/** 未能进入定序的启用工序（环上 / 被环卡住）：登记为 blocked，保留结构原因。 */
export function settleStructuralBlocked(sim: SimState): void {
  for (const [id, reasons] of sim.topo.structurallyBlocked) {
    const step = sim.idx.stepById.get(id);
    if (!step || sim.outcomes.has(id)) continue;
    sim.outcomes.set(id, {
      stepId: id,
      status: "blocked",
      order: -1,
      sandUsed: 0,
      jadeLoss: 0,
      sandId: step.sandId,
      materialId: step.materialId,
      materialAfter: null,
      sandAfter: null,
      reasons,
    });
  }
}

/** 整体从头重推。 */
export function runFullInference(cfg: WorkshopConfig): InferenceResult {
  const sim = initSim(cfg);
  structuralConflicts(sim);
  skippedOutcomes(sim, cfg);
  let recomputed = 0;
  for (const id of sim.topo.order) {
    settleStep(sim, id);
    recomputed++;
  }
  settleStructuralBlocked(sim);
  return finalize(sim, cfg, "full", recomputed, 0);
}
