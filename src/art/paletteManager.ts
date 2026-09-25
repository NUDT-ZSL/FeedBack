import { SeededRandom } from './random';

export interface ColorTheme {
  name: string;
  label: string;
  colors: string[];
}

export const COLOR_THEMES: readonly ColorTheme[] = [
  { name: 'cyberpunk', label: '赛博朋克霓虹', colors: ['#ff2d95', '#00e5ff', '#7b2ff7', '#f9f871', '#0ff0b3'] },
  { name: 'morandi', label: '莫兰迪低饱和', colors: ['#a8a196', '#c2b8a3', '#8d9aa5', '#b5a59a', '#7f8577'] },
  { name: 'forest', label: '森林自然系', colors: ['#2d6a4f', '#74c69d', '#b7e4c7', '#40916c', '#d8f3dc'] },
  { name: 'sunset', label: '温暖的日落', colors: ['#ff9e6d', '#ff6d6d', '#ffc46b', '#c96bff', '#ff8fb1'] },
  { name: 'ocean', label: '海浪深蓝', colors: ['#05668d', '#028090', '#00a896', '#02c39a', '#f0f3bd'] },
];

export function getTheme(name: string): ColorTheme {
  const theme = COLOR_THEMES.find((entry) => entry.name === name);
  if (!theme) {
    throw new Error(`未知颜色主题: ${name}`);
  }
  return theme;
}

export function randomTheme(rng: SeededRandom): ColorTheme {
  return rng.pick(COLOR_THEMES);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** 对十六进制颜色做色相偏移，结果仍是合法 hex。 */
export function shiftHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}
