import ColorHash from 'color-hash';

export interface ColorInfo {
  hex: string;
  role: 'primary' | 'secondary' | 'accent' | 'background' | 'text';
}

export interface ContrastResult {
  ratio: number;
  level: 'AAA' | 'AA' | 'Fail';
}

export type PresetName = 'ocean' | 'forest' | 'sunset' | 'aurora';

const colorHash = new ColorHash({ lightness: 0.6, saturation: 0.7 });

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function calculateContrast(hex1: string, hex2: string): ContrastResult {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  let level: 'AAA' | 'AA' | 'Fail';
  if (ratio >= 7) {
    level = 'AAA';
  } else if (ratio >= 4.5) {
    level = 'AA';
  } else {
    level = 'Fail';
  }

  return { ratio: Math.round(ratio * 100) / 100, level };
}

export function isDarkBackground(hex: string): boolean {
  return getLuminance(hex) < 0.5;
}

export function generateHarmoniousPalette(): ColorInfo[] {
  const seed = Math.random().toString(36).substring(2, 10);
  const baseHex = colorHash.hex(seed);
  const { h, s, l } = rgbToHsl(hexToRgb(baseHex).r, hexToRgb(baseHex).g, hexToRgb(baseHex).b);

  const primary = baseHex.toUpperCase();
  const secondary = hslToHex((h + 30) % 360, s, Math.min(l + 10, 90)).toUpperCase();
  const accent = hslToHex((h + 180) % 360, Math.min(s + 10, 100), Math.max(l - 5, 10)).toUpperCase();
  const background = hslToHex(h, Math.max(s - 40, 5), Math.min(l + 35, 97)).toUpperCase();
  const text = hslToHex(h, Math.max(s - 30, 10), Math.max(l - 40, 10)).toUpperCase();

  return [
    { hex: primary, role: 'primary' },
    { hex: secondary, role: 'secondary' },
    { hex: accent, role: 'accent' },
    { hex: background, role: 'background' },
    { hex: text, role: 'text' },
  ];
}

const presetPalettes: Record<PresetName, ColorInfo[]> = {
  ocean: [
    { hex: '#0077B6', role: 'primary' },
    { hex: '#00B4D8', role: 'secondary' },
    { hex: '#90E0EF', role: 'accent' },
    { hex: '#CAF0F8', role: 'background' },
    { hex: '#03045E', role: 'text' },
  ],
  forest: [
    { hex: '#2D6A4F', role: 'primary' },
    { hex: '#40916C', role: 'secondary' },
    { hex: '#95D5B2', role: 'accent' },
    { hex: '#D8F3DC', role: 'background' },
    { hex: '#1B4332', role: 'text' },
  ],
  sunset: [
    { hex: '#E85D04', role: 'primary' },
    { hex: '#F48C06', role: 'secondary' },
    { hex: '#FAA307', role: 'accent' },
    { hex: '#FEF3E2', role: 'background' },
    { hex: '#6A040F', role: 'text' },
  ],
  aurora: [
    { hex: '#7209B7', role: 'primary' },
    { hex: '#560BAD', role: 'secondary' },
    { hex: '#F72585', role: 'accent' },
    { hex: '#F5EEFF', role: 'background' },
    { hex: '#3A0CA3', role: 'text' },
  ],
};

export const presetNames: Record<PresetName, string> = {
  ocean: '海洋蓝',
  forest: '森林绿',
  sunset: '日落橙',
  aurora: '极光紫',
};

export function getPresetPalette(name: PresetName): ColorInfo[] {
  return presetPalettes[name].map((c) => ({ ...c }));
}

export function adjustColorBrightness(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const adjust = (c: number) => {
    const adjusted = Math.round(c + (percent / 100) * 255);
    return Math.min(255, Math.max(0, adjusted));
  };
  return `#${adjust(r).toString(16).padStart(2, '0')}${adjust(g).toString(16).padStart(2, '0')}${adjust(b).toString(16).padStart(2, '0')}`.toUpperCase();
}
