import { normalizeAngleDeg, ringPointToWorld } from './math';
import type { BodyEphemeris, OrbitalParams, RingConfig } from './types';

/** 纯函数：给定轨道参数与观测时刻，计算环上角度。与帧率、拖动速度无关。 */
export function computeAngleDeg(params: OrbitalParams, time: number): number {
  return normalizeAngleDeg(
    params.baseAngleDeg + params.angularVelocityDegPerSec * time
  );
}

/** 纯函数：角度 + 环配置 -> 星历（角度与三维位置）。 */
export function computeEphemeris(
  params: OrbitalParams,
  ring: RingConfig,
  time: number
): BodyEphemeris {
  const angleDeg = computeAngleDeg(params, time);
  return {
    bodyId: params.bodyId,
    ring: params.ring,
    angleDeg,
    position: ringPointToWorld(ring, angleDeg, params.radialOffset)
  };
}
