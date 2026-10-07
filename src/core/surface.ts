/**
 * 可绘制表面（Surface）抽象：浏览器下是 Canvas，离线验证下是操作录制器。
 * 渲染器只依赖该抽象，从而同一份渲染代码既能出像素，也能出可比较的操作日志。
 */

import type { InscriptionConfig } from './types.ts';

export type TextAlign = InscriptionConfig['align'];
export type TextBaseline = 'top' | 'middle' | 'bottom' | 'alphabetic';

/** 渲染器使用的 2D 上下文最小子集（用方法而非属性，便于适配与录制） */
export interface RenderContext {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(surface: Surface, dx: number, dy: number, dw?: number, dh?: number): void;
  setFillStyle(style: string): void;
  setStrokeStyle(style: string): void;
  setLineWidth(width: number): void;
  setGlobalAlpha(alpha: number): void;
  setFont(font: string): void;
  setTextAlign(align: TextAlign): void;
  setTextBaseline(baseline: TextBaseline): void;
}

export interface Surface {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  getContext(): RenderContext;
}

export type SurfaceFactory = (width: number, height: number, id: string) => Surface;
