import { RAD, DEG } from './constants';
import { sunState, moonState } from './ephemeris';
import { Observer, gmstDeg } from './observer';

export type { Observer } from './observer';
export { gmstDeg } from './observer';

export function altitudeDeg(
  jd: number,
  observer: Observer,
  body: 'sun' | 'moon',
): number {
  const state = body === 'sun' ? sunState(jd) : moonState(jd);
  const lst = gmstDeg(jd) + observer.longitudeDeg;
  const hourAngle = (lst - state.rightAscensionDeg) * RAD;
  const lat = observer.latitudeDeg * RAD;
  const dec = state.declinationDeg * RAD;
  const sinAlt =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
}

export function azimuthDeg(
  jd: number,
  observer: Observer,
  body: 'sun' | 'moon',
): number {
  const state = body === 'sun' ? sunState(jd) : moonState(jd);
  const lst = gmstDeg(jd) + observer.longitudeDeg;
  const hourAngle = (lst - state.rightAscensionDeg) * RAD;
  const lat = observer.latitudeDeg * RAD;
  const dec = state.declinationDeg * RAD;
  const y = Math.sin(hourAngle);
  const x =
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat);
  return ((Math.atan2(y, x) * DEG + 180) % 360 + 360) % 360;
}

export interface VisibilityVerdict {
  visible: boolean;
  reason: 'above_horizon' | 'below_horizon' | 'no_eclipse';
  maxAltitudeDeg: number;
  anyPhaseAboveHorizon: boolean;
}

export function judgeVisibility(
  phaseJds: Array<number | null>,
  magnitude: number,
  observer: Observer,
  body: 'sun' | 'moon',
): VisibilityVerdict {
  const phases = phaseJds.filter((p): p is number => p !== null);
  if (magnitude <= 0 || phases.length === 0) {
    const alt = phases.length > 0 ? altitudeDeg(phases[0], observer, body) : -90;
    return {
      visible: false,
      reason: 'no_eclipse',
      maxAltitudeDeg: alt,
      anyPhaseAboveHorizon: false,
    };
  }
  const altitudes = phases.map((p) => altitudeDeg(p, observer, body));
  const maxAltitude = Math.max(...altitudes);
  const anyAbove = altitudes.some((a) => a > 0);
  return {
    visible: anyAbove,
    reason: anyAbove ? 'above_horizon' : 'below_horizon',
    maxAltitudeDeg: maxAltitude,
    anyPhaseAboveHorizon: anyAbove,
  };
}
