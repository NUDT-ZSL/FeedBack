/**
 * 浏览器端 Surface 适配：把 HTMLCanvasElement 包装成渲染引擎可用的表面。
 */

import type { RenderContext, Surface, SurfaceFactory, TextAlign, TextBaseline } from '../core/surface.ts';

class CanvasContextAdapter implements RenderContext {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}
  save(): void { this.ctx.save(); }
  restore(): void { this.ctx.restore(); }
  translate(x: number, y: number): void { this.ctx.translate(x, y); }
  rotate(angle: number): void { this.ctx.rotate(angle); }
  scale(x: number, y: number): void { this.ctx.scale(x, y); }
  beginPath(): void { this.ctx.beginPath(); }
  moveTo(x: number, y: number): void { this.ctx.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.ctx.lineTo(x, y); }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.ctx.arc(x, y, radius, startAngle, endAngle);
  }
  closePath(): void { this.ctx.closePath(); }
  fill(): void { this.ctx.fill(); }
  stroke(): void { this.ctx.stroke(); }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.ctx.fillRect(x, y, width, height);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.ctx.strokeRect(x, y, width, height);
  }
  fillText(text: string, x: number, y: number): void { this.ctx.fillText(text, x, y); }
  drawImage(surface: Surface, dx: number, dy: number, dw?: number, dh?: number): void {
    const canvas = (surface as CanvasSurface).canvas;
    if (dw === undefined) this.ctx.drawImage(canvas, dx, dy);
    else this.ctx.drawImage(canvas, dx, dy, dw, dh ?? dw);
  }
  setFillStyle(style: string): void { this.ctx.fillStyle = style; }
  setStrokeStyle(style: string): void { this.ctx.strokeStyle = style; }
  setLineWidth(width: number): void { this.ctx.lineWidth = width; }
  setGlobalAlpha(alpha: number): void { this.ctx.globalAlpha = alpha; }
  setFont(font: string): void { this.ctx.font = font; }
  setTextAlign(align: TextAlign): void { this.ctx.textAlign = align; }
  setTextBaseline(baseline: TextBaseline): void { this.ctx.textBaseline = baseline; }
}

export class CanvasSurface implements Surface {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasContextAdapter;
  readonly width: number;
  readonly height: number;
  readonly id: string;
  constructor(width: number, height: number, id: string, canvas?: HTMLCanvasElement) {
    this.width = width;
    this.height = height;
    this.id = id;
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 渲染上下文');
    this.context = new CanvasContextAdapter(ctx);
  }
  getContext(): RenderContext {
    return this.context;
  }
}

export const canvasSurfaceFactory: SurfaceFactory = (width, height, id) =>
  new CanvasSurface(width, height, id);

export function surfaceFromCanvas(canvas: HTMLCanvasElement, id = 'viewport'): CanvasSurface {
  return new CanvasSurface(canvas.width, canvas.height, id, canvas);
}
