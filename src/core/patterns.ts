/**
 * 8 种古风印花的矢量绘制：每个印花是 RenderContext 上的纯绘制函数，
 * 以原点为中心、半径 r 为基准，不使用随机数（冰裂纹使用固定种子），
 * 因此同一参数下层叠顺序与形态在任意渲染次数下完全一致。
 */

import type { RenderContext } from './surface.ts';
import { hashString, mulberry32 } from './random.ts';

export const PATTERN_TYPES = [
  'plum',
  'orchid',
  'bamboo',
  'chrysanthemum',
  'cloud',
  'wave',
  'meander',
  'ice',
] as const;

export type PatternType = (typeof PATTERN_TYPES)[number];

export const PATTERN_LABELS: Record<string, string> = {
  plum: '梅花',
  orchid: '兰草',
  bamboo: '竹子',
  chrysanthemum: '菊花',
  cloud: '祥云',
  wave: '水纹',
  meander: '回纹',
  ice: '冰裂纹',
};

/** 每种印花的墨色（确定、不随渲染变化） */
export const PATTERN_COLORS: Record<string, string> = {
  plum: '#b85c6b',
  orchid: '#5a7d5a',
  bamboo: '#4f7a4a',
  chrysanthemum: '#c18a2e',
  cloud: '#6d7f93',
  wave: '#4f7a93',
  meander: '#8a5a2b',
  ice: '#7a8a99',
};

type PatternDrawer = (ctx: RenderContext, r: number) => void;

const circle = (ctx: RenderContext, x: number, y: number, r: number): void => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const drawPlum: PatternDrawer = (ctx, r) => {
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    circle(ctx, Math.cos(angle) * r * 0.42, Math.sin(angle) * r * 0.42, r * 0.3);
  }
  circle(ctx, 0, 0, r * 0.16);
};

const drawOrchid: PatternDrawer = (ctx, r) => {
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.8);
    ctx.arc(i * r * 0.25, r * 0.35, r * 0.45, -0.5, 1.1);
    ctx.stroke();
  }
  circle(ctx, 0, -r * 0.55, r * 0.18);
};

const drawBamboo: PatternDrawer = (ctx, r) => {
  ctx.fillRect(-r * 0.06, -r, r * 0.12, r * 2);
  for (let y = -1; y <= 1; y += 1) {
    ctx.fillRect(-r * 0.1, y * r * 0.6, r * 0.2, r * 0.05);
  }
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.3);
    ctx.lineTo(side * r * 0.55, -r * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(side * r * 0.2, -r * 0.55);
    ctx.lineTo(side * r * 0.7, -r * 0.4);
    ctx.stroke();
  }
};

const drawChrysanthemum: PatternDrawer = (ctx, r) => {
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, -r * 0.42, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  circle(ctx, 0, 0, r * 0.18);
};

const drawCloud: PatternDrawer = (ctx, r) => {
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(-r * 0.35 + i * r * 0.32, 0, r * 0.26, Math.PI * 0.1, Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, r * 0.28);
  ctx.lineTo(r * 0.6, r * 0.28);
  ctx.stroke();
};

const drawWave: PatternDrawer = (ctx, r) => {
  for (let row = -1; row <= 1; row += 1) {
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      ctx.arc(-r * 0.6 + i * r * 0.4, row * r * 0.32, r * 0.2, Math.PI, 0);
    }
    ctx.stroke();
  }
};

const drawMeander: PatternDrawer = (ctx, r) => {
  const steps = [
    [-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.35, 0.7], [-0.35, -0.35],
    [0.35, -0.35], [0.35, 0.35],
  ];
  ctx.beginPath();
  ctx.moveTo(steps[0][0] * r, steps[0][1] * r);
  for (let i = 1; i < steps.length; i += 1) ctx.lineTo(steps[i][0] * r, steps[i][1] * r);
  ctx.stroke();
};

const drawIce: PatternDrawer = (ctx, r) => {
  const rng = mulberry32(hashString('ice-crack'));
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    const x = (rng() - 0.5) * r;
    const y = (rng() - 0.5) * r;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * r * 1.4, y + (rng() - 0.5) * r * 1.4);
    ctx.stroke();
  }
};

export const PATTERN_DRAWERS: Record<string, PatternDrawer> = {
  plum: drawPlum,
  orchid: drawOrchid,
  bamboo: drawBamboo,
  chrysanthemum: drawChrysanthemum,
  cloud: drawCloud,
  wave: drawWave,
  meander: drawMeander,
  ice: drawIce,
};

export function isKnownPatternType(type: string): boolean {
  return type in PATTERN_DRAWERS;
}
