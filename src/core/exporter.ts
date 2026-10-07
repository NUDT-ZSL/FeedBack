/**
 * 导出产物：把缓存的合成层按固定方式装入 600x800 木匣。
 * 全部参数均来自配方与合成层，不含随机数，因此导出与页面所见、历次导出之间完全一致。
 */

import type { Surface, SurfaceFactory } from './surface.ts';
import { BASE_COLORS, GOLD_DENSITY_COUNTS } from './types.ts';
import type { LightMode, PaperRecipe } from './types.ts';
import { resolveGoldCount } from './recipe.ts';

export const EXPORT_WIDTH = 600;
export const EXPORT_HEIGHT = 800;

const FRAME_COLOR = '#5c3a21';
const GOLD_LINE = '#d4af37';
const COPPER_COLOR = '#b08d57';
const FRAME_INSET = 40;

export interface ExportArtifact {
  readonly id: string;
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly lightMode: LightMode;
  readonly surface: Surface;
  readonly shareText: string;
}

export function buildShareText(recipe: PaperRecipe, lightMode: LightMode): string {
  const colorName = BASE_COLORS.find((color) => color.hex === recipe.baseColor)?.name ?? recipe.baseColor;
  const goldCount = resolveGoldCount(recipe.goldFoil.density);
  const presetName = Object.entries(GOLD_DENSITY_COUNTS).find(([, count]) => count === goldCount)?.[0];
  const goldLabel =
    goldCount === 0
      ? '无洒金'
      : presetName === 'sparse'
        ? '稀疏'
        : presetName === 'medium'
          ? '适中'
          : presetName === 'dense'
            ? '密集'
            : `${goldCount}片`;
  const patternCount = recipe.patterns.length;
  const inscriptionPart = recipe.inscription.text ? `，题字「${recipe.inscription.text}」` : '';
  const lightLabel = lightMode === 'daylight' ? '日光' : '烛光';
  return `古风笺纸：${colorName}宣纸 · 印花${patternCount}枚 · 洒金${goldLabel}${inscriptionPart}（${lightLabel}模式）`;
}

export function renderExportArtifact(
  factory: SurfaceFactory,
  key: string,
  composite: Surface,
  recipe: PaperRecipe,
  lightMode: LightMode,
): ExportArtifact {
  const surface = factory(EXPORT_WIDTH, EXPORT_HEIGHT, `export:${key}`);
  const ctx = surface.getContext();

  // 木匣底
  ctx.setFillStyle(FRAME_COLOR);
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

  // 纸面区域（合成层等比铺满，所见即所得）
  const paperX = FRAME_INSET;
  const paperY = FRAME_INSET;
  const paperW = EXPORT_WIDTH - FRAME_INSET * 2;
  const paperH = EXPORT_HEIGHT - FRAME_INSET * 2;
  ctx.drawImage(composite, paperX, paperY, paperW, paperH);

  // 金线内框
  ctx.setStrokeStyle(GOLD_LINE);
  ctx.setLineWidth(2);
  ctx.strokeRect(paperX - 8, paperY - 8, paperW + 16, paperH + 16);

  // 四角铜扣
  ctx.setFillStyle(COPPER_COLOR);
  const buckle = 10;
  const positions = [
    [paperX - 20, paperY - 20],
    [paperX + paperW + 10, paperY - 20],
    [paperX - 20, paperY + paperH + 10],
    [paperX + paperW + 10, paperY + paperH + 10],
  ];
  positions.forEach(([x, y]) => ctx.fillRect(x, y, buckle, buckle));

  return {
    id: key,
    key,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    lightMode,
    surface,
    shareText: buildShareText(recipe, lightMode),
  };
}
