import {
  angularSeparationDeg,
  cosDeg,
  julianCenturies,
  normalizeDegrees,
  sinDeg,
} from "./julian.ts";

export interface BodyPosition {
  lambdaDeg: number;
  betaDeg: number;
  distanceAu: number;
  semiDiameterDeg: number;
}

export interface LunarPosition extends BodyPosition {
  distanceKm: number;
}

export interface ShadowRadii {
  umbralDeg: number;
  penumbralDeg: number;
}

export function sunPosition(jd: number): BodyPosition {
  const T = julianCenturies(jd);
  const L0 = normalizeDegrees(280.46646 + 36_000.76983 * T + 0.0003032 * T * T);
  const M = normalizeDegrees(
    357.52911 + 35_999.05029 * T - 0.0001537 * T * T,
  );
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinDeg(M) +
    (0.019993 - 0.000101 * T) * sinDeg(2 * M) +
    0.000289 * sinDeg(3 * M);
  const trueLongitude = L0 + C;
  const omega = 125.04 - 1_934.136 * T;
  const lambdaApparent = trueLongitude - 0.00569 - 0.00478 * sinDeg(omega);
  const v = M + C;
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * cosDeg(v));
  return {
    lambdaDeg: normalizeDegrees(lambdaApparent),
    betaDeg: 0,
    distanceAu,
    semiDiameterDeg: 0.2666 / distanceAu,
  };
}

export function moonPosition(jd: number): LunarPosition {
  const T = julianCenturies(jd);
  const Lp = normalizeDegrees(218.3164477 + 481_267.88123421 * T);
  const D = normalizeDegrees(297.8501921 + 445_267.1114034 * T);
  const M = normalizeDegrees(357.5291092 + 35_999.0502909 * T);
  const Mp = normalizeDegrees(134.9633964 + 477_198.8675055 * T);
  const F = normalizeDegrees(93.272095 + 483_202.0175233 * T);

  const lambda =
    Lp +
    6.289 * sinDeg(Mp) +
    1.274 * sinDeg(2 * D - Mp) +
    0.658 * sinDeg(2 * D) +
    0.214 * sinDeg(2 * Mp) -
    0.186 * sinDeg(M) -
    0.114 * sinDeg(2 * F);

  const beta =
    5.128 * sinDeg(F) +
    0.281 * sinDeg(Mp + F) +
    0.278 * sinDeg(Mp - F) +
    0.173 * sinDeg(2 * D - F);

  const distanceKm =
    385_001 -
    20_905 * cosDeg(Mp) -
    3_699 * cosDeg(2 * D - Mp) -
    2_956 * cosDeg(2 * D) -
    570 * cosDeg(2 * Mp);

  return {
    lambdaDeg: normalizeDegrees(lambda),
    betaDeg: beta,
    distanceAu: distanceKm / 149_597_870.7,
    distanceKm,
    semiDiameterDeg: (1_737.4 / distanceKm) * (180 / Math.PI),
  };
}

export function earthShadowRadii(jd: number): ShadowRadii {
  const sun = sunPosition(jd);
  const moon = moonPosition(jd);
  const sunSd = sun.semiDiameterDeg;
  const lunarParallaxDeg =
    (6_378.137 / moon.distanceKm) * (180 / Math.PI);
  const solarParallaxDeg =
    (6_378.137 / (sun.distanceAu * 149_597_870.7)) * (180 / Math.PI);
  return {
    umbralDeg: lunarParallaxDeg + solarParallaxDeg - sunSd,
    penumbralDeg: lunarParallaxDeg + solarParallaxDeg + sunSd,
  };
}

export function sunMoonSeparationDeg(jd: number): number {
  const sun = sunPosition(jd);
  const moon = moonPosition(jd);
  return angularSeparationDeg(
    sun.lambdaDeg,
    sun.betaDeg,
    moon.lambdaDeg,
    moon.betaDeg,
  );
}

export function moonAntiSunSeparationDeg(jd: number): number {
  const sun = sunPosition(jd);
  const moon = moonPosition(jd);
  return angularSeparationDeg(
    normalizeDegrees(sun.lambdaDeg + 180),
    0,
    moon.lambdaDeg,
    moon.betaDeg,
  );
}
