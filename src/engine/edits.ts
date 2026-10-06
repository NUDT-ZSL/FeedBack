/**
 * 不可变编辑补丁：录入修改、配比调整、裁决动作统一走 EditOp。
 */
import type { EditPatch, JadeMaterial, ProcessStep, SandBatch, WorkshopConfig } from "./types.js";

export type EditOp =
  | { kind: "material"; id: string; patch: Partial<JadeMaterial> }
  | { kind: "sand"; id: string; patch: Partial<SandBatch> }
  | { kind: "step"; id: string; patch: Partial<ProcessStep> }
  | { kind: "add-step"; step: ProcessStep }
  | { kind: "add-material"; material: JadeMaterial }
  | { kind: "add-sand"; sand: SandBatch }
  | { kind: "remove-step"; id: string };

export function applyEdits(cfg: WorkshopConfig, ops: EditOp[]): WorkshopConfig {
  let next: WorkshopConfig = {
    materials: [...cfg.materials],
    sands: [...cfg.sands],
    steps: [...cfg.steps],
  };
  for (const op of ops) {
    switch (op.kind) {
      case "material":
        next = {
          ...next,
          materials: next.materials.map((m) =>
            m.id === op.id ? { ...m, ...op.patch } : m,
          ),
        };
        break;
      case "sand":
        next = {
          ...next,
          sands: next.sands.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)),
        };
        break;
      case "step":
        next = {
          ...next,
          steps: next.steps.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)),
        };
        break;
      case "add-step":
        next = { ...next, steps: [...next.steps, op.step] };
        break;
      case "add-material":
        next = { ...next, materials: [...next.materials, op.material] };
        break;
      case "add-sand":
        next = { ...next, sands: [...next.sands, op.sand] };
        break;
      case "remove-step":
        next = { ...next, steps: next.steps.filter((s) => s.id !== op.id) };
        break;
    }
  }
  return next;
}

export function patchToOps(patch: EditPatch): EditOp[] {
  const ops: EditOp[] = [];
  for (const [id, p] of Object.entries(patch.sand ?? {})) ops.push({ kind: "sand", id, patch: p });
  for (const [id, p] of Object.entries(patch.material ?? {})) ops.push({ kind: "material", id, patch: p });
  for (const [id, p] of Object.entries(patch.step ?? {})) ops.push({ kind: "step", id, patch: p });
  return ops;
}

/** 深比较（键序无关），供一致性断言。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
