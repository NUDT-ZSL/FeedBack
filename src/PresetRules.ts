import { hexToHsl, hslToHex } from './utils/colorUtils';

export function monochromatic(colors: string[], count: number = 5): string[] {
  if (colors.length === 0) return [];
  const base = colors[0];
  const { h, s } = hexToHsl(base);
  const result: string[] = [];
  const step = 80 / (count - 1 || 1);
  for (let i = 0; i < count; i++) {
    const l = 10 + i * step;
    result.push(hslToHex(h, s, l));
  }
  return result;
}

export function complementary(colors: string[]): string[] {
  if (colors.length === 0) return [];
  const base = colors[0];
  const { h, s, l } = hexToHsl(base);
  return [base, hslToHex((h + 180) % 360, s, l)];
}

export function triadic(colors: string[]): string[] {
  if (colors.length === 0) return [];
  const base = colors[0];
  const { h, s, l } = hexToHsl(base);
  return [
    base,
    hslToHex((h + 120) % 360, s, l),
    hslToHex((h + 240) % 360, s, l)
  ];
}

export function tetradic(colors: string[]): string[] {
  if (colors.length === 0) return [];
  const base = colors[0];
  const { h, s, l } = hexToHsl(base);
  return [
    base,
    hslToHex((h + 60) % 360, s, l),
    hslToHex((h + 180) % 360, s, l),
    hslToHex((h + 240) % 360, s, l)
  ];
}

export function analogous(colors: string[]): string[] {
  if (colors.length === 0) return [];
  const base = colors[0];
  const { h, s, l } = hexToHsl(base);
  return [
    hslToHex((h - 30 + 360) % 360, s, l),
    base,
    hslToHex((h + 30) % 360, s, l)
  ];
}

export type PresetRuleName = 'monochromatic' | 'complementary' | 'triadic' | 'tetradic' | 'analogous';

export function applyPreset(ruleName: PresetRuleName, colors: string[], count?: number): string[] {
  switch (ruleName) {
    case 'monochromatic':
      return monochromatic(colors, count);
    case 'complementary':
      return complementary(colors);
    case 'triadic':
      return triadic(colors);
    case 'tetradic':
      return tetradic(colors);
    case 'analogous':
      return analogous(colors);
    default:
      return [...colors];
  }
}
