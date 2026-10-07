/**
 * 配方归一化与分层指纹：
 * - normalizeRecipe 把所有参数夹取/归一到合法边界内，边界取值行为稳定；
 * - layerFingerprint 只取与该层真正相关的参数切片，参数变化只使相关层失效。
 */

import type { GoldDensity, LayerId, PaperRecipe, PatternConfig } from './types.ts';
import { DEFAULT_RECIPE, GOLD_DENSITY_COUNTS, GOLD_MAX_COUNT, LAYER_IDS } from './types.ts';
import { hashHex, stableStringify } from './random.ts';

export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return fallback;
}

function normalizeRotation(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

export function resolveGoldCount(density: GoldDensity): number {
  if (typeof density === 'string' && density in GOLD_DENSITY_COUNTS) {
    return GOLD_DENSITY_COUNTS[density as keyof typeof GOLD_DENSITY_COUNTS];
  }
  if (typeof density === 'number' && Number.isFinite(density)) {
    return Math.round(clamp(density, 0, GOLD_MAX_COUNT, GOLD_DENSITY_COUNTS.medium));
  }
  return GOLD_DENSITY_COUNTS.medium;
}

function normalizePattern(raw: Partial<PatternConfig>, index: number): PatternConfig {
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `pattern-${index}`,
    type: typeof raw.type === 'string' ? raw.type : 'plum',
    scale: clamp(raw.scale as number, 0.5, 3, 1),
    position: {
      x: clamp(raw.position?.x as number, 0, 100, 50),
      y: clamp(raw.position?.y as number, 0, 100, 50),
    },
    rotation: normalizeRotation(raw.rotation as number),
    opacity: clamp(raw.opacity as number, 0.3, 0.6, 0.45),
  };
}

/** 归一化配方：任何输入都会得到边界内、可稳定渲染的配方 */
export function normalizeRecipe(raw: Partial<PaperRecipe>): PaperRecipe {
  const base = DEFAULT_RECIPE;
  const size = {
    width: Math.round(clamp(raw.size?.width, 48, 4096, base.size.width)),
    height: Math.round(clamp(raw.size?.height, 48, 4096, base.size.height)),
  };
  const patterns = Array.isArray(raw.patterns) ? raw.patterns.map((p, i) => normalizePattern(p, i)) : [];
  const goldFoil = raw.goldFoil ?? base.goldFoil;
  const inscription = raw.inscription ?? base.inscription;
  const align = inscription.align;
  return {
    size,
    baseColor: normalizeHexColor(raw.baseColor, base.baseColor),
    patterns,
    goldFoil: {
      density: goldFoil.density ?? base.goldFoil.density,
      seed: Math.round(clamp(goldFoil.seed, 0, Number.MAX_SAFE_INTEGER, 0)),
    },
    inscription: {
      text: typeof inscription.text === 'string' ? inscription.text : '',
      fontSize: clamp(inscription.fontSize, 8, 120, base.inscription.fontSize),
      color: normalizeHexColor(inscription.color, base.inscription.color),
      position: {
        x: clamp(inscription.position?.x, 0, 100, base.inscription.position.x),
        y: clamp(inscription.position?.y, 0, 100, base.inscription.position.y),
      },
      align: align === 'left' || align === 'center' || align === 'right' ? align : base.inscription.align,
      vertical: inscription.vertical !== false,
    },
  };
}

export function cloneRecipe(recipe: PaperRecipe): PaperRecipe {
  return JSON.parse(JSON.stringify(recipe)) as PaperRecipe;
}

/** 每一层只依赖配方的一部分：尺寸影响全部层，其余各归各层 */
function layerSlice(recipe: PaperRecipe, layer: LayerId): unknown {
  switch (layer) {
    case 'base':
      return { size: recipe.size, baseColor: recipe.baseColor };
    case 'patterns':
      return { size: recipe.size, patterns: recipe.patterns };
    case 'goldFoil':
      return {
        size: recipe.size,
        goldFoil: { count: resolveGoldCount(recipe.goldFoil.density), seed: recipe.goldFoil.seed },
      };
    case 'inscription':
      return { size: recipe.size, inscription: recipe.inscription };
  }
}

export function layerFingerprint(recipe: PaperRecipe, layer: LayerId): string {
  return hashHex(`${layer}:${stableStringify(layerSlice(recipe, layer))}`);
}

export function layerFingerprints(recipe: PaperRecipe): Record<LayerId, string> {
  const result = {} as Record<LayerId, string>;
  for (const layer of LAYER_IDS) result[layer] = layerFingerprint(recipe, layer);
  return result;
}

export function recipeFingerprint(recipe: PaperRecipe): string {
  return hashHex(stableStringify(recipe));
}
