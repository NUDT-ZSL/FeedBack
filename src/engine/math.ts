import type { RingConfig } from './types';

export function normalizeAngleDeg(angle: number): number {
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** 两角在圆周上的最小角距，[0, 180] */
export function angularSeparationDeg(a: number, b: number): number {
  const diff = Math.abs(normalizeAngleDeg(a) - normalizeAngleDeg(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type Vec3 = [number, number, number];

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecLength(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return vecLength(vecSub(a, b));
}

/**
 * 环上角度 -> 世界坐标。
 * 先在环局部平面 (XZ) 取点，再绕 X 轴施加倾角，最后绕 Y 轴施加升交点经度。
 * 渲染层必须以相同的变换顺序摆放圆环，保证视觉与推演一致。
 */
export function ringPointToWorld(
  ring: RingConfig,
  angleDeg: number,
  radialOffset = 0
): Vec3 {
  const radius = ring.radius + radialOffset;
  const theta = degToRad(angleDeg);
  const x0 = radius * Math.cos(theta);
  const z0 = radius * Math.sin(theta);

  const incl = degToRad(ring.inclinationDeg);
  const cosI = Math.cos(incl);
  const sinI = Math.sin(incl);
  const y1 = -z0 * sinI;
  const z1 = z0 * cosI;

  const node = degToRad(ring.nodeAngleDeg);
  const cosN = Math.cos(node);
  const sinN = Math.sin(node);
  const x2 = x0 * cosN + z1 * sinN;
  const z2 = -x0 * sinN + z1 * cosN;

  return [x2, y1, z2];
}
