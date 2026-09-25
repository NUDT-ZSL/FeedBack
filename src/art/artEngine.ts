import { hashObject } from './hash';
import { shiftHue } from './paletteManager';
import { SeededRandom } from './random';
import type { ArtConfig, CanvasSpec, DrawOp, RenderPlan } from './types';

export const PARAM_LIMITS = {
  hueShift: { min: -180, max: 180 },
  complexity: { min: 1, max: 10 },
  strokeWidth: { min: 1, max: 5 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 返回参数归一化后的新对象：越界值被钳制，输入不被修改。 */
export function normalizeConfig(config: ArtConfig): ArtConfig {
  return {
    ...config,
    colors: [...config.colors],
    shapes: [...config.shapes],
    hueShift: clamp(Math.round(config.hueShift), PARAM_LIMITS.hueShift.min, PARAM_LIMITS.hueShift.max),
    complexity: clamp(Math.round(config.complexity), PARAM_LIMITS.complexity.min, PARAM_LIMITS.complexity.max),
    strokeWidth: clamp(Math.round(config.strokeWidth), PARAM_LIMITS.strokeWidth.min, PARAM_LIMITS.strokeWidth.max),
    seed: config.seed >>> 0,
  };
}

/** 参数指纹：只取决于归一化后的参数，与对象构造顺序无关。 */
export function paramsHash(config: ArtConfig): string {
  const c = normalizeConfig(config);
  return hashObject({
    themeName: c.themeName,
    colors: c.colors,
    shapes: c.shapes,
    texture: c.texture,
    hueShift: c.hueShift,
    complexity: c.complexity,
    strokeWidth: c.strokeWidth,
    seed: c.seed,
  });
}

/**
 * 由配置与画布环境生成确定性渲染计划。
 * 同一 (config, canvas) 输入永远得到逐字节相同的计划，
 * 与调用先后、外部缓存无关。
 */
export function createRenderPlan(config: ArtConfig, canvas: CanvasSpec): RenderPlan {
  const c = normalizeConfig(config);
  const rng = new SeededRandom(c.seed);
  const opCount = c.complexity * 4;
  const ops: DrawOp[] = [];
  for (let i = 0; i < opCount; i += 1) {
    const layer = Math.floor((i * 3) / opCount);
    const sizeBase = layer === 0 ? 0.4 : layer === 1 ? 0.22 : 0.1;
    ops.push({
      layer,
      shape: c.shapes[i % c.shapes.length],
      x: round6(rng.range(0.05, 0.95)),
      y: round6(rng.range(0.05, 0.95)),
      size: round6(rng.range(sizeBase * 0.6, sizeBase)),
      rotation: round6(rng.range(0, 360)),
      color: shiftHue(c.colors[i % c.colors.length], c.hueShift),
      opacity: round6(rng.range(0.35, 0.95)),
      strokeWidth: c.strokeWidth,
    });
  }
  const angle = round6(rng.range(0, 360));
  return {
    background: {
      from: shiftHue(c.colors[0], c.hueShift),
      to: shiftHue(c.colors[c.colors.length - 1], c.hueShift),
      angle,
    },
    ops,
    meta: {
      seed: c.seed,
      paramsHash: paramsHash(c),
      canvas: { ...canvas },
      pixelWidth: Math.round(canvas.width * canvas.dpr),
      pixelHeight: Math.round(canvas.height * canvas.dpr),
    },
  };
}

/** 渲染计划指纹：预览缩略图与导出产物共用同一口径。 */
export function planHash(plan: RenderPlan): string {
  return hashObject(plan);
}
