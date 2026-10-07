/**
 * 星历（星体位置计算）。
 *
 * 关键性质：任意 tick 的位置都是该 tick 与固定轨道参数的纯函数，
 * 不在调用之间累加位置或平近点角，因此「回退后再前进」与「直接到达」
 * 得到逐位相同的结果，不存在状态残留。
 */

import {
  BodyConfig,
  FixedBodyConfig,
  OrbitalBodyConfig,
  Vec3,
} from './types';
import {
  deg2rad,
  normalizeAngleRad,
  normalizeDeg360,
  solveKepler,
} from './math';

/** 该 tick 的本地恒星时（度，归一化 [0,360)） */
export function localSiderealTime(
  tick: number,
  epochTick: number,
  lstAtEpochDeg: number,
  lstRateDegPerTick: number,
): number {
  return normalizeDeg360(lstAtEpochDeg + (tick - epochTick) * lstRateDegPerTick);
}

function orbitalPosition(body: OrbitalBodyConfig, tick: number): Vec3 {
  const meanAnomaly = deg2rad(
    normalizeDeg360(
      body.meanAnomalyAtEpochDeg
        + (tick - body.epochTick) * body.meanMotionDegPerTick,
    ),
  );
  const eccentricAnomaly = solveKepler(meanAnomaly, body.eccentricity);

  // 由偏近点角求真近点角（atan2 形式，跨象限安全）
  const trueAnomaly = Math.atan2(
    Math.sqrt(1 - body.eccentricity * body.eccentricity) * Math.sin(eccentricAnomaly),
    Math.cos(eccentricAnomaly) - body.eccentricity,
  );
  const distance =
    body.semiMajorAxis * (1 - body.eccentricity * Math.cos(eccentricAnomaly));

  // 近焦点坐标系
  const px = distance * Math.cos(trueAnomaly);
  const py = distance * Math.sin(trueAnomaly);

  const raan = deg2rad(body.ascendingNodeDeg);
  const inc = deg2rad(body.inclinationDeg);
  const argP = deg2rad(body.argOfPeriapsisDeg);

  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosInc = Math.cos(inc);
  const sinInc = Math.sin(inc);
  const cosArg = Math.cos(argP);
  const sinArg = Math.sin(argP);

  // 近焦点 → 赤道惯性系：R3(-Ω) R1(-i) R3(-ω) 的正向组合
  const x =
    (cosRaan * cosArg - sinRaan * sinArg * cosInc) * px
    + (-cosRaan * sinArg - sinRaan * cosArg * cosInc) * py;
  const y =
    (sinRaan * cosArg + cosRaan * sinArg * cosInc) * px
    + (-sinRaan * sinArg + cosRaan * cosArg * cosInc) * py;
  const z = sinArg * sinInc * px + cosArg * sinInc * py;

  return { x, y, z };
}

function fixedPosition(body: FixedBodyConfig, tick: number): Vec3 {
  const ra = deg2rad(
    normalizeDeg360(
      body.raAtEpochDeg
        + (tick - body.epochTick) * body.raDriftDegPerTick,
    ),
  );
  const dec = deg2rad(body.decDeg);
  const cosDec = Math.cos(dec);
  return {
    x: body.distance * cosDec * Math.cos(ra),
    y: body.distance * cosDec * Math.sin(ra),
    z: body.distance * Math.sin(dec),
  };
}

/** 星体在赤道惯性系中的位置（观测者位于原点） */
export function bodyPosition(body: BodyConfig, tick: number): Vec3 {
  return body.kind === 'orbital'
    ? orbitalPosition(body, tick)
    : fixedPosition(body, tick);
}

/** 向量模长 */
export function vectorLength(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** 相对赤经/赤纬（弧度） */
export function toEquatorialSpherical(v: Vec3): { ra: number; dec: number; distance: number } {
  const distance = vectorLength(v);
  const ra = normalizeAngleRad(Math.atan2(v.y, v.x));
  const dec = Math.asin(Math.max(-1, Math.min(1, v.z / distance)));
  return { ra, dec, distance };
}
