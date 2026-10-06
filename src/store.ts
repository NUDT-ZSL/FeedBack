import { create } from "zustand";
import { adjudicationOptions, ratioImpact } from "./engine/adjudicate.js";
import { runBatchInference, type BatchReport } from "./engine/batch.js";
import { applyEdits, type EditOp } from "./engine/edits.js";
import { runFullInference } from "./engine/inference.js";
import { runIncrementalInference } from "./engine/incremental.js";
import { sampleConfig } from "./engine/samples.js";
import type {
  Adjudication,
  Conflict,
  InferenceResult,
  JadeMaterial,
  ProcessStep,
  RatioImpactRow,
  SandBatch,
  WorkshopConfig,
} from "./engine/types.js";

let seq = 100;
const nextId = (p: string) => `${p}${++seq}`;

interface WorkshopState {
  cfg: WorkshopConfig;
  result: InferenceResult;
  impacts: RatioImpactRow[];
  adjudications: Adjudication[];
  batchReport: BatchReport | null;
  wizardStep: number;

  setWizardStep: (n: number) => void;
  change: (ops: EditOp[]) => void;
  rerunFull: () => void;
  resolveConflict: (conflictId: string, action: string) => void;
  runBatch: () => void;
  resetSample: () => void;

  addMaterial: () => void;
  addSand: () => void;
  addStep: () => void;
}

function freshInference(cfg: WorkshopConfig): InferenceResult {
  return runFullInference(cfg);
}

const initialCfg = sampleConfig();

export const useWorkshop = create<WorkshopState>((set, get) => ({
  cfg: initialCfg,
  result: freshInference(initialCfg),
  impacts: [],
  adjudications: [],
  batchReport: null,
  wizardStep: 0,

  setWizardStep: (n) => set({ wizardStep: n }),

  change: (ops) => {
    if (!ops.length) return;
    const { cfg, result } = get();
    const nextCfg = applyEdits(cfg, ops);
    const nextResult = runIncrementalInference(nextCfg, result, ops);
    set({ cfg: nextCfg, result: nextResult, impacts: ratioImpact(result, nextResult, nextCfg) });
  },

  rerunFull: () => {
    const { cfg } = get();
    set({ result: runFullInference(cfg), impacts: [] });
  },

  resolveConflict: (conflictId, action) => {
    const { cfg, result, adjudications } = get();
    const conflict: Conflict | undefined = result.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    const option = adjudicationOptions(cfg, conflict).find((o) => o.action === action);
    if (!option) return;
    const ops = [];
    for (const [id, p] of Object.entries(option.patch.sand ?? {})) ops.push({ kind: "sand" as const, id, patch: p });
    for (const [id, p] of Object.entries(option.patch.material ?? {})) ops.push({ kind: "material" as const, id, patch: p });
    for (const [id, p] of Object.entries(option.patch.step ?? {})) ops.push({ kind: "step" as const, id, patch: p });
    const nextCfg = applyEdits(cfg, ops);
    const nextResult = runIncrementalInference(nextCfg, result, ops);
    const record: Adjudication = {
      id: `adj-${adjudications.length + 1}`,
      at: Date.now(),
      conflictId,
      action,
      label: option.label,
      patch: option.patch,
    };
    set({
      cfg: nextCfg,
      result: nextResult,
      adjudications: [...adjudications, record],
      impacts: ratioImpact(result, nextResult, nextCfg),
    });
  },

  runBatch: () => set({ batchReport: runBatchInference() }),
  resetSample: () => {
    const cfg = sampleConfig();
    set({ cfg, result: freshInference(cfg), impacts: [], adjudications: [], batchReport: null });
  },

  addMaterial: () =>
    get().change([
      {
        kind: "add-material",
        material: { id: nextId("m"), name: "新玉料", hardness: 6, sizeCm: 10, remaining: 5, source: "未标记" } satisfies JadeMaterial,
      },
    ]),
  addSand: () =>
    get().change([
      {
        kind: "add-sand",
        sand: { id: nextId("s"), name: "新解玉砂", grit: 120, ratio: 0.5, stock: 10, applicable: [] } satisfies SandBatch,
      },
    ]),
  addStep: () =>
    get().change([
      {
        kind: "add-step",
        step: {
          id: nextId("p"),
          name: "新工序",
          materialId: get().cfg.materials[0]?.id ?? "",
          sandId: get().cfg.sands[0]?.id ?? "",
          sandBase: 1,
          prerequisites: [],
          duration: 1,
          intensity: 1,
        } satisfies ProcessStep,
      },
    ]),
}));
