export interface NebulaParams {
  particleCount: number;
  hueOffset: number;
  radius: number;
  rotationSpeed: number;
}

export const PARAM_KEYS = [
  'particleCount',
  'hueOffset',
  'radius',
  'rotationSpeed'
] as const satisfies readonly (keyof NebulaParams)[];

export function copyParams(params: NebulaParams): NebulaParams {
  return { ...params };
}

export function paramsEqual(a: NebulaParams, b: NebulaParams): boolean {
  return PARAM_KEYS.every((key) => a[key] === b[key]);
}

export function diffParams(prev: NebulaParams, next: NebulaParams): (keyof NebulaParams)[] {
  return PARAM_KEYS.filter((key) => prev[key] !== next[key]);
}
