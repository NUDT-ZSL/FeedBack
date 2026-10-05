export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export const J2000 = 2451545.0;
export const TROPICAL_YEAR_DAYS = 365.2422;
export const SYNODIC_MONTH_DAYS = 29.530588853;

export const OBLIQUITY = 23.4392911;
export const EARTH_KM = 6371.0;
export const MOON_SEMI_MAJOR_KM = 384400.0;
export const SUN_SEMI_MAJOR_KM = 149597870.7;
export const SUN_RADIUS_KM = 696340.0;

export const HOURS_PER_DEGREE = 1 / 15;

export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
