import type { Anomaly, InferenceParams, LocationPoint, Segment } from './types.ts';
import { centroidOf, haversineMeters } from './geo.ts';

export interface SegmentationResult {
  segments: Segment[];
  anomalies: Anomaly[];
}

export interface ValidationResult {
  valid: LocationPoint[];
  anomalies: Anomaly[];
}

export function validateAndSort(targetId: string, points: LocationPoint[]): ValidationResult {
  const anomalies: Anomaly[] = [];
  const valid: LocationPoint[] = [];
  let maxSeen = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.timestamp)) {
      anomalies.push({
        kind: 'invalid-timestamp',
        targetId,
        pointId: p.id,
        detail: `timestamp ${String(p.timestamp)} is not a finite number`,
      });
      continue;
    }
    const latOk = typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90;
    const lngOk = typeof p.lng === 'number' && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
    if (!latOk || !lngOk) {
      anomalies.push({
        kind: 'missing-coordinate',
        targetId,
        pointId: p.id,
        detail: `lat=${String(p.lat)} lng=${String(p.lng)} is missing or out of range`,
      });
      continue;
    }
    if (p.timestamp < maxSeen) {
      anomalies.push({
        kind: 'out-of-order',
        targetId,
        pointId: p.id,
        detail: `timestamp ${p.timestamp} appears after a later timestamp ${maxSeen} in input order`,
      });
    } else {
      maxSeen = p.timestamp;
    }
    valid.push(p);
  }
  valid.sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { valid, anomalies };
}

function makeStaySegment(targetId: string, members: LocationPoint[]): Segment {
  return {
    id: `seg:${targetId}:${members[0].id}`,
    targetId,
    type: 'stay',
    startTime: members[0].timestamp,
    endTime: members[members.length - 1].timestamp,
    pointIds: members.map((p) => p.id),
    centroid: centroidOf(members.map((p) => ({ lat: p.lat as number, lng: p.lng as number }))),
    startPos: null,
    endPos: null,
  };
}

function makeMoveSegment(targetId: string, members: LocationPoint[]): Segment {
  const first = members[0];
  const last = members[members.length - 1];
  return {
    id: `seg:${targetId}:${first.id}`,
    targetId,
    type: 'move',
    startTime: first.timestamp,
    endTime: last.timestamp,
    pointIds: members.map((p) => p.id),
    centroid: null,
    startPos: { lat: first.lat as number, lng: first.lng as number },
    endPos: { lat: last.lat as number, lng: last.lng as number },
  };
}

export function segmentTarget(
  targetId: string,
  points: LocationPoint[],
  params: InferenceParams,
): SegmentationResult {
  const { valid, anomalies } = validateAndSort(targetId, points);
  const segments: Segment[] = [];

  const flushTrip = (trip: LocationPoint[]): void => {
    let moveRun: LocationPoint[] = [];
    const flushMove = (): void => {
      if (moveRun.length > 0) {
        segments.push(makeMoveSegment(targetId, moveRun));
        moveRun = [];
      }
    };
    let i = 0;
    while (i < trip.length) {
      const members: LocationPoint[] = [trip[i]];
      let centroid = { lat: trip[i].lat as number, lng: trip[i].lng as number };
      let j = i + 1;
      while (j < trip.length) {
        const candidate = { lat: trip[j].lat as number, lng: trip[j].lng as number };
        if (haversineMeters(centroid, candidate) > params.stayRadiusMeters) break;
        members.push(trip[j]);
        centroid = centroidOf(members.map((p) => ({ lat: p.lat as number, lng: p.lng as number })));
        j += 1;
      }
      const duration = members[members.length - 1].timestamp - members[0].timestamp;
      if (members.length >= 2 && duration >= params.minStayDurationMs) {
        flushMove();
        segments.push(makeStaySegment(targetId, members));
      } else {
        moveRun.push(...members);
      }
      i = j;
    }
    flushMove();
  };

  let tripStart = 0;
  for (let i = 1; i <= valid.length; i += 1) {
    if (i === valid.length || valid[i].timestamp - valid[i - 1].timestamp > params.maxGapMs) {
      flushTrip(valid.slice(tripStart, i));
      tripStart = i;
    }
  }
  return { segments, anomalies };
}
