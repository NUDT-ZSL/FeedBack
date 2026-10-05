import { RAD, DEG, normDeg, angleDiff } from './constants';
import { jdCentury } from './time';

export interface BodyState {
  longitude: number;
  latitude: number;
  distanceKm: number;
  angularRadiusDeg: number;
  declinationDeg: number;
  rightAscensionDeg: number;
}

function sunLowPrecision(t: number) {
  const l0 = normDeg(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
  const m = normDeg(357.52911 + 35999.05029 * t - 0.0001537 * t * t) * RAD;
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * m) +
    0.000289 * Math.sin(3 * m);
  const trueLon = l0 + c;
  const eccentricity = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;
  const nu = m + c * RAD;
  const r = 1.000001018 * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(nu));
  return { longitude: normDeg(trueLon), distanceAu: r };
}

const OBLIQUITY = 23.4392911;

function eclipticToEquatorial(lonDeg: number, latDeg: number) {
  const lon = lonDeg * RAD;
  const lat = latDeg * RAD;
  const eps = OBLIQUITY * RAD;
  const ra = Math.atan2(
    Math.sin(lon) * Math.cos(eps) - Math.tan(lat) * Math.sin(eps),
    Math.cos(lon),
  );
  const dec = Math.asin(
    Math.sin(lat) * Math.cos(eps) + Math.cos(lat) * Math.sin(eps) * Math.sin(lon),
  );
  return { ra: normDeg(ra * DEG), dec: dec * DEG };
}

const SUN_ANGULAR_RADIUS_AT_AU_DEG = 0.2666;

export function sunState(jd: number): BodyState {
  const t = jdCentury(jd);
  const s = sunLowPrecision(t);
  const distanceKm = s.distanceAu * 149597870.7;
  const angularRadiusDeg = SUN_ANGULAR_RADIUS_AT_AU_DEG / s.distanceAu;
  const eq = eclipticToEquatorial(s.longitude, 0);
  return {
    longitude: s.longitude,
    latitude: 0,
    distanceKm,
    angularRadiusDeg,
    declinationDeg: eq.dec,
    rightAscensionDeg: eq.ra,
  };
}

interface MoonElements {
  lp: number;
  d: number;
  m: number;
  mp: number;
  f: number;
  t: number;
}

function moonElements(jd: number): MoonElements {
  const t = jdCentury(jd);
  return {
    t,
    lp: normDeg(218.3164477 + 481267.88123421 * t - 0.0015957 * t * t) * RAD,
    d: normDeg(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t) * RAD,
    m: normDeg(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t) * RAD,
    mp: normDeg(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t) * RAD,
    f: normDeg(93.2720950 + 483202.0175233 * t - 0.0036539 * t * t) * RAD,
  };
}

export function moonState(jd: number): BodyState {
  const e = moonElements(jd);
  const { d, m, mp, f } = e;
  const evection = 1.274 * Math.sin(mp - 2 * d);
  const equation = 0.6583 * Math.sin(2 * d);
  const variation = 0.2136 * Math.sin(2 * d);
  const yearly = 0.1851 * Math.sin(m);
  const monthly = -0.0588 * Math.sin(2 * mp - 2 * d);
  const dLon =
    6.289 * Math.sin(mp) +
    evection +
    equation +
    variation +
    yearly +
    monthly +
    0.0571 * Math.sin(2 * mp);
  const longitude = normDeg(e.lp * DEG + dLon);
  const dLat =
    5.128 * Math.sin(f) +
    0.2806 * Math.sin(mp + f) -
    0.2777 * Math.sin(mp - f) -
    0.1732 * Math.sin(d - 2 * f) +
    0.0554 * Math.sin(mp - 2 * d + f) +
    0.0463 * Math.sin(mp + 2 * d - f);
  const latitude = dLat;
  const radEarths =
    60.2666 -
    3.3469 * Math.cos(mp) -
    0.6003 * Math.cos(2 * d - mp) -
    0.2734 * Math.cos(2 * d);
  const distanceKm = radEarths * 6378.14;
  const angularRadiusDeg = 0.25905 * (60.2666 / radEarths);
  const eq = eclipticToEquatorial(longitude, latitude);
  return {
    longitude,
    latitude,
    distanceKm,
    angularRadiusDeg,
    declinationDeg: eq.dec,
    rightAscensionDeg: eq.ra,
  };
}

export type SyzygyKind = 'new' | 'full';

export function elongationDeg(jd: number): number {
  return Math.abs(angleDiff(moonState(jd).longitude, sunState(jd).longitude));
}

function meanLongitudeDeg(jd: number): { sun: number; moon: number } {
  const t = jdCentury(jd);
  return {
    sun: 280.46646 + 36000.76983 * t,
    moon: 218.3164477 + 481267.88123421 * t,
  };
}

function trueResidual(jd: number, kind: SyzygyKind): number {
  const m = meanLongitudeDeg(jd);
  const meanElong = angleDiff(m.moon, m.sun);
  // 先用平均黄经给出平滑初值, 再在其近邻取真残差
  void meanElong;
  const diff = angleDiff(moonState(jd).longitude, sunState(jd).longitude);
  return kind === 'new' ? diff : angleDiff(diff, 180);
}

// 平均朔望为严格线性函数, 先解析求出距离 nearJd 最近的一次,
// 再在其 ±0.75 天窗口内对真残差二分, 保证从任何初值出发结果唯一确定。
export function findSyzygy(nearJd: number, kind: SyzygyKind): number {
  const ratePerDay = (481267.88123421 - 36000.76983) / 36525;
  const m = meanLongitudeDeg(nearJd);
  const target = kind === 'new' ? 0 : 180;
  const f0 = angleDiff(m.moon - m.sun, target);
  const root0 = nearJd - f0 / ratePerDay;
  const period = 360 / ratePerDay;
  const k = Math.round((nearJd - root0) / period);
  const meanRoot = root0 + k * period;

  let lo = meanRoot - 0.75;
  let hi = meanRoot + 0.75;
  let fLo = trueResidual(lo, kind);
  let fHi = trueResidual(hi, kind);
  let width = 0.75;
  while (fLo * fHi > 0 && width < 2.5) {
    width += 0.25;
    lo = meanRoot - width;
    hi = meanRoot + width;
    fLo = trueResidual(lo, kind);
    fHi = trueResidual(hi, kind);
  }
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = trueResidual(mid, kind);
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export function nearestSyzygyGuess(jd: number, kind: SyzygyKind): number {
  const s = moonState(jd);
  const sun = sunState(jd);
  const target = kind === 'new' ? sun.longitude : normDeg(sun.longitude + 180);
  const delta = angleDiff(target, s.longitude);
  const ratePerDay = 12.19;
  return jd + delta / ratePerDay;
}
