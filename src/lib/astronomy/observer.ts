import { RAD, DEG, OBLIQUITY, normDeg } from './constants';
import { sunState, moonState, BodyState } from './ephemeris';

export interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
  timezoneOffsetHours: number;
}

export function gmstDeg(jd: number): number {
  const t = (jd - 2451545.0) / 36525;
  return normDeg(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * t * t -
      (t * t * t) / 38710000,
  );
}

function equatorialUnit(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

function observerUnit(jd: number, observer: Observer): [number, number, number] {
  const lst = gmstDeg(jd) * RAD;
  const phi = observer.latitudeDeg * RAD;
  return [
    Math.cos(phi) * Math.cos(lst),
    Math.cos(phi) * Math.sin(lst),
    Math.sin(phi),
  ];
}

function toEcliptic(raDeg: number, decDeg: number) {
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  const eps = OBLIQUITY * RAD;
  const lon = Math.atan2(
    Math.sin(ra) * Math.cos(eps) + Math.tan(dec) * Math.sin(eps),
    Math.cos(ra),
  );
  const lat = Math.asin(
    Math.sin(dec) * Math.cos(eps) - Math.cos(dec) * Math.sin(eps) * Math.sin(ra),
  );
  return { longitude: normDeg(lon * DEG), latitude: lat * DEG };
}

// 地面观测者视差改正: 以几何向量方式把日/月的地心位置减去观测者位置,
// 得到地面观测者所见的日月视位置(赤经/赤纬与视距离)。
export function topocentricBody(
  jd: number,
  observer: Observer,
  body: 'sun' | 'moon',
): BodyState {
  const geo = body === 'sun' ? sunState(jd) : moonState(jd);
  const target = equatorialUnit(geo.rightAscensionDeg, geo.declinationDeg);
  const obs = observerUnit(jd, observer);
  const dKm = geo.distanceKm;
  const px = dKm * target[0] - 6371.0 * obs[0];
  const py = dKm * target[1] - 6371.0 * obs[1];
  const pz = dKm * target[2] - 6371.0 * obs[2];
  const dTop = Math.sqrt(px * px + py * py + pz * pz);
  const raRad = Math.atan2(py, px);
  const decRad = Math.asin(Math.max(-1, Math.min(1, pz / dTop)));
  const ra = normDeg(raRad * DEG);
  const dec = decRad * DEG;
  const ecl = toEcliptic(ra, dec);
  return {
    longitude: ecl.longitude,
    latitude: ecl.latitude,
    distanceKm: dTop,
    angularRadiusDeg: (geo.angularRadiusDeg * dKm) / dTop,
    declinationDeg: dec,
    rightAscensionDeg: ra,
  };
}

export function angularSeparationDeg(a: BodyState, b: BodyState): number {
  const ra1 = a.rightAscensionDeg * RAD;
  const ra2 = b.rightAscensionDeg * RAD;
  const d1 = a.declinationDeg * RAD;
  const d2 = b.declinationDeg * RAD;
  const cosSep =
    Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) * DEG;
}

export function topocentricSeparationDeg(
  jd: number,
  observer: Observer,
): number {
  const sun = topocentricBody(jd, observer, 'sun');
  const moon = topocentricBody(jd, observer, 'moon');
  return angularSeparationDeg(sun, moon);
}
