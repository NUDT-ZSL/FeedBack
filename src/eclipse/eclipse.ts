import {
  earthShadowRadii,
  moonAntiSunSeparationDeg,
  moonPosition,
  sunMoonSeparationDeg,
  sunPosition,
} from "./ephemeris.ts";
import { julianDayToDate, sinDeg, cosDeg } from "./julian.ts";
import type {
  EclipseInput,
  EclipsePrediction,
  EclipseType,
  Observer,
  PhaseTimes,
  VisibilityResult,
} from "./types.ts";

export const HYBRID_TOLERANCE = 0.0005;
export const MAGNITUDE_EPSILON = 1e-9;

export function classifySolarEclipse(
  sunRadiusDeg: number,
  moonRadiusDeg: number,
  minSeparationDeg: number,
): EclipseType {
  if (minSeparationDeg >= sunRadiusDeg + moonRadiusDeg) return "none";
  const radiiDifference = Math.abs(moonRadiusDeg - sunRadiusDeg);
  if (minSeparationDeg < radiiDifference) {
    if (Math.abs(moonRadiusDeg - sunRadiusDeg) <= HYBRID_TOLERANCE) {
      return "solar-total";
    }
    return moonRadiusDeg > sunRadiusDeg ? "solar-total" : "solar-annular";
  }
  return "solar-partial";
}

export function classifyLunarEclipse(
  umbralRadiusDeg: number,
  penumbralRadiusDeg: number,
  moonRadiusDeg: number,
  minSeparationDeg: number,
): EclipseType {
  if (minSeparationDeg >= penumbralRadiusDeg + moonRadiusDeg) return "none";
  if (minSeparationDeg >= umbralRadiusDeg + moonRadiusDeg) {
    return "lunar-penumbral";
  }
  if (minSeparationDeg + moonRadiusDeg <= umbralRadiusDeg) {
    return "lunar-total";
  }
  return "lunar-partial";
}

export function solarMagnitude(
  sunRadiusDeg: number,
  moonRadiusDeg: number,
  minSeparationDeg: number,
): number {
  const magnitude =
    (sunRadiusDeg + moonRadiusDeg - minSeparationDeg) / (2 * sunRadiusDeg);
  return Math.max(0, magnitude);
}

export function lunarUmbralMagnitude(
  umbralRadiusDeg: number,
  moonRadiusDeg: number,
  minSeparationDeg: number,
): number {
  const magnitude =
    (umbralRadiusDeg + moonRadiusDeg - minSeparationDeg) / (2 * moonRadiusDeg);
  return Math.max(0, magnitude);
}

export interface SeparationExtremum {
  jd: number;
  separationDeg: number;
}

function findLocalMinimum(
  fn: (jd: number) => number,
  jdStart: number,
  jdEnd: number,
  coarseStepDays: number,
): SeparationExtremum | null {
  let bestJd: number | null = null;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let jd = jdStart; jd <= jdEnd + 1e-9; jd += coarseStepDays) {
    const value = fn(jd);
    if (value < bestValue) {
      bestValue = value;
      bestJd = jd;
    }
  }
  if (bestJd === null) return null;
  let lo = Math.max(jdStart, bestJd - coarseStepDays);
  let hi = Math.min(jdEnd, bestJd + coarseStepDays);
  for (let i = 0; i < 60; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (fn(m1) < fn(m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  const jd = (lo + hi) / 2;
  return { jd, separationDeg: fn(jd) };
}

function solveCrossing(
  fn: (jd: number) => number,
  threshold: number,
  jdA: number,
  jdB: number,
  rising: boolean,
): number | null {
  const valueA = fn(jdA) - threshold;
  const valueB = fn(jdB) - threshold;
  if (valueA === 0) return jdA;
  if (valueB === 0) return jdB;
  const expectOrder = rising ? valueA < 0 && valueB > 0 : valueA > 0 && valueB < 0;
  if (!expectOrder) return null;
  let lo = jdA;
  let hi = jdB;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const value = fn(mid) - threshold;
    if (rising ? value < 0 : value > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function solvePhaseTimes(
  separationFn: (jd: number) => number,
  thresholdFn: (jd: number) => number,
  jdAtMaximum: number,
  windowDays: number,
): PhaseTimes | null {
  const gap = (jd: number) => separationFn(jd) - thresholdFn(jd);
  if (gap(jdAtMaximum) >= 0) return null;
  const jdStart = jdAtMaximum - windowDays;
  const jdEnd = jdAtMaximum + windowDays;
  const step = windowDays / 200;
  let firstContactJd: number | null = null;
  let lastContactJd: number | null = null;
  let prevJd = jdStart;
  let prevGap = gap(jdStart);
  for (let jd = jdStart + step; jd <= jdEnd + 1e-12; jd += step) {
    const currentGap = gap(jd);
    if (prevGap > 0 && currentGap <= 0 && firstContactJd === null) {
      firstContactJd = solveCrossing(gap, 0, prevJd, jd, false);
    }
    if (prevGap <= 0 && currentGap > 0) {
      lastContactJd = solveCrossing(gap, 0, prevJd, jd, true);
    }
    prevJd = jd;
    prevGap = currentGap;
  }
  if (firstContactJd === null || lastContactJd === null) return null;
  return {
    firstContact: julianDayToDate(firstContactJd),
    maximum: julianDayToDate(jdAtMaximum),
    lastContact: julianDayToDate(lastContactJd),
  };
}

function gmstDeg(jd: number): number {
  const T = (jd - 2_451_545.0) / 36_525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2_451_545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38_710_000;
  const wrapped = gmst % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function solarAltitudeDeg(jd: number, observer: Observer): number {
  const sun = sunPosition(jd);
  const T = (jd - 2_451_545.0) / 36_525.0;
  const epsilon =
    23.439291 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T;
  const ra = Math.atan2(
    cosDeg(epsilon) * sinDeg(sun.lambdaDeg),
    cosDeg(sun.lambdaDeg),
  );
  const declination = Math.asin(sinDeg(epsilon) * sinDeg(sun.lambdaDeg));
  const hourAngleDeg =
    gmstDeg(jd) + observer.longitudeDeg - (ra * 180) / Math.PI;
  const ha = (hourAngleDeg * Math.PI) / 180;
  const lat = (observer.latitudeDeg * Math.PI) / 180;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(ha),
  );
  return (altitude * 180) / Math.PI;
}

export function lunarAltitudeDeg(jd: number, observer: Observer): number {
  const moon = moonPosition(jd);
  const T = (jd - 2_451_545.0) / 36_525.0;
  const epsilon =
    23.439291 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T;
  const ra = Math.atan2(
    sinDeg(moon.lambdaDeg) * cosDeg(epsilon) -
      Math.tan((moon.betaDeg * Math.PI) / 180) * sinDeg(epsilon),
    cosDeg(moon.lambdaDeg),
  );
  const declination = Math.asin(
    sinDeg(moon.betaDeg) * cosDeg(epsilon) +
      cosDeg(moon.betaDeg) * sinDeg(epsilon) * sinDeg(moon.lambdaDeg),
  );
  const hourAngleDeg =
    gmstDeg(jd) + observer.longitudeDeg - (ra * 180) / Math.PI;
  const ha = (hourAngleDeg * Math.PI) / 180;
  const lat = (observer.latitudeDeg * Math.PI) / 180;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(ha),
  );
  return (altitude * 180) / Math.PI;
}

export function computeVisibility(
  kind: "solar" | "lunar",
  observer: Observer,
  jdStart: number,
  jdEnd: number,
  jdAtMaximum: number,
): VisibilityResult {
  const altitudeFn =
    kind === "solar"
      ? (jd: number) => solarAltitudeDeg(jd, observer)
      : (jd: number) => lunarAltitudeDeg(jd, observer);
  const samples = 720;
  const step = (jdEnd - jdStart) / samples;
  let maxAltitude = Number.NEGATIVE_INFINITY;
  let maxAltitudeJd = jdStart;
  let firstVisibleJd: number | null = null;
  let lastVisibleJd: number | null = null;
  for (let i = 0; i <= samples; i += 1) {
    const jd = jdStart + i * step;
    const altitude = altitudeFn(jd);
    if (altitude > maxAltitude) {
      maxAltitude = altitude;
      maxAltitudeJd = jd;
    }
    if (altitude > 0) {
      if (firstVisibleJd === null) firstVisibleJd = jd;
      lastVisibleJd = jd;
    }
  }
  const visible = firstVisibleJd !== null && lastVisibleJd !== null;
  return {
    visible,
    maxAltitudeDeg: maxAltitude,
    altitudeAtMaximumDeg: altitudeFn(jdAtMaximum),
    visibleFrom: visible ? julianDayToDate(firstVisibleJd!) : null,
    visibleUntil: visible ? julianDayToDate(lastVisibleJd!) : null,
    reason: visible ? "above-horizon" : "below-horizon",
  };
}

const SEARCH_WINDOW_DAYS = 15;
const PHASE_WINDOW_DAYS = 0.5;

export function predictEclipse(input: EclipseInput): EclipsePrediction {
  const jdCenter =
    input.date.getTime() / 86_400_000 + 2_440_587.5;
  const separationFn =
    input.kind === "solar" ? sunMoonSeparationDeg : moonAntiSunSeparationDeg;
  const extremum = findLocalMinimum(
    separationFn,
    jdCenter - SEARCH_WINDOW_DAYS,
    jdCenter + SEARCH_WINDOW_DAYS,
    0.25,
  );
  if (extremum === null) {
    throw new Error("ephemeris search failed to converge");
  }
  const jdMax = extremum.jd;

  let type: EclipseType;
  let magnitude: number;

  if (input.kind === "solar") {
    const sun = sunPosition(jdMax);
    const moon = moonPosition(jdMax);
    type = classifySolarEclipse(
      sun.semiDiameterDeg,
      moon.semiDiameterDeg,
      extremum.separationDeg,
    );
    magnitude = solarMagnitude(
      sun.semiDiameterDeg,
      moon.semiDiameterDeg,
      extremum.separationDeg,
    );
  } else {
    const shadow = earthShadowRadii(jdMax);
    const moon = moonPosition(jdMax);
    type = classifyLunarEclipse(
      shadow.umbralDeg,
      shadow.penumbralDeg,
      moon.semiDiameterDeg,
      extremum.separationDeg,
    );
    magnitude = lunarUmbralMagnitude(
      shadow.umbralDeg,
      moon.semiDiameterDeg,
      extremum.separationDeg,
    );
  }

  if (type === "none" || magnitude <= MAGNITUDE_EPSILON) {
    return {
      kind: input.kind,
      type: "none",
      magnitude: 0,
      jdAtMaximum: jdMax,
      maximum: julianDayToDate(jdMax),
      phases: null,
      minimumSeparationDeg: extremum.separationDeg,
      visibility: input.observer
        ? {
            visible: false,
            maxAltitudeDeg: Number.NEGATIVE_INFINITY,
            altitudeAtMaximumDeg: 0,
            visibleFrom: null,
            visibleUntil: null,
            reason: "no-eclipse",
          }
        : null,
    };
  }

  const thresholdFn =
    input.kind === "solar"
      ? (jd: number) =>
          sunPosition(jd).semiDiameterDeg + moonPosition(jd).semiDiameterDeg
      : (jd: number) =>
          earthShadowRadii(jd).penumbralDeg + moonPosition(jd).semiDiameterDeg;

  const phases = solvePhaseTimes(
    separationFn,
    thresholdFn,
    jdMax,
    PHASE_WINDOW_DAYS,
  );

  let visibility: VisibilityResult | null = null;
  if (input.observer && phases) {
    const jdStart = phases.firstContact.getTime() / 86_400_000 + 2_440_587.5;
    const jdEnd = phases.lastContact.getTime() / 86_400_000 + 2_440_587.5;
    visibility = computeVisibility(
      input.kind,
      input.observer,
      jdStart,
      jdEnd,
      jdMax,
    );
  }

  return {
    kind: input.kind,
    type,
    magnitude,
    jdAtMaximum: jdMax,
    maximum: julianDayToDate(jdMax),
    phases,
    minimumSeparationDeg: extremum.separationDeg,
    visibility,
  };
}
