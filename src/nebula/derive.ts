import type { ParticleSeeds } from './seeds.ts';

export type Vec3 = [number, number, number];

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): Vec3 {
  const hue = (((h / 360) % 1) + 1) % 1;
  const saturation = Math.min(Math.max(s / 100, 0), 1);
  const lightness = Math.min(Math.max(l / 100, 0), 1);

  if (saturation === 0) {
    return [lightness, lightness, lightness];
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [
    hueToRgb(p, q, hue + 1 / 3),
    hueToRgb(p, q, hue),
    hueToRgb(p, q, hue - 1 / 3)
  ];
}

export function derivePosition(seeds: ParticleSeeds, index: number, radius: number): Vec3 {
  const innerRadius = radius * 0.7;
  const outerRadius = radius;

  const theta = seeds.directionU[index] * Math.PI * 2;
  const phi = Math.acos(2 * seeds.directionV[index] - 1);
  const r = innerRadius + seeds.radial[index] * (outerRadius - innerRadius);

  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi)
  ];
}

export function deriveColor(seeds: ParticleSeeds, index: number, hueOffset: number): Vec3 {
  const [cr, cg, cb] = hslToRgb((20 + hueOffset) % 360, 100, 60);
  const [or, og, ob] = hslToRgb((250 + hueOffset) % 360, 80, 50);
  const t = seeds.radial[index];

  return [
    cr + (or - cr) * t,
    cg + (og - cg) * t,
    cb + (ob - cb) * t
  ];
}

export function deriveSize(seeds: ParticleSeeds, index: number): number {
  return seeds.size[index];
}
