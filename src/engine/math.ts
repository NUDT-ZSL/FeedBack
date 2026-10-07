// 纯函数数学工具：向量运算、环带坐标系、角度投影、确定性哈希。
import type { RingKey, Vec3 } from './types.ts';
import { RING_KEYS } from './types.ts';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;

export const v = (x: number, y: number, z: number): Vec3 => [x, y, z];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 0..360 的稳定角度（度） */
export function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/** 两个环带角度之差的最小绝对值（度，0..180） */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a - b));
  return d > 180 ? 360 - d : d;
}

/**
 * 环带坐标系（正交点）：由平面法线 axis 与方位角决定。
 * 环带平面内取正交单位向量 u（方位角方向）与 w，位置 = r(cosθ u + sinθ w)。
 * 对 (inclination, azimuth) 相同的环带，帧始终一致 —— 不依赖构造顺序以外的输入。
 */
export interface RingFrame {
  axis: Vec3;
  u: Vec3;
  w: Vec3;
}

export function ringFrame(inclinationDeg: number, azimuthDeg: number): RingFrame {
  const inc = inclinationDeg * DEG2RAD;
  const az = azimuthDeg * DEG2RAD;
  // 默认平面为 XZ 平面（法线 +Y），按方位角倾斜
  const sinI = Math.sin(inc);
  const axis = normalize([
    sinI * Math.cos(az),
    Math.cos(inc),
    sinI * Math.sin(az)
  ]);
  // 参考向量选 +Z（与 +Y 不平行），保证平面内基底稳定
  const reference: Vec3 = [0, 0, 1];
  let u = cross(reference, axis);
  if (norm(u) < 1e-9) u = [1, 0, 0];
  u = normalize(u);
  const w = normalize(cross(axis, u));
  return { axis, u, w };
}

/**
 * 三条环带的坐标系。各环带默认倾角/方位固定；
 * 运行时用户拖拽倾角（tilt，0..90 度），通过 tiltOverride 覆盖。
 */
export type RingFrameSet = Record<RingKey, RingFrame>;

export const DEFAULT_RING_ORIENTATION: Record<RingKey, { inclination: number; azimuth: number }> = {
  // 黄道：相对赤道约 23.5°
  ecliptic: { inclination: 23.5, azimuth: 0 },
  // 赤道：水平
  equator: { inclination: 0, azimuth: 0 },
  // 银道：约 62.6°
  galactic: { inclination: 62.6, azimuth: 45 }
};

export function buildRingFrames(tiltOverride?: Partial<Record<RingKey, number>>): RingFrameSet {
  const frames = {} as RingFrameSet;
  for (const key of RING_KEYS) {
    const def = DEFAULT_RING_ORIENTATION[key];
    frames[key] = ringFrame(tiltOverride?.[key] ?? def.inclination, def.azimuth);
  }
  return frames;
}

/**
 * 把三维方向投影到某环带平面并求平面内方位角（度，0..360）。
 * 方向与环轴近似平行（几何退化）时返回 null。
 */
export function angleOnRing(direction: Vec3, frame: RingFrame): number | null {
  const d = normalize(direction);
  const onAxis = Math.abs(dot(d, frame.axis));
  if (onAxis > 1 - 1e-9) return null;
  const x = dot(d, frame.u);
  const y = dot(d, frame.w);
  const deg = Math.atan2(y, x) * RAD2DEG;
  return normalizeDeg(deg);
}

/**
 * 确定性哈希（FNV-1a 32bit），输入为规范化后的 JSON 字符串。
 * 不使用 Date.now / Math.random，同输入恒定同输出。
 */
export function stableHash(value: unknown): string {
  const json = canonicalJSON(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 键排序的 JSON 序列化，保证字段书写顺序不影响指纹 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
