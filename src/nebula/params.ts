export interface NebulaParams {
  particleCount: number;
  hueOffset: number;
  radius: number;
  rotationSpeed: number;
}

export const MAX_PARTICLES = 10000;

export type NebulaParamKey = keyof NebulaParams;

const PARAM_KEYS: NebulaParamKey[] = [
  'particleCount',
  'hueOffset',
  'radius',
  'rotationSpeed'
];

export function cloneParams(params: NebulaParams): NebulaParams {
  return { ...params };
}

export function diffParams(prev: NebulaParams, next: NebulaParams): NebulaParamKey[] {
  const changed: NebulaParamKey[] = [];
  for (const key of PARAM_KEYS) {
    if (prev[key] !== next[key]) {
      changed.push(key);
    }
  }
  return changed;
}
