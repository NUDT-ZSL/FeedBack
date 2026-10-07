/**
 * 分层渲染器：每层只读取自己那部分参数，绘制到独立 Surface。
 * 固定层叠顺序 base -> patterns -> goldFoil -> inscription，
 * 题字最后绘制，永远不被纹样、洒金、底色遮挡。
 */

import type { LayerId, LightMode, PaperRecipe } from './types.ts';
import { LAYER_IDS } from './types.ts';
import type { RenderContext, Surface, SurfaceFactory } from './surface.ts';
import { hashString, mulberry32 } from './random.ts';
import { generateGoldFoilParticles } from './goldFoil.ts';
import { isKnownPatternType, PATTERN_COLORS, PATTERN_DRAWERS } from './patterns.ts';
import { resolveGoldCount } from './recipe.ts';

const FONT_STACK = '"Ma Shan Zheng", "STKaiti", "KaiTi", serif';

export function renderBaseLayer(ctx: RenderContext, recipe: PaperRecipe): void {
  const { width, height } = recipe.size;
  ctx.setFillStyle(recipe.baseColor);
  ctx.fillRect(0, 0, width, height);
  // 宣纸纤维纹理：只依赖尺寸的固定种子，稳定且不受底色变化影响其分布
  const rng = mulberry32(hashString(`fiber:${width}x${height}`));
  ctx.setStrokeStyle('#8d6e4f');
  ctx.setLineWidth(0.6);
  for (let i = 0; i < 90; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const length = 4 + rng() * 10;
    ctx.setGlobalAlpha(0.1 + rng() * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.setGlobalAlpha(1);
}

export function renderPatternsLayer(ctx: RenderContext, recipe: PaperRecipe): void {
  const { width, height } = recipe.size;
  // 按数组顺序绘制 = 层叠顺序；空数组为合法边界（该层保持空白，整体仍有底色）
  recipe.patterns.forEach((pattern) => {
    if (!isKnownPatternType(pattern.type)) return; // 未知类型稳定跳过，不产生错位
    const drawer = PATTERN_DRAWERS[pattern.type];
    const cx = (pattern.position.x / 100) * width;
    const cy = (pattern.position.y / 100) * height;
    const baseRadius = Math.min(width, height) * 0.11;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((pattern.rotation * Math.PI) / 180);
    ctx.scale(pattern.scale, pattern.scale);
    ctx.setGlobalAlpha(pattern.opacity);
    ctx.setFillStyle(PATTERN_COLORS[pattern.type]);
    ctx.setStrokeStyle(PATTERN_COLORS[pattern.type]);
    ctx.setLineWidth(2);
    drawer(ctx, baseRadius);
    ctx.restore();
  });
}

export function renderGoldFoilLayer(ctx: RenderContext, recipe: PaperRecipe): void {
  const count = resolveGoldCount(recipe.goldFoil.density);
  const particles = generateGoldFoilParticles(count, recipe.goldFoil.seed, recipe.size);
  particles.forEach((particle) => {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);
    // 金箔本体
    ctx.setFillStyle('#ffd700');
    ctx.beginPath();
    particle.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    // 高光：小一圈的亮色多边形，模拟径向光泽且对录制上下文友好
    ctx.setFillStyle('#fff8dc');
    ctx.setGlobalAlpha(0.6);
    ctx.beginPath();
    particle.points.forEach((point, index) => {
      const px = point.x * 0.5 - particle.size * 0.12;
      const py = point.y * 0.5 - particle.size * 0.12;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

export function renderInscriptionLayer(ctx: RenderContext, recipe: PaperRecipe): void {
  const { inscription } = recipe;
  const text = inscription.text ?? '';
  if (text.length === 0) return; // 无题字为合法边界：稳定留空
  const { width, height } = recipe.size;
  ctx.setFillStyle(inscription.color);
  ctx.setFont(`${inscription.fontSize}px ${FONT_STACK}`);
  ctx.setTextAlign(inscription.align);
  ctx.setTextBaseline('top');
  const anchorX = (inscription.position.x / 100) * width;
  const anchorY = (inscription.position.y / 100) * height;
  if (inscription.vertical) {
    // 竖排：逐字自上而下成行，每行从右向左；位置/对齐方式决定后不再受其它层影响
    const chars = Array.from(text);
    const lineHeight = inscription.fontSize * 1.15;
    const lineWidth = inscription.fontSize;
    const columnCount = Math.max(1, Math.ceil(chars.length / Math.max(1, Math.floor((height * 0.85) / lineHeight))));
    chars.forEach((char, index) => {
      const perColumn = Math.ceil(chars.length / columnCount);
      const column = Math.floor(index / perColumn);
      const row = index % perColumn;
      let x = anchorX - column * lineWidth;
      if (inscription.align === 'center') x = anchorX + (columnCount / 2 - column - 0.5) * lineWidth;
      if (inscription.align === 'left') x = anchorX + (columnCount - 1 - column) * lineWidth;
      ctx.fillText(char, x, anchorY + row * lineHeight);
    });
  } else {
    ctx.fillText(text, anchorX, anchorY);
  }
}

export const LAYER_RENDERERS: Record<LayerId, (ctx: RenderContext, recipe: PaperRecipe) => void> = {
  base: renderBaseLayer,
  patterns: renderPatternsLayer,
  goldFoil: renderGoldFoilLayer,
  inscription: renderInscriptionLayer,
};

/** 把四个缓存层按固定 z 序合成到目标表面 */
export function composeLayers(target: Surface, layers: Record<LayerId, Surface>): void {
  const ctx = target.getContext();
  for (const layerId of LAYER_IDS) ctx.drawImage(layers[layerId], 0, 0, target.width, target.height);
}

/** 光源模式叠加：作为最上层滤镜，不改动缓存的内容层 */
export function applyLightOverlay(ctx: RenderContext, mode: LightMode, width: number, height: number): void {
  if (mode === 'daylight') {
    ctx.setFillStyle('#fffdf2');
    ctx.setGlobalAlpha(0.08);
  } else {
    ctx.setFillStyle('#ff8c2e');
    ctx.setGlobalAlpha(0.2);
  }
  ctx.fillRect(0, 0, width, height);
  ctx.setGlobalAlpha(1);
}

export function createLayerSurface(
  factory: SurfaceFactory,
  layerId: LayerId,
  fingerprint: string,
  recipe: PaperRecipe,
): Surface {
  const surface = factory(recipe.size.width, recipe.size.height, `layer:${layerId}:${fingerprint}`);
  LAYER_RENDERERS[layerId](surface.getContext(), recipe);
  return surface;
}
