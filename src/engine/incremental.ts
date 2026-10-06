/**
 * 增量重推：
 *   1) 结构层（环/引用/拓扑）总是廉价重建，结构一变即全量结算（结构变化必影响全局顺序）；
 *   2) 属性类编辑（配比/库存/强度/余量）只播种直接引用的工序；
 *   3) 受影响集沿「依赖后继」与「同资源消费者后缀」两条边传播；
 *   4) 未受影响工序直接复用上一轮结算，受影响工序逐工序重算。
 * 不变量：产物与 runFullInference(applyEdits(cfg, ops)) 逐项一致（由 batch 入口断言）。
 */
import {
  initSim,
  settleStep,
  settleStructuralBlocked,
  skippedOutcomes,
  structuralConflicts,
  finalize,
} from "./inference.js";
import type { EditOp } from "./edits.js";
import type { InferenceResult, StepOutcome, WorkshopConfig } from "./types.js";

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function structuralChanged(cfg: WorkshopConfig, prev: InferenceResult): boolean {
  const sim0 = initSim(cfg);
  const cur = {
    topoOrder: sim0.topo.order,
    blockedKeys: [...sim0.topo.structurallyBlocked.keys()].sort(),
    cycles: sim0.idx.cycleGroups,
    missing: [...sim0.idx.missing.keys()].sort(),
  };
  const old = {
    topoOrder: prev.structure.topoOrder,
    blockedKeys: Object.keys(prev.structure.blocked).sort(),
    cycles: prev.structure.cycles,
    missing: prev.structure.missing,
  };
  if (!sameStringArray(cur.topoOrder, old.topoOrder)) return true;
  if (!sameStringArray(cur.blockedKeys, old.blockedKeys)) return true;
  if (!sameStringArray(cur.missing, old.missing)) return true;
  if (cur.cycles.length !== old.cycles.length) return true;
  return cur.cycles.some((g, i) => !sameStringArray(g, old.cycles[i]));
}

const STRUCTURAL_STEP_FIELDS = new Set(["prerequisites", "materialId", "sandId", "disabled"]);

export function runIncrementalInference(
  cfg: WorkshopConfig,
  prev: InferenceResult,
  ops: EditOp[],
): InferenceResult {
  const forceFull =
    ops.some((op) => op.kind !== "material" && op.kind !== "sand" && op.kind !== "step") ||
    ops.some((op) => op.kind === "step" && Object.keys(op.patch).some((k) => STRUCTURAL_STEP_FIELDS.has(k))) ||
    structuralChanged(cfg, prev);

  const sim = initSim(cfg);
  structuralConflicts(sim);
  skippedOutcomes(sim, cfg);
  let recomputed = cfg.steps.filter((s) => s.disabled).length;

  // ---- 受影响集 ----
  const dirty = new Set<string>();
  if (forceFull) {
    for (const id of sim.idx.activeIds) dirty.add(id);
  } else {
    for (const op of ops) {
      if (op.kind === "material") {
        for (const id of sim.idx.activeIds) {
          if (sim.idx.stepById.get(id)!.materialId === op.id) dirty.add(id);
        }
      } else if (op.kind === "sand") {
        for (const id of sim.idx.activeIds) {
          if (sim.idx.stepById.get(id)!.sandId === op.id) dirty.add(id);
        }
      } else if (op.kind === "step") {
        if (sim.idx.activeIds.has(op.id)) dirty.add(op.id);
      }
    }
    // 沿依赖后继下传
    for (const id of [...dirty]) {
      const stack = [...sim.idx.succs.get(id)!];
      while (stack.length) {
        const w = stack.pop()!;
        if (!dirty.has(w)) {
          dirty.add(w);
          stack.push(...sim.idx.succs.get(w)!);
        }
      }
    }
    // 同资源消费者后缀：资源状态一旦在中途变化，其后全部消费者都受影响
    const pos = new Map(sim.topo.order.map((id, i) => [id, i]));
    const propagateByResource = (resourceKind: "material" | "sand") => {
      const byResource = new Map<string, string[]>();
      for (const id of sim.topo.order) {
        const step = sim.idx.stepById.get(id)!;
        const r = resourceKind === "material" ? step.materialId : step.sandId;
        if (!r) continue;
        if (!byResource.has(r)) byResource.set(r, []);
        byResource.get(r)!.push(id);
      }
      for (const consumers of byResource.values()) {
        consumers.sort((a, b) => pos.get(a)! - pos.get(b)!);
        const firstDirty = consumers.findIndex((id) => dirty.has(id));
        if (firstDirty >= 0) for (let i = firstDirty; i < consumers.length; i++) dirty.add(consumers[i]);
      }
    };
    propagateByResource("material");
    propagateByResource("sand");
  }

  // ---- 逐工序：受影响重算，未受影响复用 ----
  let reused = 0;
  for (const id of sim.topo.order) {
    const prevOutcome: StepOutcome | undefined = prev.outcomes[id];
    if (!forceFull && !dirty.has(id) && prevOutcome) {
      sim.outcomes.set(id, prevOutcome);
      // 该工序结算未变，其资源类冲突结论同样不变，按原位带回
      for (const c of prev.conflicts) {
        if (
          c.subjectId === id &&
          (c.kind === "material-shortage" ||
            c.kind === "sand-shortage" ||
            c.kind === "sand-not-applicable")
        ) {
          sim.conflicts.push(c);
        }
      }
      if (prevOutcome.status === "ready") {
        sim.completed.add(id);
        const step = sim.idx.stepById.get(id)!;
        if (step.materialId) sim.materialAvail.set(step.materialId, prevOutcome.materialAfter!);
        if (step.sandId) sim.sandAvail.set(step.sandId, prevOutcome.sandAfter!);
        sim.execOrder = Math.max(sim.execOrder, prevOutcome.order + 1);
        for (const row of prev.consumption) {
          if (row.stepId === id) sim.consumption.push(row);
        }
      }
      reused++;
    } else {
      settleStep(sim, id);
      recomputed++;
    }
  }
  settleStructuralBlocked(sim);

  return finalize(sim, cfg, "incremental", recomputed, reused);
}
