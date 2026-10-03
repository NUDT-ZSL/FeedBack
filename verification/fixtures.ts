import type { InferenceParams, LatLng, LocationPoint } from '../src/trajectory/types.ts';
import { lerpLatLng, metersToLatDelta, metersToLngDelta } from '../src/trajectory/geo.ts';

export const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
export const MIN = 60_000;

export const DEFAULT_PARAMS: InferenceParams = {
  stayRadiusMeters: 60,
  minStayDurationMs: 10 * MIN,
  coTravelDistanceMeters: 100,
  maxGapMs: 20 * MIN,
};

export const HOME: LatLng = { lat: 31.2304, lng: 121.4737 };
export const CAFE: LatLng = { lat: 31.2445, lng: 121.491 };
export const OFFICE: LatLng = { lat: 31.27, lng: 121.52 };
export const FAR_AWAY: LatLng = { lat: 31.5, lng: 121.9 };
export const PATH_FROM: LatLng = { lat: 31.3, lng: 121.5 };
export const PATH_TO: LatLng = { lat: 31.32, lng: 121.54 };

export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function offsetMeters(center: LatLng, eastMeters: number, northMeters: number): LatLng {
  return {
    lat: center.lat + metersToLatDelta(northMeters),
    lng: center.lng + metersToLngDelta(eastMeters, center.lat),
  };
}

export function stayPoints(
  targetId: string,
  prefix: string,
  center: LatLng,
  startMin: number,
  count: number,
  stepMin: number,
  jitterMeters = 8,
  seed = 42,
): LocationPoint[] {
  const rand = mulberry32(seed);
  const points: LocationPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const east = (rand() * 2 - 1) * jitterMeters;
    const north = (rand() * 2 - 1) * jitterMeters;
    const pos = offsetMeters(center, east, north);
    points.push({
      id: `${targetId}-${prefix}-${i + 1}`,
      targetId,
      timestamp: T0 + (startMin + i * stepMin) * MIN,
      lat: pos.lat,
      lng: pos.lng,
    });
  }
  return points;
}

export function movePoints(
  targetId: string,
  prefix: string,
  from: LatLng,
  to: LatLng,
  startMin: number,
  count: number,
  stepMin: number,
): LocationPoint[] {
  const points: LocationPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count <= 1 ? 0 : i / (count - 1);
    points.push({
      id: `${targetId}-${prefix}-${i + 1}`,
      targetId,
      timestamp: T0 + (startMin + i * stepMin) * MIN,
      lat: from.lat + (to.lat - from.lat) * ratio,
      lng: from.lng + (to.lng - from.lng) * ratio,
    });
  }
  return points;
}

export function baseTripPoints(targetId: string): LocationPoint[] {
  return [
    ...stayPoints(targetId, 'home', HOME, 0, 7, 5),
    ...movePoints(targetId, 'm1', lerpLatLng(HOME, CAFE, 0.2), lerpLatLng(HOME, CAFE, 0.8), 35, 5, 4),
    ...stayPoints(targetId, 'cafe', CAFE, 55, 3, 6),
    ...movePoints(targetId, 'm2', lerpLatLng(CAFE, OFFICE, 0.2), lerpLatLng(CAFE, OFFICE, 0.8), 72, 4, 4),
    ...stayPoints(targetId, 'off', OFFICE, 90, 7, 10),
  ];
}

export function companionPoints(targetId: string): LocationPoint[] {
  return [
    ...stayPoints(targetId, 'home', FAR_AWAY, 0, 4, 10),
    ...stayPoints(targetId, 'off', offsetMeters(OFFICE, 30, 20), 100, 6, 10),
  ];
}

export function partialOverlapPoints(targetId: string): LocationPoint[] {
  return stayPoints(targetId, 'off', offsetMeters(OFFICE, -25, 15), 140, 7, 10);
}

export function movingPairPoints(): { c: LocationPoint[]; d: LocationPoint[] } {
  const dFrom = offsetMeters(lerpLatLng(PATH_FROM, PATH_TO, 0.25), 0, 50);
  const dTo = offsetMeters(lerpLatLng(PATH_FROM, PATH_TO, 1.25), 0, 50);
  return {
    c: movePoints('C', 'mv', PATH_FROM, PATH_TO, 0, 9, 5),
    d: movePoints('D', 'mv', dFrom, dTo, 10, 9, 5),
  };
}

export function clonePoints(points: LocationPoint[]): LocationPoint[] {
  return points.map((p) => ({ ...p }));
}

export function patchPointInList(
  points: LocationPoint[],
  pointId: string,
  patch: Partial<Omit<LocationPoint, 'id' | 'targetId'>>,
): LocationPoint[] {
  return points.map((p) => (p.id === pointId ? { ...p, ...patch, id: p.id, targetId: p.targetId } : p));
}
