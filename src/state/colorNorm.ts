import { hexToHsl, hslToHex, rgbToHex } from '../utils/colorUtils.ts';

export interface ColorEntry {
  id: string;
  hex: string;
  h: number;
  s: number;
  l: number;
}

export type NormResult<T> = { ok: true; value: T } | { ok: false; error: string };

const HEX_RE = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function normalizeHex(raw: unknown): NormResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, error: `HEX 输入必须是字符串，收到 ${typeof raw}` };
  }
  const trimmed = raw.trim();
  if (!HEX_RE.test(trimmed)) {
    return { ok: false, error: `非法 HEX 颜色: "${raw}"` };
  }
  let body = trimmed.replace(/^#/, '').toLowerCase();
  if (body.length === 3) {
    body = body.split('').map((c) => c + c).join('');
  }
  return { ok: true, value: `#${body}` };
}

export function normalizeChannel(value: unknown, name: string): NormResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `RGB 通道 ${name} 必须是有限数字，收到 ${String(value)}` };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, error: `RGB 通道 ${name} 必须是整数，收到 ${value}` };
  }
  if (value < 0 || value > 255) {
    return { ok: false, error: `RGB 通道 ${name} 越界: ${value}（允许 0-255）` };
  }
  return { ok: true, value };
}

export function normalizeRgb(r: unknown, g: unknown, b: unknown): NormResult<string> {
  const rn = normalizeChannel(r, 'R');
  if (!rn.ok) return rn;
  const gn = normalizeChannel(g, 'G');
  if (!gn.ok) return gn;
  const bn = normalizeChannel(b, 'B');
  if (!bn.ok) return bn;
  return { ok: true, value: rgbToHex(rn.value, gn.value, bn.value) };
}

export function normalizePercent(value: unknown, name: string): NormResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${name} 必须是有限数字，收到 ${String(value)}` };
  }
  if (value < 0 || value > 100) {
    return { ok: false, error: `${name} 越界: ${value}（允许 0-100）` };
  }
  return { ok: true, value: round4(value) };
}

export function makeEntry(hex: string, id: string): ColorEntry {
  const { h, s, l } = hexToHsl(hex);
  return { id, hex, h: round4(h), s: round4(s), l: round4(l) };
}

export function withLightness(entry: ColorEntry, lightness: number): ColorEntry {
  return { ...entry, l: round4(lightness), hex: hslToHex(entry.h, entry.s, lightness) };
}

export function withSaturation(entry: ColorEntry, saturation: number): ColorEntry {
  return { ...entry, s: round4(saturation), hex: hslToHex(entry.h, saturation, entry.l) };
}
