import { clamp } from './constants';

export type SolarEclipseType = 'none' | 'partial' | 'annular' | 'total';
export type LunarEclipseType = 'none' | 'penumbral' | 'partial' | 'total';

export interface SolarGeometry {
  type: SolarEclipseType;
  magnitude: number;
  obscuration: number;
  gamma: number;
  dDeg: number;
  sunRadiusDeg: number;
  moonRadiusDeg: number;
  relativeSpeedDegPerDay: number;
  contacts: {
    first: number | null;
    second: number | null;
    max: number;
    third: number | null;
    fourth: number | null;
  };
  durationDays: number;
  centralDurationDays: number;
}

export interface LunarGeometry {
  type: LunarEclipseType;
  umbralMagnitude: number;
  penumbralMagnitude: number;
  dDeg: number;
  umbralRadiusDeg: number;
  penumbralRadiusDeg: number;
  moonRadiusDeg: number;
  relativeSpeedDegPerDay: number;
  contacts: {
    penumbralFirst: number | null;
    umbralFirst: number | null;
    umbralSecond: number | null;
    max: number;
    umbralThird: number | null;
    umbralFourth: number | null;
    penumbralFourth: number | null;
  };
  umbralDurationDays: number;
  penumbralDurationDays: number;
}

function chordHalfWidth(sumRadii: number, d: number): number {
  const inside = sumRadii * sumRadii - d * d;
  return inside <= 0 ? 0 : Math.sqrt(inside);
}

export function solarGeometry(
  t0Jd: number,
  dDegRaw: number,
  sunRadiusDeg: number,
  moonRadiusDeg: number,
  relativeSpeedDegPerDay: number,
): SolarGeometry {
  const dDeg = Math.abs(dDegRaw);
  const externalSum = sunRadiusDeg + moonRadiusDeg;
  const internalDiff = Math.abs(moonRadiusDeg - sunRadiusDeg);
  const magnitude = (externalSum - dDeg) / (2 * sunRadiusDeg);
  const gamma = dDeg / externalSum;

  let type: SolarEclipseType = 'none';
  if (magnitude > 0) {
    if (dDeg <= internalDiff) {
      type = moonRadiusDeg >= sunRadiusDeg ? 'total' : 'annular';
    } else {
      type = 'partial';
    }
  }

  const halfExternal = chordHalfWidth(externalSum, dDeg);
  const durationDays = (2 * halfExternal) / relativeSpeedDegPerDay;
  const hasExternal = dDeg < externalSum;
  const hasInternal = dDeg < internalDiff;
  const halfInternal = hasInternal ? chordHalfWidth(internalDiff, dDeg) : 0;
  const centralDurationDays = hasInternal ? (2 * halfInternal) / relativeSpeedDegPerDay : 0;

  return {
    type,
    magnitude: clamp(magnitude, 0, 10),
    obscuration: type === 'total' ? 1 : type === 'annular' ? 0 : clamp(magnitude, 0, 1),
    gamma,
    dDeg,
    sunRadiusDeg,
    moonRadiusDeg,
    relativeSpeedDegPerDay,
    contacts: {
      first: hasExternal ? t0Jd - halfExternal / relativeSpeedDegPerDay : null,
      second: hasInternal ? t0Jd - halfInternal / relativeSpeedDegPerDay : null,
      max: t0Jd,
      third: hasInternal ? t0Jd + halfInternal / relativeSpeedDegPerDay : null,
      fourth: hasExternal ? t0Jd + halfExternal / relativeSpeedDegPerDay : null,
    },
    durationDays,
    centralDurationDays,
  };
}

export function lunarGeometry(
  t0Jd: number,
  dDegRaw: number,
  moonRadiusDeg: number,
  umbralRadiusDeg: number,
  penumbralRadiusDeg: number,
  relativeSpeedDegPerDay: number,
): LunarGeometry {
  const dDeg = Math.abs(dDegRaw);
  const umbralSum = umbralRadiusDeg + moonRadiusDeg;
  const penumbralSum = penumbralRadiusDeg + moonRadiusDeg;
  const umbralMagnitude = (umbralSum - dDeg) / (2 * moonRadiusDeg);
  const penumbralMagnitude = (penumbralSum - dDeg) / (2 * moonRadiusDeg);

  let type: LunarEclipseType = 'none';
  if (umbralMagnitude >= 1) {
    type = 'total';
  } else if (umbralMagnitude > 0) {
    type = 'partial';
  } else if (penumbralMagnitude > 0) {
    type = 'penumbral';
  }

  const hasPenumbral = dDeg < penumbralSum;
  const hasUmbral = dDeg < umbralSum;
  const hasTotal = dDeg < Math.abs(umbralRadiusDeg - moonRadiusDeg);
  const halfPenumbral = chordHalfWidth(penumbralSum, dDeg);
  const halfUmbral = chordHalfWidth(umbralSum, dDeg);
  const halfTotal = hasTotal
    ? chordHalfWidth(Math.abs(umbralRadiusDeg - moonRadiusDeg), dDeg)
    : 0;

  return {
    type,
    umbralMagnitude: clamp(umbralMagnitude, 0, 10),
    penumbralMagnitude: clamp(penumbralMagnitude, 0, 10),
    dDeg,
    umbralRadiusDeg,
    penumbralRadiusDeg,
    moonRadiusDeg,
    relativeSpeedDegPerDay,
    contacts: {
      penumbralFirst: hasPenumbral ? t0Jd - halfPenumbral / relativeSpeedDegPerDay : null,
      umbralFirst: hasUmbral ? t0Jd - halfUmbral / relativeSpeedDegPerDay : null,
      umbralSecond: hasTotal ? t0Jd - halfTotal / relativeSpeedDegPerDay : null,
      max: t0Jd,
      umbralThird: hasTotal ? t0Jd + halfTotal / relativeSpeedDegPerDay : null,
      umbralFourth: hasUmbral ? t0Jd + halfUmbral / relativeSpeedDegPerDay : null,
      penumbralFourth: hasPenumbral ? t0Jd + halfPenumbral / relativeSpeedDegPerDay : null,
    },
    umbralDurationDays: hasUmbral ? (2 * halfUmbral) / relativeSpeedDegPerDay : 0,
    penumbralDurationDays: hasPenumbral ? (2 * halfPenumbral) / relativeSpeedDegPerDay : 0,
  };
}
