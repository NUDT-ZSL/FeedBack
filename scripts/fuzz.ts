/**
 * 随机模糊校验：任意编辑序列（属性/结构/裁决）下，
 * 增量重推结论必须与整体从头重推一致。
 *   npm run infer:fuzz
 */
import { adjudicationOptions } from "../src/engine/adjudicate.js";
import { applyEdits, deepEqual, type EditOp } from "../src/engine/edits.js";
import { runFullInference } from "../src/engine/inference.js";
import { runIncrementalInference } from "../src/engine/incremental.js";
import { sampleConfig } from "../src/engine/samples.js";
import type { InferenceResult, WorkshopConfig } from "../src/engine/types.js";

function comparable(r: InferenceResult): unknown {
  return {
    order: r.order, outcomes: r.outcomes, conflicts: r.conflicts,
    consumption: r.consumption, materialFinal: r.materialFinal,
    sandFinal: r.sandFinal, product: r.product, structure: r.structure,
    counts: { executed: r.meta.executed, blocked: r.meta.blocked, skipped: r.meta.skipped },
  };
}

let seed = Number(process.env.SEED ?? 42);
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

function randomOp(cfg: WorkshopConfig): EditOp {
  const kind = pick(["material", "sand", "stepAttr", "stepStruct"] as const);
  if (kind === "material") {
    const m = pick(cfg.materials);
    return { kind: "material", id: m.id, patch: { remaining: Math.max(0, +(m.remaining + rand(-3, 4)).toFixed(2)) } };
  }
  if (kind === "sand") {
    const s = pick(cfg.sands);
    const field = pick(["ratio", "stock"] as const);
    if (field === "ratio") return { kind: "sand", id: s.id, patch: { ratio: +(rand(0.2, 0.9)).toFixed(2) } };
    return { kind: "sand", id: s.id, patch: { stock: Math.max(0, +(s.stock + rand(-4, 6)).toFixed(2)) } };
  }
  const s = pick(cfg.steps);
  if (kind === "stepAttr") {
    const field = pick(["sandBase", "intensity", "duration"] as const);
    return { kind: "step", id: s.id, patch: { [field]: Math.max(0.1, +(s[field] + rand(-1, 1.5)).toFixed(2)) } };
  }
  // 结构编辑：改前置 / 启停
  if (rng() < 0.5) return { kind: "step", id: s.id, patch: { disabled: !s.disabled } };
  const others = cfg.steps.filter((x) => x.id !== s.id).map((x) => x.id);
  const take = Math.floor(rand(0, 3));
  return { kind: "step", id: s.id, patch: { prerequisites: others.slice(0, take) } };
}

let cfg: WorkshopConfig = sampleConfig();
let prev = runFullInference(cfg);
const ITER = Number(process.env.ITER ?? 300);
let adjudicationCount = 0;

for (let i = 0; i < ITER; i++) {
  let ops: EditOp[] = [];
  // 有冲突时约 1/3 概率走裁决入口
  if (prev.conflicts.length && rng() < 0.33) {
    const c = pick(prev.conflicts);
    const options = adjudicationOptions(cfg, c);
    if (options.length) {
      const o = pick(options);
      for (const [id, p] of Object.entries(o.patch.sand ?? {})) ops.push({ kind: "sand", id, patch: p });
      for (const [id, p] of Object.entries(o.patch.material ?? {})) ops.push({ kind: "material", id, patch: p });
      for (const [id, p] of Object.entries(o.patch.step ?? {})) ops.push({ kind: "step", id, patch: p });
      adjudicationCount++;
    }
  }
  if (!ops.length) ops = [randomOp(cfg)];

  cfg = applyEdits(cfg, ops);
  const inc = runIncrementalInference(cfg, prev, ops);
  const full = runFullInference(cfg);
  if (!deepEqual(comparable(inc), comparable(full))) {
    console.error(`✗ 第 ${i + 1} 次编辑后增量与全量不一致 (seed=${seed})`);
    console.error("ops:", JSON.stringify(ops));
    const a = comparable(inc) as Record<string, unknown>;
    const b = comparable(full) as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (!deepEqual(a[k], b[k])) {
        console.error(`字段 ${k} 不一致:`);
        console.error("  增量:", JSON.stringify(a[k])?.slice(0, 2000));
        console.error("  全量:", JSON.stringify(b[k])?.slice(0, 2000));
      }
    }
    process.exit(1);
  }
  prev = inc;
}

console.log(`✓ ${ITER} 次随机编辑（含 ${adjudicationCount} 次裁决），增量重推与整体重推结论全部一致`);
