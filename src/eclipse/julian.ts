const MS_PER_DAY = 86_400_000;

export function dateToJulianDay(date: Date): number {
  return date.getTime() / MS_PER_DAY + 2_440_587.5;
}

export function julianDayToDate(jd: number): Date {
  return new Date((jd - 2_440_587.5) * MS_PER_DAY);
}

export function julianCenturies(jd: number): number {
  return (jd - 2_451_545.0) / 36_525.0;
}

export function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function sinDeg(deg: number): number {
  return Math.sin((deg * Math.PI) / 180);
}

export function cosDeg(deg: number): number {
  return Math.cos((deg * Math.PI) / 180);
}

export function angularSeparationDeg(
  lambdaA: number,
  betaA: number,
  lambdaB: number,
  betaB: number,
): number {
  const cosSep =
    sinDeg(betaA) * sinDeg(betaB) +
    cosDeg(betaA) * cosDeg(betaB) * cosDeg(lambdaA - lambdaB);
  const clamped = Math.min(1, Math.max(-1, cosSep));
  return (Math.acos(clamped) * 180) / Math.PI;
}

export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
