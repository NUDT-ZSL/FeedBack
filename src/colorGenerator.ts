import chroma from 'chroma-js';
import type { ColorItem, ColorPalette, RGB, HSL, Adjustment } from './types';

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getEmotion(h: number, s: number, l: number): string {
  const hNorm = ((h % 360) + 360) % 360;
  if (hNorm >= 200 && hNorm <= 240 && s > 65) return '科技感';
  if (hNorm >= 90 && hNorm <= 160 && l > 50) return '清新';
  if (s < 50 && l >= 40 && l <= 55) return '复古';
  if (s > 70 && l > 60) return '活泼';
  if (hNorm >= 180 && hNorm <= 270) return '冷静';
  if ((hNorm >= 0 && hNorm <= 45) || (hNorm >= 315 && hNorm <= 360)) return '温暖';
  return '平衡';
}

function buildColor(h: number, s: number, l: number): ColorItem {
  const chromaColor = chroma.hsl(h, s / 100, l / 100);
  const rgbArr = chromaColor.rgb();
  const rgb: RGB = { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2] };
  const hsl: HSL = { h, s, l };
  const hex = chromaColor.hex().toUpperCase();
  const emotion = getEmotion(h, s, l);
  return { hex, rgb, emotion, hsl };
}

type RuleName = 'analogous' | 'complementary' | 'split';

const RULES: Record<RuleName, number[]> = {
  analogous: [0, 30, 60, 90, 120],
  complementary: [0, 30, 180, 210, 240],
  split: [0, 60, 150, 180, 210],
};

const RULE_KEYS: RuleName[] = ['analogous', 'complementary', 'split'];

function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function generatePalette(): ColorPalette {
  const baseHue = Math.floor(randRange(0, 360));
  const ruleName = RULE_KEYS[Math.floor(Math.random() * RULE_KEYS.length)];
  const offsets = RULES[ruleName];

  const baseSat = randRange(55, 80);
  const baseLight = randRange(35, 70);

  const colors: ColorItem[] = offsets.map((offset, i) => {
    const h = (baseHue + offset) % 360;
    const s = Math.max(40, Math.min(90, baseSat + randRange(-15, 15)));
    const l = Math.max(25, Math.min(80, baseLight + (i - 2) * randRange(5, 12)));
    return buildColor(h, s, l);
  });

  return {
    id: genId(),
    colors,
    timestamp: Date.now(),
    isFavorite: false,
  };
}

export function applyAdjustment(color: ColorItem, adj: Adjustment): ColorItem {
  const newL = Math.max(0, Math.min(100, color.hsl.l + adj.lightness));
  const newS = Math.max(0, Math.min(100, color.hsl.s + adj.saturation));
  return buildColor(color.hsl.h, newS, newL);
}

export function applyPaletteAdjustments(
  palette: ColorPalette,
  adjustments: Adjustment[]
): ColorPalette {
  const colors = palette.colors.map((c, i) =>
    applyAdjustment(c, adjustments[i] || { lightness: 0, saturation: 0 })
  );
  return { ...palette, colors };
}

export { buildColor };
