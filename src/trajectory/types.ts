export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationPoint {
  id: string;
  targetId: string;
  timestamp: number;
  lat: number | null;
  lng: number | null;
}

export interface InferenceParams {
  stayRadiusMeters: number;
  minStayDurationMs: number;
  coTravelDistanceMeters: number;
  maxGapMs: number;
}

export type AnomalyKind = 'out-of-order' | 'missing-coordinate' | 'invalid-timestamp';

export interface Anomaly {
  kind: AnomalyKind;
  targetId: string;
  pointId: string;
  detail: string;
}

export type SegmentType = 'stay' | 'move';

export interface Segment {
  id: string;
  targetId: string;
  type: SegmentType;
  startTime: number;
  endTime: number;
  pointIds: string[];
  centroid: LatLng | null;
  startPos: LatLng | null;
  endPos: LatLng | null;
}

export interface CoTravelInterval {
  pairKey: string;
  targetA: string;
  targetB: string;
  startTime: number;
  endTime: number;
}

export function pairKeyOf(targetA: string, targetB: string): string {
  return targetA < targetB ? `${targetA}|${targetB}` : `${targetB}|${targetA}`;
}
