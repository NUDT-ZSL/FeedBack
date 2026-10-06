/**
 * 确定性消耗公式。
 * 砂配比是跨工序传导量：同一批砂的 ratio 变化会同时改写所有引用它的工序。
 */
import type { JadeMaterial, ProcessStep, SandBatch } from "./types.js";

/**
 * 有效砂耗 = 砂量基数 × 标准配比(0.5) / 当前配比。
 * 配比越高砂浆越省砂；ratio<=0 视为废浆不可用（调用方先判定）。
 */
export function effectiveSandUse(step: ProcessStep, sand: SandBatch): number {
  const ratio = sand.ratio > 0 ? sand.ratio : 0.25;
  return round3(step.sandBase * (0.5 / ratio));
}

/**
 * 玉料损耗 = 切削强度 × 砂量基数 × 硬度系数 / 粒度系数 × (1.25 - 配比)。
 * 粒度越细（目数大）玉损越小；配比越高玉损越小。
 */
export function jadeLoss(
  step: ProcessStep,
  material: JadeMaterial,
  sand: SandBatch | null,
): number {
  const hardnessFactor = 0.6 + material.hardness / 10; // 0.7~1.6
  const gritFactor = sand ? 200 / Math.max(50, sand.grit) : 0.4; // 粗砂更伤料
  const ratioFactor = sand ? 1.25 - clamp(sand.ratio, 0.05, 0.95) : 1;
  const raw = step.intensity * step.sandBase * hardnessFactor * gritFactor * ratioFactor;
  return round3(raw);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function isApplicable(sand: SandBatch, stepName: string): boolean {
  return sand.applicable.includes(stepName);
}
