/**
 * 录制表面：把渲染操作记录为可比较的操作日志（离线验证用）。
 * 数值统一保留 4 位小数，drawImage 记录被引用表面的内容指纹，
 * 因此同一份参数在任意进程、任意次数下都得到逐字节一致的日志。
 */

import type { RenderContext, Surface, SurfaceFactory, TextAlign, TextBaseline } from './surface.ts';
import { hashHex } from './random.ts';

export type RecordedOp = [name: string, ...args: (string | number)[]];

function num(value: number): number {
  return Math.round(value * 10000) / 10000;
}

class RecordingContext implements RenderContext {
  readonly ops: RecordedOp[] = [];

  save(): void { this.ops.push(['save']); }
  restore(): void { this.ops.push(['restore']); }
  translate(x: number, y: number): void { this.ops.push(['translate', num(x), num(y)]); }
  rotate(angle: number): void { this.ops.push(['rotate', num(angle)]); }
  scale(x: number, y: number): void { this.ops.push(['scale', num(x), num(y)]); }
  beginPath(): void { this.ops.push(['beginPath']); }
  moveTo(x: number, y: number): void { this.ops.push(['moveTo', num(x), num(y)]); }
  lineTo(x: number, y: number): void { this.ops.push(['lineTo', num(x), num(y)]); }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.ops.push(['arc', num(x), num(y), num(radius), num(startAngle), num(endAngle)]);
  }
  closePath(): void { this.ops.push(['closePath']); }
  fill(): void { this.ops.push(['fill']); }
  stroke(): void { this.ops.push(['stroke']); }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.ops.push(['fillRect', num(x), num(y), num(width), num(height)]);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.ops.push(['strokeRect', num(x), num(y), num(width), num(height)]);
  }
  fillText(text: string, x: number, y: number): void { this.ops.push(['fillText', text, num(x), num(y)]); }
  drawImage(surface: Surface, dx: number, dy: number, dw?: number, dh?: number): void {
    this.ops.push([
      'drawImage',
      surface.id,
      num(dx),
      num(dy),
      ...(dw === undefined ? [] : [num(dw), num(dh ?? dw)]),
    ]);
  }
  setFillStyle(style: string): void { this.ops.push(['fillStyle', style]); }
  setStrokeStyle(style: string): void { this.ops.push(['strokeStyle', style]); }
  setLineWidth(width: number): void { this.ops.push(['lineWidth', num(width)]); }
  setGlobalAlpha(alpha: number): void { this.ops.push(['globalAlpha', num(alpha)]); }
  setFont(font: string): void { this.ops.push(['font', font]); }
  setTextAlign(align: TextAlign): void { this.ops.push(['textAlign', align]); }
  setTextBaseline(baseline: TextBaseline): void { this.ops.push(['textBaseline', baseline]); }
}

export class RecordingSurface implements Surface {
  readonly context = new RecordingContext();
  readonly width: number;
  readonly height: number;
  readonly id: string;
  constructor(width: number, height: number, id: string) {
    this.width = width;
    this.height = height;
    this.id = id;
  }
  getContext(): RenderContext {
    return this.context;
  }
}

export const recordingSurfaceFactory: SurfaceFactory = (width, height, id) =>
  new RecordingSurface(width, height, id);

export function serializeOps(surface: Surface): string {
  const context = surface.getContext() as RecordingContext;
  return context.ops.map((op) => op.join(' ')).join('\n');
}

export function hashSurface(surface: Surface): string {
  return hashHex(serializeOps(surface));
}
