import type { NebulaParams } from './params.ts';

export const MAX_PARTICLES = 10000;
export const INNER_RADIUS_RATIO = 0.7;
export const OUTER_RADIUS_RATIO = 1;
const GOLDEN_RATIO_FRAC = 0.618033988749895;

const DEFAULT_RNG_SEED = 0x9e3779b9;

export interface ParticleBaseData {
  directions: Float32Array;
  radialT: Float32Array;
  baseAlphas: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
}

export interface ParticleBuffers {
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  drawRange: number;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateBaseData(
  maxParticles: number = MAX_PARTICLES,
  seed: number = DEFAULT_RNG_SEED
): ParticleBaseData {
  const random = mulberry32(seed);

  const directions = new Float32Array(maxParticles * 3);
  const radialT = new Float32Array(maxParticles);
  const baseAlphas = new Float32Array(maxParticles);
  const sizes = new Float32Array(maxParticles);
  const phases = new Float32Array(maxParticles);

  for (let i = 0; i < maxParticles; i++) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    radialT[i] = random();

    directions[i * 3] = Math.sin(phi) * Math.cos(theta);
    directions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    directions[i * 3 + 2] = Math.cos(phi);

    baseAlphas[i] = 0.3 + ((i * GOLDEN_RATIO_FRAC) % 1) * 0.7;
    sizes[i] = 0.05 + random() * 0.45;
    phases[i] = i * 0.1;
  }

  return { directions, radialT, baseAlphas, sizes, phases };
}

export function createBuffers(baseData: ParticleBaseData): ParticleBuffers {
  const maxParticles = baseData.radialT.length;
  return {
    positions: new Float32Array(maxParticles * 3),
    colors: new Float32Array(maxParticles * 3),
    alphas: baseData.baseAlphas.slice(),
    sizes: baseData.sizes.slice(),
    phases: baseData.phases.slice(),
    drawRange: 0
  };
}

export function shellRadius(radius: number, t: number): number {
  const innerRadius = radius * INNER_RADIUS_RATIO;
  const shellThickness = radius * (OUTER_RADIUS_RATIO - INNER_RADIUS_RATIO);
  return innerRadius + t * shellThickness;
}

function hueToRgbChannel(p: number, q: number, hue: number): number {
  let h = hue;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
}

export function hslToRgb(
  h360: number,
  s100: number,
  l100: number
): [number, number, number] {
  const h = (((h360 % 360) + 360) % 360) / 360;
  const s = s100 / 100;
  const l = l100 / 100;

  if (s === 0) {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    hueToRgbChannel(p, q, h + 1 / 3),
    hueToRgbChannel(p, q, h),
    hueToRgbChannel(p, q, h - 1 / 3)
  ];
}

export function applyRadius(
  buffers: ParticleBuffers,
  baseData: ParticleBaseData,
  radius: number
): void {
  const { positions, drawRange } = buffers;
  const { directions, radialT } = baseData;

  for (let i = 0; i < drawRange; i++) {
    const r = shellRadius(radius, radialT[i]);
    const i3 = i * 3;
    positions[i3] = directions[i3] * r;
    positions[i3 + 1] = directions[i3 + 1] * r;
    positions[i3 + 2] = directions[i3 + 2] * r;
  }
}

export function applyHue(
  buffers: ParticleBuffers,
  baseData: ParticleBaseData,
  hueOffset: number
): void {
  const [centerR, centerG, centerB] = hslToRgb((20 + hueOffset) % 360, 100, 60);
  const [outerR, outerG, outerB] = hslToRgb((250 + hueOffset) % 360, 80, 50);

  const { colors, drawRange } = buffers;
  const { radialT } = baseData;

  for (let i = 0; i < drawRange; i++) {
    const t = radialT[i];
    const i3 = i * 3;
    colors[i3] = centerR + (outerR - centerR) * t;
    colors[i3 + 1] = centerG + (outerG - centerG) * t;
    colors[i3 + 2] = centerB + (outerB - centerB) * t;
  }
}

export function applyParticleCount(
  buffers: ParticleBuffers,
  baseData: ParticleBaseData,
  particleCount: number,
  radius: number
): void {
  const previousCount = buffers.drawRange;
  buffers.drawRange = particleCount;

  if (particleCount <= previousCount) {
    return;
  }

  const { positions } = buffers;
  const { directions, radialT } = baseData;

  for (let i = previousCount; i < particleCount; i++) {
    const r = shellRadius(radius, radialT[i]);
    const i3 = i * 3;
    positions[i3] = directions[i3] * r;
    positions[i3 + 1] = directions[i3 + 1] * r;
    positions[i3 + 2] = directions[i3 + 2] * r;
  }
}

export function applyParams(
  buffers: ParticleBuffers,
  baseData: ParticleBaseData,
  prevParams: NebulaParams,
  nextParams: NebulaParams
): (keyof NebulaParams)[] {
  const changed: (keyof NebulaParams)[] = [];
  const grew = nextParams.particleCount > buffers.drawRange;

  if (prevParams.particleCount !== nextParams.particleCount) {
    applyParticleCount(buffers, baseData, nextParams.particleCount, nextParams.radius);
    changed.push('particleCount');
  }

  if (prevParams.radius !== nextParams.radius || grew) {
    applyRadius(buffers, baseData, nextParams.radius);
    changed.push('radius');
  }

  if (prevParams.hueOffset !== nextParams.hueOffset || grew) {
    applyHue(buffers, baseData, nextParams.hueOffset);
    changed.push('hueOffset');
  }

  return changed;
}
