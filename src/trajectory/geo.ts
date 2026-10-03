import type { LatLng } from './types.ts';

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centroidOf(positions: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of positions) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / positions.length, lng: lng / positions.length };
}

export function lerpLatLng(a: LatLng, b: LatLng, ratio: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
}

export function metersToLatDelta(meters: number): number {
  return meters / 111320;
}

export function metersToLngDelta(meters: number, atLat: number): number {
  return meters / (111320 * Math.cos(atLat * DEG_TO_RAD));
}
