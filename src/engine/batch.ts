/**
 * 统一批量推演入口。
 * 对固定样例按「属性调整 / 裁决」序列逐步打补丁：
 * 每一步都同时跑增量重推与整体从头重推并断言结论一致。
 */
import { adjudicationOptions, ratioImpact } from "./adjudicate.js";
import { applyEdits, deepEqual, patchToOps, type EditOp } from "./edits.js";
import { runIncrementalInference } from "./incremental.js";
import { runFullInference } from "./inference.js";
import { sampleConfig } from "./samples.js";
import type { Adjudication, Conflict, InferenceResult, WorkshopConfig } from "./types.js";

export interface BatchStepReport {
  label: string;
  ops: EditOp[];
  consistent: boolean;
  conflicts: number;
  executed: number;
  blocked: number;
  reused: number;
  recomputed: number;
  ratioImpacts: ReturnType<typeof ratioImpact>;
  adjudication?: { conflictId: string; action: string };
}

export interface BatchReport {
  consistent: boolean;
  steps: BatchStepReport[];
  finalConfig: WorkshopConfig;
  finalResult: InferenceResult;
  adjudicationLog: Adjudication[];
}

/** 抹掉模式与重推计数差异，只比业务结论。 */
function comparable(r: InferenceResult): unknown {
  return {
    order: r.order,
    outcomes: r.outcomes,
    conflicts: r.conflicts,
    consumption: r.consumption,
    materialFinal: r.materialFinal,
    sandFinal: r.sandFinal,
    product: r.product,
    structure: r.structure,
    counts: { executed: r.meta.executed, blocked: r.meta.blocked, skipped: r.meta.skipped },
  };
}

export function findOption(cfg: WorkshopConfig, result: InferenceResult, predicate: (c: Conflict) => boolean, actionPrefix: string) {
  const conflict = result.conflicts.find(predicate);
  if (!conflict) return undefined;
  const option = adjudicationOptions(cfg, conflict).find((o) => o.action.startsWith(actionPrefix));
  if (!option) return undefined;
  return { conflict, option };
}

export function runBatchInference(): BatchReport {
  let cfg: WorkshopConfig = sampleConfig();
  const log: Adjudication[] = [];
  const steps: BatchStepReport[] = [];
  let consistentAll = true;

  const recordStep = (label: string, ops: EditOp[], prev: InferenceResult, adjudication?: BatchStepReport["adjudication"]) => {
    const incremental = runIncrementalInference(cfg, prev, ops);
    const full = runFullInference(cfg);
    const ok = deepEqual(comparable(incremental), comparable(full));
    consistentAll = consistentAll && ok;
    const impacts = ratioImpact(prev, full, cfg);
    steps.push({
      label,
      ops,
      consistent: ok,
      conflicts: full.conflicts.length,
      executed: full.meta.executed,
      blocked: full.meta.blocked,
      reused: incremental.meta.reused,
      recomputed: incremental.meta.recomputed,
      ratioImpacts: impacts,
      adjudication,
    });
    return full;
  };

  // 第 0 步：初始全量基线
  let result = runFullInference(cfg);
  steps.push({
    label: "初始推演（全量基线）",
    ops: [],
    consistent: true,
    conflicts: result.conflicts.length,
    executed: result.meta.executed,
    blocked: result.meta.blocked,
    reused: 0,
    recomputed: result.meta.recomputed,
    ratioImpacts: [],
  });

  // 第 1 步：细砂配比 0.6 → 0.8（跨工序影响砂耗与玉损）
  {
    const ops: EditOp[] = [{ kind: "sand", id: "s2", patch: { ratio: 0.8 } }];
    const prev = result;
    cfg = applyEdits(cfg, ops);
    result = recordStep("细解玉砂配比 0.60 → 0.80", ops, prev);
  }

  // 第 2 步：裁决「砂库存不足」——补足库存
  {
    const found = findOption(cfg, result, (c) => c.kind === "sand-shortage", "replenish-sand");
    if (!found) throw new Error("缺少预期冲突：sand-shortage");
    const ops = patchToOps(found.option.patch);
    const prev = result;
    cfg = applyEdits(cfg, ops);
    log.push(makeAdjudication(found.conflict, found.option.action, found.option.label, found.option.patch, log.length));
    result = recordStep("裁决：补足细砂库存", ops, prev, { conflictId: found.conflict.id, action: found.option.action });
  }

  // 第 3 步：裁决「玉料余量不足」——补足玉料
  {
    const found = findOption(cfg, result, (c) => c.kind === "material-shortage", "replenish-material");
    if (!found) throw new Error("缺少预期冲突：material-shortage");
    const ops = patchToOps(found.option.patch);
    const prev = result;
    cfg = applyEdits(cfg, ops);
    log.push(makeAdjudication(found.conflict, found.option.action, found.option.label, found.option.patch, log.length));
    result = recordStep("裁决：补足岫岩青玉余量", ops, prev, { conflictId: found.conflict.id, action: found.option.action });
  }

  // 第 4 步：裁决「依赖成环」——断开 定型→掏膛 的环边
  {
    const found = findOption(cfg, result, (c) => c.kind === "cycle", "break-edge:p07:p06");
    if (!found) throw new Error("缺少预期冲突：cycle");
    const ops = patchToOps(found.option.patch);
    const prev = result;
    cfg = applyEdits(cfg, ops);
    log.push(makeAdjudication(found.conflict, found.option.action, found.option.label, found.option.patch, log.length));
    result = recordStep("裁决：断开「定型→掏膛」环边", ops, prev, { conflictId: found.conflict.id, action: found.option.action });
  }

  // 第 5 步：裁决「前置引用缺失」——移除缺失引用
  {
    const found = findOption(cfg, result, (c) => c.kind === "missing-ref", "drop-missing-prereqs");
    if (!found) throw new Error("缺少预期冲突：missing-ref");
    const ops = patchToOps(found.option.patch);
    const prev = result;
    cfg = applyEdits(cfg, ops);
    log.push(makeAdjudication(found.conflict, found.option.action, found.option.label, found.option.patch, log.length));
    result = recordStep("裁决：移除缺失的前置引用", ops, prev, { conflictId: found.conflict.id, action: found.option.action });
  }

  // 第 6 步：结构修复后砂的消耗顺序变化，上蜡暴露出新的砂不足，再裁决补足
  {
    const found = findOption(
      cfg,
      result,
      (c) => c.kind === "sand-shortage",
      "replenish-sand",
    );
    if (!found) throw new Error("缺少预期冲突：sand-shortage(收尾)");
    const ops = patchToOps(found.option.patch);
    const prev = result;
    cfg = applyEdits(cfg, ops);
    log.push(makeAdjudication(found.conflict, found.option.action, found.option.label, found.option.patch, log.length));
    result = recordStep("裁决：补足细砂库存（收尾）", ops, prev, { conflictId: found.conflict.id, action: found.option.action });
  }

  return { consistent: consistentAll, steps, finalConfig: cfg, finalResult: result, adjudicationLog: log };
}

function makeAdjudication(conflict: Conflict, action: string, label: string, patch: Adjudication["patch"], n: number): Adjudication {
  return { id: `adj-${n + 1}`, at: n + 1, conflictId: conflict.id, action, label, patch };
}
