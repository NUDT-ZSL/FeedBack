/**
 * 可见性与遮挡判定。
 *
 * 判定规则集中在 VISIBILITY_POLICY 中，渲染层与统计层必须共用同一入口，
 * 保证「可见性」与「完成度统计」不会出现口径分叉。
 */

import { BodyConfig, BodyVisibility, ObserverConfig, Vec3 } from './types';
import { clamp, deg2rad, normalizeDeg360, rad2deg } from './math';
import { bodyPosition, localSiderealTime, toEquatorialSpherical, vectorLength } from './ephemeris';

/** 判定口径：唯一的可见性规则来源 */
export const VISIBILITY_POLICY = {
  /**
   * 地平线判定：高度角 >= 0 视为在地平线之上（贴地平线算可见，
   * 未做大气折射修正——纯几何模型）。
   */
  horizonMinAltitudeDeg: 0,
  /**
   * 星体互掩判定：角距 < 两星视半径之和 且 距离更近者遮挡更远者。
   * 恰好相切（角距 == 视半径之和）不算遮挡，仅标记 tangent。
   */
  occultationStrict: true,
  /** 临界标记带宽（度）：|角距 - 视半径和| 或 |高度角| 小于该值时标记边界情形 */
  edgeBandDeg: 1e-6,
} as const;

export interface HorizonCoords {
  altitudeDeg: number;
  azimuthDeg: number;
}

/** 赤道坐标 → 本地地平坐标 */
export function equatorialToHorizontal(
  raRad: number,
  decRad: number,
  lstDeg: number,
  latitudeDeg: number,
): HorizonCoords {
  const hourAngle = deg2rad(normalizeDeg360(lstDeg)) - raRad;
  const lat = deg2rad(latitudeDeg);

  const sinAlt =
    Math.sin(decRad) * Math.sin(lat)
    + Math.cos(decRad) * Math.cos(lat) * Math.cos(hourAngle);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));

  const azimuth = Math.atan2(
    -Math.cos(decRad) * Math.sin(hourAngle),
    Math.sin(decRad) * Math.cos(lat)
      - Math.cos(decRad) * Math.sin(lat) * Math.cos(hourAngle),
  );

  return {
    altitudeDeg: rad2deg(altitude),
    azimuthDeg: normalizeDeg360(rad2deg(azimuth)),
  };
}

/** 视半径（度） */
export function angularRadiusDeg(physicalRadius: number, distance: number): number {
  return rad2deg(Math.asin(clamp(physicalRadius / distance, 0, 1)));
}

/** 两星体相对观测者的角距（度） */
export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  const la = vectorLength(a);
  const lb = vectorLength(b);
  const cosTheta = clamp(
    (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb),
    -1,
    1,
  );
  return rad2deg(Math.acos(cosTheta));
}

interface EvaluatedBody {
  config: BodyConfig;
  position: Vec3;
  distance: number;
  altitudeDeg: number;
  azimuthDeg: number;
  angularRadiusDeg: number;
  aboveHorizon: boolean;
}

/**
 * 计算某一 tick 全部星体的可见性。
 * 纯函数：只依赖 (tick, config)，不读取/修改任何外部状态。
 */
export function evaluateVisibility(
  tick: number,
  observer: ObserverConfig,
  bodies: BodyConfig[],
): BodyVisibility[] {
  const lst = localSiderealTime(
    tick,
    observer.epochTick,
    observer.lstAtEpochDeg,
    observer.lstRateDegPerTick,
  );

  const evaluated: EvaluatedBody[] = bodies.map((config) => {
    const position = bodyPosition(config, tick);
    const spherical = toEquatorialSpherical(position);
    const horizon = equatorialToHorizontal(
      spherical.ra,
      spherical.dec,
      lst,
      observer.latitudeDeg,
    );
    return {
      config,
      position,
      distance: spherical.distance,
      altitudeDeg: horizon.altitudeDeg,
      azimuthDeg: horizon.azimuthDeg,
      angularRadiusDeg: angularRadiusDeg(config.physicalRadius, spherical.distance),
      aboveHorizon:
        horizon.altitudeDeg >= VISIBILITY_POLICY.horizonMinAltitudeDeg,
    };
  });

  return evaluated.map((target, index) => {
    let occultedBy: string | null = null;
    let tangent = false;

    if (target.aboveHorizon) {
      for (let j = 0; j < evaluated.length; j += 1) {
        if (j === index) continue;
        const other = evaluated[j];
        // 只有更近且自身在地平线之上的星体才可能遮挡
        if (!other.aboveHorizon) continue;
        if (other.distance >= target.distance) continue;

        const separation = angularSeparationDeg(target.position, other.position);
        const sumRadii = target.angularRadiusDeg + other.angularRadiusDeg;
        if (separation < sumRadii) {
          occultedBy = other.config.id;
          break;
        }
        if (Math.abs(separation - sumRadii) <= VISIBILITY_POLICY.edgeBandDeg) {
          tangent = true;
        }
      }
    }

    return {
      bodyId: target.config.id,
      altitudeDeg: target.altitudeDeg,
      azimuthDeg: target.azimuthDeg,
      angularRadiusDeg: target.angularRadiusDeg,
      aboveHorizon: target.aboveHorizon,
      occultedBy,
      tangent,
      visible: target.aboveHorizon && occultedBy === null,
    };
  });
}
