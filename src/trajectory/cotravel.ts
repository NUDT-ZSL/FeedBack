import type { CoTravelInterval, InferenceParams, LatLng, Segment } from './types.ts';
import { pairKeyOf } from './types.ts';
import { haversineMeters, lerpLatLng } from './geo.ts';

export function positionAt(seg: Segment, t: number): LatLng {
  if (seg.type === 'stay') {
    return seg.centroid as LatLng;
  }
  const span = seg.endTime - seg.startTime;
  const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - seg.startTime) / span));
  return lerpLatLng(seg.startPos as LatLng, seg.endPos as LatLng, ratio);
}

export function minDistanceMeters(a: Segment, b: Segment, start: number, end: number): number {
  const samples = [start, (start + end) / 2, end];
  let min = Infinity;
  for (const t of samples) {
    min = Math.min(min, haversineMeters(positionAt(a, t), positionAt(b, t)));
  }
  return min;
}

interface RawInterval {
  startTime: number;
  endTime: number;
}

export function mergeIntervals(intervals: RawInterval[]): RawInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  const merged: RawInterval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.startTime <= last.endTime) {
      last.endTime = Math.max(last.endTime, iv.endTime);
    } else {
      merged.push({ startTime: iv.startTime, endTime: iv.endTime });
    }
  }
  return merged;
}

export function detectCoTravelForPair(
  targetA: string,
  segmentsA: Segment[],
  targetB: string,
  segmentsB: Segment[],
  params: InferenceParams,
): CoTravelInterval[] {
  const raw: RawInterval[] = [];
  for (const a of segmentsA) {
    for (const b of segmentsB) {
      const start = Math.max(a.startTime, b.startTime);
      const end = Math.min(a.endTime, b.endTime);
      if (end <= start) continue;
      if (minDistanceMeters(a, b, start, end) <= params.coTravelDistanceMeters) {
        raw.push({ startTime: start, endTime: end });
      }
    }
  }
  const [first, second] = targetA < targetB ? [targetA, targetB] : [targetB, targetA];
  return mergeIntervals(raw).map((iv) => ({
    pairKey: pairKeyOf(targetA, targetB),
    targetA: first,
    targetB: second,
    startTime: iv.startTime,
    endTime: iv.endTime,
  }));
}
