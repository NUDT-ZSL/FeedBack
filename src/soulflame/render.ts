/**
 * 幽冥魂灯 · 灯焰渲染映射
 *
 * 引擎快照 -> 渲染参数。纯函数、无随机数；
 * 微观抖动只影响视觉，不回写引擎状态，保证模拟收敛与离线复现。
 */

import type { FlameForm, FlameSnapshot } from './types.ts';

export interface FlameVisuals {
  /** 火焰高度系数 0..1 */
  height: number;
  /** 火焰宽度系数 0..1 */
  width: number;
  /** 抖动幅度 0..1（摇曳） */
  flicker: number;
  /** 整体不透明度 0..1 */
  alpha: number;
  /** 核心辉光半径系数 0..1 */
  glow: number;
  /** 色相偏移（度），低储量偏冷，奔涌偏金 */
  hueShift: number;
  /** 是否渲染熄灭过渡余烟 */
  dying: boolean;
  form: FlameForm;
}

/** 确定性微抖动：若干正弦叠加，只依赖 tick，离线可复现 */
export function deterministicFlicker(tick: number, intensity: number): number {
  const t = tick / 60;
  const wave =
    0.5 +
    0.28 * Math.sin(t * 9.0) +
    0.16 * Math.sin(t * 17.3 + 1.7) +
    0.06 * Math.sin(t * 31.9 + 0.4);
  return clamp01(0.5 + (wave - 0.5) * (0.35 + intensity));
}

const FORM_HEIGHT: Record<FlameForm, number> = {
  out: 0,
  embers: 0.18,
  weak: 0.4,
  steady: 0.68,
  bright: 0.9,
  surging: 1.18,
};

const FORM_WIDTH: Record<FlameForm, number> = {
  out: 0,
  embers: 0.5,
  weak: 0.62,
  steady: 0.72,
  bright: 0.86,
  surging: 1.05,
};

export function flameVisuals(snap: FlameSnapshot): FlameVisuals {
  const { brightness, form, tick } = snap;
  const flicker = deterministicFlicker(tick, brightness);
  const hBase = FORM_HEIGHT[form];
  const wBase = FORM_WIDTH[form];

  const height = hBase * (0.9 + 0.2 * flicker) * clamp01(brightness * 1.25);
  const width = wBase * (0.94 + 0.12 * (1 - flicker)) * clamp01(brightness * 1.25);

  // 低储量时摇曳更剧烈
  const turbulence = snap.lowReserve ? 0.9 : form === 'surging' ? 0.7 : 0.45;
  const alpha = clamp01(brightness) * (0.82 + 0.18 * flicker);
  const glow = clamp01(brightness * (0.75 + 0.25 * flicker));

  // 色相：储量不足偏冷青(-18)，奔涌偏暖金(+14)
  const hueShift = snap.lowReserve ? -18 : form === 'surging' ? 14 : 0;

  return {
    height: Math.max(0, height),
    width: Math.max(0, width),
    flicker: flicker * turbulence,
    alpha,
    glow,
    hueShift,
    dying: snap.extinguishing,
    form,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
