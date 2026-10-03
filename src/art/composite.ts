import type { ArtLayer, BlendMode, Shape } from './types';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;
export const BACKGROUND = '#0f0f1a';

const VALID_BLEND_MODES: ReadonlySet<string> = new Set([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function sanitizeBlendMode(mode: BlendMode): GlobalCompositeOperation {
  return (VALID_BLEND_MODES.has(mode) ? mode : 'source-over') as GlobalCompositeOperation;
}

export interface RenderInput {
  layers: ArtLayer[];
  shapesByLayer: Map<string, Shape[]>;
}

// 合成阶段：只读取图层的可见性/透明度/混合模式与图层顺序，
// 不触碰任何生成参数，因此合成参数变化不会反过来影响形状序列。
export function renderComposition(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.restore();

  for (const layer of input.layers) {
    if (!layer.visible) continue;
    const shapes = input.shapesByLayer.get(layer.id);
    if (!shapes || shapes.length === 0) continue;

    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity);
    ctx.globalCompositeOperation = sanitizeBlendMode(layer.blendMode);
    for (const shape of shapes) {
      drawShape(ctx, shape);
    }
    ctx.restore();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const shortSide = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT);
  const r = shape.radius * shortSide;
  if (!(r > 0)) return; // 尺寸为 0 的形状跳过，不影响其余形状

  const cx = shape.x * CANVAS_WIDTH;
  const cy = shape.y * CANVAS_HEIGHT;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(shape.rotation);
  ctx.fillStyle = `hsl(${shape.hue}, ${shape.saturation}%, ${shape.lightness}%)`;
  ctx.beginPath();

  switch (shape.kind) {
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-r, -r, r * 2, r * 2);
      break;
    case 'triangle':
      tracePolygon(ctx, r, 3);
      break;
    case 'polygon':
      tracePolygon(ctx, r, shape.sides);
      break;
  }

  ctx.fill();
  ctx.restore();
}

function tracePolygon(ctx: CanvasRenderingContext2D, r: number, sides: number): void {
  const n = Math.max(3, Math.floor(sides));
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
