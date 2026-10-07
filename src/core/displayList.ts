/**
 * 显示列表（Display List）：分层渲染的统一产物格式。
 *
 * 每一层渲染结果都是一份纯数据 DrawOp[]，不直接触碰 Canvas。
 * - 预览（PreviewPanel）与导出（exporter）消费同一份指令序列，因此"所见即所出"；
 * - Node 离线验证无需浏览器/Canvas，直接对指令做结构化断言与哈希比对；
 * - paintOps 负责把指令绘制到任意兼容 CanvasRenderingContext2D 的表面。
 */

import { fnv1a } from './rng';

export interface Point {
  x: number;
  y: number;
}

export interface Transform2D {
  scale?: number;
  rotateDeg?: number;
  dx?: number;
  dy?: number;
}

export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lineWidth?: number; alpha?: number }
  | { kind: 'polygon'; points: Point[]; fill: string; alpha?: number; gradient?: { from: string; to: string } }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation?: number; fill?: string; stroke?: string; lineWidth?: number; alpha?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; lineWidth: number; alpha?: number }
  | { kind: 'text'; text: string; x: number; y: number; size: number; color: string; font?: string; align?: CanvasTextAlign; alpha?: number }
  | { kind: 'group'; ops: DrawOp[]; transform?: Transform2D; alpha?: number }
  | { kind: 'clip'; x: number; y: number; w: number; h: number; ops: DrawOp[] };

/** 单层渲染结果（不可变） */
export interface LayerOutput {
  kind: 'base' | 'pattern' | 'goldFoil' | 'inscription';
  /** 该层输入参数的哈希键；键不变则整层复用，不重算 */
  key: string;
  ops: DrawOp[];
  hash: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** 指令序列的稳定内容哈希（与对象创建顺序、运行次数无关） */
export function hashOps(ops: readonly DrawOp[]): string {
  return fnv1a(stableStringify(ops)).toString(16).padStart(8, '0');
}

/** 深冻结：渲染层结果与导出产物一旦生成即不可被后续参数变更打乱 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (!Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((v) => deepFreeze(v));
  }
  return value;
}

/** Canvas 兼容表面的最小契约（浏览器为 CanvasRenderingContext2D） */
export interface PaintContext {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, anticlockwise?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): {
    addColorStop(offset: number, color: string): void;
  };
  fillStyle: string | CanvasGradient;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  clip(): void;
}

/** 将显示列表绘制到目标表面；预览与导出共用，保证所见即所出 */
export function paintOps(ctx: PaintContext, ops: readonly DrawOp[]): void {
  for (const op of ops) paintOp(ctx, op);
}

function paintOp(ctx: PaintContext, op: DrawOp): void {
  switch (op.kind) {
    case 'rect':
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      if (op.stroke && op.lineWidth !== undefined) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lineWidth;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      }
      if (op.alpha !== undefined) ctx.globalAlpha = 1;
      break;
    case 'polygon': {
      ctx.beginPath();
      op.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      if (op.gradient) {
        const xs = op.points.map((p) => p.x);
        const ys = op.points.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const radius = Math.max(1, (Math.max(...xs) - Math.min(...xs)) / 2);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, op.gradient.from);
        grad.addColorStop(1, op.gradient.to);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = op.fill;
      }
      ctx.fill();
      if (op.alpha !== undefined) ctx.globalAlpha = 1;
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, ((op.rotation ?? 0) * Math.PI) / 180, 0, Math.PI * 2);
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill();
      }
      if (op.stroke && op.lineWidth !== undefined) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lineWidth;
        ctx.stroke();
      }
      if (op.alpha !== undefined) ctx.globalAlpha = 1;
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.lineWidth;
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      ctx.stroke();
      if (op.alpha !== undefined) ctx.globalAlpha = 1;
      break;
    case 'text':
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      ctx.font = `${op.size}px ${op.font ?? '"Ma Shan Zheng", "Noto Serif SC", serif'}`;
      ctx.textAlign = op.align ?? 'left';
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x, op.y);
      if (op.alpha !== undefined) ctx.globalAlpha = 1;
      break;
    case 'group': {
      ctx.save();
      if (op.alpha !== undefined) ctx.globalAlpha = op.alpha;
      if (op.transform) {
        const { dx = 0, dy = 0, scale = 1, rotateDeg = 0 } = op.transform;
        ctx.translate(dx, dy);
        if (rotateDeg !== 0) ctx.rotate((rotateDeg * Math.PI) / 180);
        if (scale !== 1) ctx.scale(scale, scale);
      }
      paintOps(ctx, op.ops);
      ctx.restore();
      break;
    }
    case 'clip':
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.x, op.y, op.w, op.h);
      ctx.clip();
      paintOps(ctx, op.ops);
      ctx.restore();
      break;
  }
}
