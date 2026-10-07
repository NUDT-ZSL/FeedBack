/**
 * 参数配置层：配方的归一化（边界收敛）、默认值与分层哈希键。
 *
 * 归一化保证：
 * - 任意越界输入（洒金密度负数/超 100、缩放超界、位置超界、角度非步长…）
 *   都收敛为合法稳定值，渲染与导出不会空白或错位；
 * - 归一化结果被冻结，后续渲染/导出拿到的都是同一份快照。
 */

import { fnv1a } from './rng';
import {
  LIMITS,
  PAPER_COLORS,
  PAPER_SIZES,
  PATTERN_TYPES,
  type InscriptionConfig,
  type PaperColorPreset,
  type PaperRecipe,
  type PaperSizePreset,
  type PatternLayerConfig,
  type PatternType,
} from './types';
import { deepFreeze, stableStringify } from './displayList';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getSize(sizeId: string): PaperSizePreset {
  return PAPER_SIZES.find((s) => s.id === sizeId) ?? PAPER_SIZES[0];
}

export function getColor(colorId: string): PaperColorPreset {
  return PAPER_COLORS.find((c) => c.id === colorId) ?? PAPER_COLORS[0];
}

function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const snapped = Math.round(deg / LIMITS.rotationStep) * LIMITS.rotationStep;
  return ((snapped % 360) + 360) % 360;
}

function normalizePosition(value: unknown): { x: number; y: number } {
  const p = (value ?? {}) as { x?: unknown; y?: unknown };
  const x = typeof p.x === 'number' ? p.x : Number(p.x);
  const y = typeof p.y === 'number' ? p.y : Number(p.y);
  return {
    x: clamp(Number.isFinite(x) ? x : 0, LIMITS.position.min, LIMITS.position.max),
    y: clamp(Number.isFinite(y) ? y : 0, LIMITS.position.min, LIMITS.position.max),
  };
}

function normalizePattern(layer: Partial<PatternLayerConfig>): PatternLayerConfig {
  const type = PATTERN_TYPES.some((p) => p.id === layer.type)
    ? (layer.type as PatternType)
    : PATTERN_TYPES[0].id;
  return {
    id: typeof layer.id === 'string' && layer.id.length > 0 ? layer.id : `p-${type}`,
    type,
    order: Number.isFinite(layer.order) ? Math.trunc(layer.order as number) : 0,
    scale: clamp(layer.scale ?? LIMITS.patternScale.min, LIMITS.patternScale.min, LIMITS.patternScale.max),
    position: normalizePosition(layer.position),
    rotation: normalizeRotation(layer.rotation ?? 0),
    opacity: clamp(layer.opacity ?? LIMITS.patternOpacity.min, LIMITS.patternOpacity.min, LIMITS.patternOpacity.max),
  };
}

function normalizeInscription(value: Partial<InscriptionConfig> | undefined): InscriptionConfig {
  return {
    text: typeof value?.text === 'string' ? value.text : '',
    layout: value?.layout === 'horizontal' ? 'horizontal' : 'vertical',
    position: normalizePosition(value?.position ?? { x: 50, y: 50 }),
    fontSize: clamp(value?.fontSize ?? 24, LIMITS.fontSize.min, LIMITS.fontSize.max),
    color: typeof value?.color === 'string' && value.color ? value.color : '#3e2723',
  };
}

/** 归一化整份配方：未知 id 回退预设、越界值收敛、角度取步长、结果冻结 */
export function normalizeRecipe(input: Partial<PaperRecipe> | PaperRecipe): PaperRecipe {
  const sizeId = PAPER_SIZES.some((s) => s.id === input.sizeId) ? input.sizeId! : PAPER_SIZES[0].id;
  const baseColorId = PAPER_COLORS.some((c) => c.id === input.baseColorId)
    ? input.baseColorId!
    : PAPER_COLORS[0].id;
  const patterns = Array.isArray(input.patterns)
    ? input.patterns.map((p) => normalizePattern(p ?? {}))
    : [];
  const densityInput = typeof input.goldFoil?.density === 'number' ? input.goldFoil.density : 50;
  const recipe: PaperRecipe = {
    sizeId,
    baseColorId,
    patterns,
    goldFoil: {
      density: Math.round(clamp(densityInput, LIMITS.goldDensity.min, LIMITS.goldDensity.max)),
    },
    inscription: normalizeInscription(input.inscription),
  };
  return deepFreeze(recipe);
}

/** 默认配方（标准笺 / 云白 / 单朵梅花 / 适中洒金 / 无题字） */
export function defaultRecipe(): PaperRecipe {
  return normalizeRecipe({
    sizeId: 'standard',
    baseColorId: 'yunbai',
    patterns: [
      {
        id: 'pattern-1',
        type: 'plum',
        order: 0,
        scale: 1.4,
        position: { x: 50, y: 45 },
        rotation: 0,
        opacity: 0.45,
      },
    ],
    goldFoil: { density: 50 },
    inscription: {
      text: '',
      layout: 'vertical',
      position: { x: 50, y: 50 },
      fontSize: 24,
      color: '#3e2723',
    },
  });
}

/**
 * 各层独立的输入哈希键。
 * 只有真正依赖的参数进入对应层的键——改底色不会改变纹样/洒金/题字键，反之亦然。
 */
export interface LayerKeys {
  base: string;
  patterns: { id: string; key: string }[];
  goldFoil: string;
  inscription: string;
}

export function layerKeys(recipe: PaperRecipe): LayerKeys {
  const size = getSize(recipe.sizeId);
  return {
    base: `base:${size.id}x${size.width}x${size.height}:${recipe.baseColorId}`,
    patterns: recipe.patterns.map((p) => ({
      id: p.id,
      key: [
        'pattern',
        size.id,
        size.width,
        size.height,
        p.id,
        p.type,
        p.scale,
        p.position.x,
        p.position.y,
        p.rotation,
        p.opacity,
      ].join(':'),
    })),
    goldFoil: `gold:${size.id}x${size.width}x${size.height}:${recipe.goldFoil.density}`,
    inscription: [
      'inscription',
      size.id,
      size.width,
      size.height,
      recipe.inscription.text,
      recipe.inscription.layout,
      recipe.inscription.position.x,
      recipe.inscription.position.y,
      recipe.inscription.fontSize,
      recipe.inscription.color,
    ].join(':'),
  };
}

/** 整份配方的内容哈希（归一化后），用于导出产物缓存 */
export function recipeHash(recipe: PaperRecipe): string {
  // 含层叠顺序等全部配置（order 不进单层渲染键，但必须影响导出产物身份）
  return fnv1a(stableStringify(recipe)).toString(16).padStart(8, '0');
}
