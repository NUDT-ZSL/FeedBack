export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface ContrastResult {
  ratio: number;
  level: 'AAA' | 'AA' | 'Fail';
  isPass: boolean;
}

export function hexToRgb(hex: string): RGB {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
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

export function hslToRgb(h: number, s: number, l: number): RGB {
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
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function calculateContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getWCAGLevel(ratio: number, isLargeText = false): 'AAA' | 'AA' | 'Fail' {
  const aaThreshold = isLargeText ? 3 : 4.5;
  const aaaThreshold = isLargeText ? 4.5 : 7;
  if (ratio >= aaaThreshold) return 'AAA';
  if (ratio >= aaThreshold) return 'AA';
  return 'Fail';
}

export function getContrastResult(hex1: string, hex2: string, isLargeText = false): ContrastResult {
  const ratio = calculateContrastRatio(hex1, hex2);
  const level = getWCAGLevel(ratio, isLargeText);
  return {
    ratio: Math.round(ratio * 100) / 100,
    level,
    isPass: level !== 'Fail',
  };
}

export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  return luminance > 0.5;
}

export function getSuggestedPair(hex: string): string {
  return isLightColor(hex) ? '#212121' : '#FFFFFF';
}

export function generateColorSuggestions(foreground: string, background: string): string[] {
  const suggestions: string[] = [];
  const bgRgb = hexToRgb(background);
  const bgHsl = rgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);
  const isBgLight = isLightColor(background);

  const steps = isBgLight ? [20, 30, 40] : [80, 70, 60];
  for (const l of steps) {
    const newRgb = hslToRgb(bgHsl.h, bgHsl.s * 0.8, l);
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    suggestions.push(newHex);
  }

  suggestions.push(isBgLight ? '#111111' : '#F5F5F5');
  suggestions.push(isBgLight ? '#000000' : '#FFFFFF');

  const validSuggestions = suggestions
    .filter((hex) => {
      const ratio = calculateContrastRatio(hex, background);
      return ratio >= 4.5;
    })
    .filter((hex, idx, arr) => arr.indexOf(hex) === idx)
    .slice(0, 3);

  if (validSuggestions.length < 3) {
    const fgRgb = hexToRgb(foreground);
    const fgHsl = rgbToHsl(fgRgb.r, fgRgb.g, fgRgb.b);
    const extraL = isBgLight ? 15 : 85;
    const extraRgb = hslToRgb(fgHsl.h, fgHsl.s, extraL);
    validSuggestions.push(rgbToHex(extraRgb.r, extraRgb.g, extraRgb.b));
  }

  return validSuggestions.slice(0, 3);
}

export function normalizeHex(hex: string): string | null {
  const match = hex.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  let clean = match[1];
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return '#' + clean.toLowerCase();
}

export function rgbStringToHex(rgbStr: string): string | null {
  const match = rgbStr.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!match) return null;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  if ([r, g, b].some((v) => v < 0 || v > 255)) return null;
  return rgbToHex(r, g, b);
}

export function hslStringToHex(hslStr: string): string | null {
  const match = hslStr.match(/hsl\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)/i);
  if (!match) return null;
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]);
  const l = parseFloat(match[3]);
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) return null;
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function parseColor(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) return normalizeHex(trimmed);
  if (trimmed.toLowerCase().startsWith('rgb')) return rgbStringToHex(trimmed);
  if (trimmed.toLowerCase().startsWith('hsl')) return hslStringToHex(trimmed);
  return normalizeHex('#' + trimmed);
}
