// 第一层：轨道计算。给定时刻 + 轨道参数 + 观测者视角，求各星体在三条环带上的角度与位置。
// 全部为纯函数：输出只取决于输入，不读取时钟/随机数。
import type {
  BodyPosition,
  ObserverView,
  OrbitalBodyParams,
  RingAngles,
  Vec3
} from './types.ts';
import { RING_KEYS } from './types.ts';
import {
  DEG2RAD,
  angleOnRing,
  cross,
  dot,
  norm,
  normalize,
  normalizeDeg,
  scale,
  add,
  type RingFrameSet
} from './math.ts';

/** 观测坐标系：视线轴 + 视图平面正交基底 */
export interface ViewBasis {
  origin: Vec3;
  axis: Vec3;
  right: Vec3;
  up: Vec3;
}

export function buildViewBasis(observer: ObserverView): ViewBasis {
  const axis = normalize([
    observer.target[0] - observer.position[0],
    observer.target[1] - observer.position[1],
    observer.target[2] - observer.position[2]
  ]);
  const worldUp: Vec3 = [0, 1, 0];
  let right = normalize(cross(worldUp, axis));
  if (norm(right) < 1e-9) right = [1, 0, 0];
  const up = normalize(cross(axis, right));
  return { origin: observer.position, axis, right, up };
}

/** 星体在所属环带上的轨道角（度，0..360）：phase0 + 360 * t / period */
export function orbitAngleDeg(body: OrbitalBodyParams, timeMs: number): number {
  return normalizeDeg(body.phase0 + (360 * timeMs) / body.period);
}

/**
 * 星体在浑天仪中心坐标系下的三维位置。
 * 模型：沿所属环带平面以 θ = orbitAngle 运行，再按轨道修正参数偏离环面 ——
 *   inclination（轨道倾角修正，度）绕升交点方向 azimuth（升交点在环面内的方位角，度）旋转。
 * 这样同环星体在未修正时共面、易出现“角度差小于阈值”的遮挡场景；
 * 修正某颗星体的轨道参数只改变该星体位置。
 */
export function bodyWorldPosition(
  body: OrbitalBodyParams,
  timeMs: number,
  frames: RingFrameSet
): Vec3 {
  const home = frames[body.homeRing];
  const theta = orbitAngleDeg(body, timeMs) * DEG2RAD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const p0: Vec3 = [
    body.radius * (c * home.u[0] + s * home.w[0]),
    body.radius * (c * home.u[1] + s * home.w[1]),
    body.radius * (c * home.u[2] + s * home.w[2])
  ];
  const inc = body.inclination * DEG2RAD;
  if (inc === 0) return p0;
  const node = body.azimuth * DEG2RAD;
  const n: Vec3 = [
    Math.cos(node) * home.u[0] + Math.sin(node) * home.w[0],
    Math.cos(node) * home.u[1] + Math.sin(node) * home.w[1],
    Math.cos(node) * home.u[2] + Math.sin(node) * home.w[2]
  ];
  // Rodrigues 旋转：p = p0 cos i + (n × p0) sin i + n(n·p0)(1-cos i)
  const nxp = cross(n, p0);
  const ndp = dot(n, p0);
  return add(add(scale(p0, Math.cos(inc)), scale(nxp, Math.sin(inc))), scale(n, ndp * (1 - Math.cos(inc))));
}

/** 星体在三条环带上的角度（度） */
export function bodyRingAngles(position: Vec3, frames: RingFrameSet): RingAngles {
  const angles = {} as RingAngles;
  for (const key of RING_KEYS) {
    angles[key] = angleOnRing(position, frames[key]);
  }
  return angles;
}

/** 单星体单时刻的完整几何结果 */
export function computeBodyPosition(
  body: OrbitalBodyParams,
  timeMs: number,
  frames: RingFrameSet,
  view: ViewBasis
): BodyPosition {
  const position = bodyWorldPosition(body, timeMs, frames);
  const toBody = [
    position[0] - view.origin[0],
    position[1] - view.origin[1],
    position[2] - view.origin[2]
  ] as Vec3;
  const dist = norm(toBody);
  const dir: Vec3 = dist === 0 ? ([0, 0, 0] as Vec3) : scale(toBody, 1 / dist);
  const cosView = Math.min(1, Math.max(-1, dot(dir, view.axis)));
  return {
    id: body.id,
    angles: bodyRingAngles(position, frames),
    position,
    viewAngle: Math.acos(cosView),
    viewDepth: dot(toBody, view.axis),
    viewX: dot(dir, view.right),
    viewY: dot(dir, view.up),
    revision: body.revision
  };
}
