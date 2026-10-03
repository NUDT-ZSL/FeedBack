import { createPRNG } from './prng';
import type { LayerGenParams, Shape, ShapeKind } from './types';

export const MAX_SHAPES_PER_LAYER = 1000;

// 形状序列只由生成参数（形状类型/数量/尺寸区间/旋转/种子）决定。
// 透明度、混合模式、可见性、图层顺序等合成参数不会进入这里，
// 因此它们的变更不可能改变已生成的形状序列。
export function generateShapes(params: LayerGenParams): Shape[] {
  const count = Math.min(Math.floor(params.count), MAX_SHAPES_PER_LAYER);
  const minSize = Math.min(params.minSize, params.maxSize);
  const maxSize = Math.max(params.minSize, params.maxSize);

  // 边界：数量为 0/负数，或尺寸区间无效（上下限颠倒后仍 <= 0）时，该层不产生形状
  if (!Number.isFinite(count) || count <= 0) return [];
  if (!Number.isFinite(maxSize) || maxSize <= 0) return [];

  const rand = createPRNG(params.seed);
  const shapes: Shape[] = [];

  for (let i = 0; i < count; i++) {
    // 固定的随机数消费顺序，保证同参数重算结果逐位一致
    const kindRoll = rand();
    const x = rand();
    const y = rand();
    const sizeRoll = rand();
    const rotRoll = rand();
    const hue = rand() * 360;
    const saturation = 55 + rand() * 45;
    const lightness = 35 + rand() * 40;

    const kind = resolveKind(params.shape, kindRoll);
    const size = minSize + (maxSize - minSize) * sizeRoll;
    const rotation = (rotRoll * 2 - 1) * (Math.max(0, params.rotation) * Math.PI) / 180;

    shapes.push({
      kind,
      x,
      y,
      radius: size / 2,
      rotation,
      hue,
      saturation,
      lightness,
      sides: 3 + Math.floor(kindRoll * 997) % 5, // 3-7 边，仅 polygon 使用
    });
  }

  return shapes;
}

function resolveKind(kind: ShapeKind, roll: number): Shape['kind'] {
  if (kind !== 'mixed') return kind;
  const idx = Math.floor(roll * 4) % 4;
  return (['circle', 'square', 'triangle', 'polygon'] as const)[idx];
}
