import { generateShapes } from "./generate";
import type { Layer } from "./types";

function traceShape(
  ctx: CanvasRenderingContext2D,
  type: Layer["shapeType"],
  radius: number,
) {
  ctx.beginPath();
  switch (type) {
    case "circle":
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      break;
    case "ring":
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2, true);
      break;
    case "rect": {
      const s = radius * 1.7;
      ctx.rect(-s / 2, -s / 2, s, s);
      break;
    }
    case "triangle": {
      const r = radius * 1.15;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        const vx = Math.cos(a) * r;
        const vy = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      break;
    }
    case "star": {
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? radius * 1.2 : radius * 0.5;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const vx = Math.cos(a) * r;
        const vy = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      break;
    }
  }
}

/** 第一层 + 离屏栅格化：把单层的形状序列绘制到一张透明画布上。 */
export function renderLayer(layer: Layer, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d")!;
  const shortSide = Math.min(canvas.width, canvas.height);
  const shapes = generateShapes(layer);

  for (const shape of shapes) {
    const radius = Math.max(0.5, shape.size * shortSide);
    const px = shape.x * canvas.width;
    const py = shape.y * canvas.height;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(shape.rotation);
    ctx.fillStyle = shape.color;
    traceShape(ctx, layer.shapeType, radius);
    // 形状全部用非零环绕填充；ring 的内孔通过反向子路径挖空
    ctx.fill("nonzero");
    ctx.restore();
  }
  return canvas;
}

export interface CompositeOptions {
  background: string;
}

/**
 * 第二、三层处理：按图层顺序与混合模式把各层离屏画布合成到目标画布。
 * 隐藏层直接跳过——结果与该层从未存在完全一致。
 */
export function compositeLayers(
  target: CanvasRenderingContext2D,
  layerCanvases: { layer: Layer; canvas: HTMLCanvasElement }[],
  width: number,
  height: number,
  options: CompositeOptions,
): void {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
  target.fillStyle = options.background;
  target.fillRect(0, 0, width, height);

  for (const { layer, canvas } of layerCanvases) {
    if (!layer.visible) continue;
    if (layer.opacity <= 0) continue;
    target.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
    target.globalCompositeOperation = layer.blendMode;
    target.drawImage(canvas, 0, 0, width, height);
  }

  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
  target.restore();
}
