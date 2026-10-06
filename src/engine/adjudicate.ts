/**
 * 裁决入口：为每类冲突生成可执行的裁决选项（结构化补丁）。
 * 裁决不静默择一——每个选项都是显式操作，落库为 Adjudication 记录后再重推。
 */
import { effectiveSandUse, jadeLoss, round3 } from "./formula.js";
import type { Conflict, EditPatch, WorkshopConfig } from "./types.js";

export interface AdjudicationOption {
  action: string;
  label: string;
  patch: EditPatch;
}

export function adjudicationOptions(cfg: WorkshopConfig, conflict: Conflict): AdjudicationOption[] {
  const step = cfg.steps.find((s) => s.id === conflict.subjectId);
  const opts: AdjudicationOption[] = [];
  if (!step) return opts;

  switch (conflict.kind) {
    case "cycle": {
      const members = (conflict.detail.members as string[]) ?? conflict.partyIds;
      for (const memberId of members) {
        const member = cfg.steps.find((s) => s.id === memberId);
        if (!member) continue;
        const inCyclePrereqs = member.prerequisites.filter((p) => members.includes(p));
        for (const p of inCyclePrereqs) {
          opts.push({
            action: `break-edge:${memberId}:${p}`,
            label: `断开「${member.name}」对「${cfg.steps.find((s) => s.id === p)?.name ?? p}」的前置依赖`,
            patch: { step: { [memberId]: { prerequisites: member.prerequisites.filter((x) => x !== p) } } },
          });
        }
        opts.push({
          action: `disable:${memberId}`,
          label: `暂停工序「${member.name}」`,
          patch: { step: { [memberId]: { disabled: true } } },
        });
      }
      break;
    }
    case "missing-ref": {
      const miss = conflict.detail as { prereqs?: string[] };
      if (miss.prereqs?.length) {
        opts.push({
          action: "drop-missing-prereqs",
          label: `移除缺失的前置引用（${miss.prereqs.join("、")}）`,
          patch: {
            step: {
              [step.id]: {
                prerequisites: step.prerequisites.filter((p) => !miss.prereqs!.includes(p)),
              },
            },
          },
        });
      }
      opts.push({
        action: `disable:${step.id}`,
        label: `暂停工序「${step.name}」`,
        patch: { step: { [step.id]: { disabled: true } } },
      });
      break;
    }
    case "material-shortage": {
      const required = conflict.detail.required as number;
      const available = conflict.detail.available as number;
      const material = cfg.materials.find((m) => m.id === conflict.resourceId);
      if (material) {
        const topped = round3(material.remaining + Math.max(0, required - available));
        opts.push({
          action: "replenish-material",
          label: `补足玉料「${material.name}」余量 ${round3(material.remaining)} → ${topped}`,
          patch: { material: { [material.id]: { remaining: topped } } },
        });
      }
      opts.push({
        action: "reduce-intensity",
        label: `降低「${step.name}」切削强度使损耗 ≤ 余量`,
        patch: reduceIntensityPatch(cfg, step.id, available),
      });
      for (const otherId of conflict.partyIds.filter((id) => id !== step.id)) {
        const other = cfg.steps.find((s) => s.id === otherId);
        if (other && !other.disabled) {
          opts.push({
            action: `disable:${otherId}`,
            label: `暂停竞争工序「${other.name}」，让料给「${step.name}」`,
            patch: { step: { [otherId]: { disabled: true } } },
          });
        }
      }
      break;
    }
    case "sand-shortage": {
      const required = conflict.detail.required as number;
      const available = conflict.detail.available as number;
      const sand = cfg.sands.find((s) => s.id === conflict.resourceId);
      if (sand) {
        const topped = round3(sand.stock + Math.max(0, required - available));
        opts.push({
          action: "replenish-sand",
          label: `补足砂「${sand.name}」库存 ${round3(sand.stock)} → ${topped} 斤`,
          patch: { sand: { [sand.id]: { stock: topped } } },
        });
        opts.push({
          action: "raise-ratio",
          label: `提高「${sand.name}」配比使本工序砂耗 ≤ 库存`,
          patch: raiseRatioPatch(cfg, step.id, sand.id, available),
        });
      }
      for (const otherId of conflict.partyIds.filter((id) => id !== step.id)) {
        const other = cfg.steps.find((s) => s.id === otherId);
        if (other && !other.disabled) {
          opts.push({
            action: `disable:${otherId}`,
            label: `暂停竞争工序「${other.name}」，让砂给「${step.name}」`,
            patch: { step: { [otherId]: { disabled: true } } },
          });
        }
      }
      break;
    }
    case "sand-not-applicable": {
      const sand = cfg.sands.find((s) => s.id === conflict.resourceId);
      if (sand) {
        opts.push({
          action: "extend-applicable",
          label: `将「${step.name}」加入砂「${sand.name}」的适用工序`,
          patch: { sand: { [sand.id]: { applicable: [...sand.applicable, step.name] } } },
        });
      }
      opts.push({
        action: `disable:${step.id}`,
        label: `暂停工序「${step.name}」`,
        patch: { step: { [step.id]: { disabled: true } } },
      });
      break;
    }
  }
  return opts;
}

function reduceIntensityPatch(cfg: WorkshopConfig, stepId: string, available: number): EditPatch {
  const step = cfg.steps.find((s) => s.id === stepId)!;
  const material = cfg.materials.find((m) => m.id === step.materialId);
  const sand = cfg.sands.find((s) => s.id === step.sandId) ?? null;
  if (!material) return { step: { [stepId]: { disabled: true } } };
  const current = jadeLoss(step, material, sand);
  if (current <= 0) return { step: { [stepId]: {} } };
  const scale = (available * 0.999) / current;
  return { step: { [stepId]: { intensity: round3(step.intensity * scale) } } };
}

function raiseRatioPatch(cfg: WorkshopConfig, stepId: string, sandId: string, available: number): EditPatch {
  const step = cfg.steps.find((s) => s.id === stepId)!;
  const sand = cfg.sands.find((s) => s.id === sandId)!;
  // effectiveSandUse = sandBase * 0.5 / ratio ≤ available → ratio ≥ sandBase*0.5/available
  const needRatio = (step.sandBase * 0.5) / Math.max(available, 1e-6);
  const ratio = Math.min(0.95, round3(needRatio * 1.001));
  if (ratio <= sand.ratio || needRatio > 0.95) return { sand: { [sandId]: {} } };
  return { sand: { [sandId]: { ratio } } };
}

/** 配比跨工序影响：对比两个结果中引用某砂的全部工序的砂耗与玉损合计。 */
export function ratioImpact(
  prev: import("./types.js").InferenceResult,
  next: import("./types.js").InferenceResult,
  cfg: WorkshopConfig,
): import("./types.js").RatioImpactRow[] {
  const rows: import("./types.js").RatioImpactRow[] = [];
  for (const sand of cfg.sands) {
    const stepIds = cfg.steps.filter((s) => s.sandId === sand.id && !s.disabled).map((s) => s.id);
    if (!stepIds.length) continue;
    let sandDelta = 0;
    let jadeDelta = 0;
    for (const id of stepIds) {
      sandDelta += (next.outcomes[id]?.sandUsed ?? 0) - (prev.outcomes[id]?.sandUsed ?? 0);
      jadeDelta += (next.outcomes[id]?.jadeLoss ?? 0) - (prev.outcomes[id]?.jadeLoss ?? 0);
    }
    if (sandDelta !== 0 || jadeDelta !== 0) {
      rows.push({
        sandId: sand.id,
        sandName: sand.name,
        affectedStepIds: stepIds,
        sandDelta: round3(sandDelta),
        jadeLossDelta: round3(jadeDelta),
      });
    }
  }
  return rows;
}
