import { createRng, normalizeSeed } from "./random";
import type { GenerationParams, ShapeInstance } from "./types";

/**
 * 第一层处理：按种子为单层确定性地生成形状序列。
 *
 * 纯函数：输出只取决于生成参数（seed / shapeType / count / 尺寸区间 /
 * rotation / baseHue），与图层顺序、可见性、透明度、混合模式无关。
 * 同一组参数无论何时重算都返回完全相同的序列。
 */
export function generateShapes(params: GenerationParams): ShapeInstance[] {
  const count = Math.floor(params.count);
  // 边界：数量为 0/负，或尺寸区间上下限颠倒 → 该层不产生形状
  if (!Number.isFinite(count) || count <= 0) return [];
  const { minSize, maxSize } = params;
  if (
    !Number.isFinite(minSize) ||
    !Number.isFinite(maxSize) ||
    minSize > maxSize ||
    maxSize <= 0
  ) {
    return [];
  }

  const rng = createRng(normalizeSeed(params.seed));
  const shapes: ShapeInstance[] = [];
  const lo = Math.max(0, minSize);
  const span = maxSize - lo;
  const maxRotation = Number.isFinite(params.rotation) ? params.rotation : 0;
  const hue = Number.isFinite(params.baseHue) ? params.baseHue : 0;

  for (let i = 0; i < count; i++) {
    const x = rng();
    const y = rng();
    const size = lo + rng() * span;
    const rotation = rng() * maxRotation * (Math.PI / 180);
    const shapeHue = (hue + rng() * 60 - 30 + 360) % 360;
    const saturation = 55 + rng() * 35;
    const lightness = 45 + rng() * 25;
    shapes.push({
      x,
      y,
      size,
      rotation,
      color: `hsl(${shapeHue.toFixed(2)} ${saturation.toFixed(2)}% ${lightness.toFixed(2)}%)`,
    });
  }
  return shapes;
}
