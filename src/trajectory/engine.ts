import type {
  Anomaly,
  CoTravelInterval,
  InferenceParams,
  LocationPoint,
  Segment,
} from './types.ts';
import { pairKeyOf } from './types.ts';
import { segmentTarget, validateAndSort } from './segment.ts';
import { detectCoTravelForPair } from './cotravel.ts';

export interface RecomputeWindow {
  start: number;
  end: number;
}

export interface RecomputeReport {
  seq: number;
  reason: string;
  targetIds: string[];
  window: RecomputeWindow | null;
  recomputedSegmentIds: string[];
  recomputedPairKeys: string[];
}

export interface EngineState {
  params: InferenceParams;
  segmentsByTarget: Record<string, Segment[]>;
  coTravelByPair: Record<string, CoTravelInterval[]>;
  anomaliesByTarget: Record<string, Anomaly[]>;
}

function segmentsEqual(a: Segment, b: Segment): boolean {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.startTime !== b.startTime ||
    a.endTime !== b.endTime ||
    a.pointIds.length !== b.pointIds.length
  ) {
    return false;
  }
  for (let i = 0; i < a.pointIds.length; i += 1) {
    if (a.pointIds[i] !== b.pointIds[i]) return false;
  }
  const posEqual = (
    x: { lat: number; lng: number } | null,
    y: { lat: number; lng: number } | null,
  ): boolean => {
    if (x === null || y === null) return x === y;
    return x.lat === y.lat && x.lng === y.lng;
  };
  return (
    posEqual(a.centroid, b.centroid) && posEqual(a.startPos, b.startPos) && posEqual(a.endPos, b.endPos)
  );
}

function intervalsEqual(a: CoTravelInterval, b: CoTravelInterval): boolean {
  return (
    a.pairKey === b.pairKey &&
    a.targetA === b.targetA &&
    a.targetB === b.targetB &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime
  );
}

export class TrajectoryEngine {
  private params: InferenceParams;
  private readonly pointsByTarget = new Map<string, LocationPoint[]>();
  private readonly segments = new Map<string, Segment[]>();
  private readonly coTravel = new Map<string, CoTravelInterval[]>();
  private readonly anomalies = new Map<string, Anomaly[]>();
  readonly recomputeLog: RecomputeReport[] = [];
  private seq = 0;

  constructor(params: InferenceParams) {
    this.params = { ...params };
  }

  load(points: LocationPoint[]): RecomputeReport {
    this.pointsByTarget.clear();
    this.segments.clear();
    this.coTravel.clear();
    this.anomalies.clear();
    for (const p of points) {
      const list = this.pointsByTarget.get(p.targetId) ?? [];
      list.push({ ...p });
      this.pointsByTarget.set(p.targetId, list);
    }
    const recomputedSegmentIds: string[] = [];
    for (const [targetId, list] of this.pointsByTarget) {
      const result = segmentTarget(targetId, list, this.params);
      this.segments.set(targetId, result.segments);
      this.anomalies.set(targetId, result.anomalies);
      for (const s of result.segments) recomputedSegmentIds.push(s.id);
    }
    const recomputedPairKeys = this.recomputeAllPairs();
    return this.record('load', [...this.pointsByTarget.keys()], null, recomputedSegmentIds, recomputedPairKeys);
  }

  correctPoint(
    targetId: string,
    pointId: string,
    patch: Partial<Omit<LocationPoint, 'id' | 'targetId'>>,
  ): RecomputeReport {
    const list = this.pointsByTarget.get(targetId);
    if (!list) throw new Error(`unknown target ${targetId}`);
    const index = list.findIndex((p) => p.id === pointId);
    if (index < 0) throw new Error(`unknown point ${pointId} for target ${targetId}`);
    const old = list[index];
    const updated: LocationPoint = { ...old, ...patch, id: old.id, targetId: old.targetId };
    list[index] = updated;

    const t0 = Math.min(old.timestamp, updated.timestamp);
    const t1 = Math.max(old.timestamp, updated.timestamp);
    const oldSegs = this.segments.get(targetId) ?? [];

    let window: RecomputeWindow;
    let lo = 0;
    let hi = -1;
    if (oldSegs.length > 0) {
      lo = oldSegs.findIndex((s) => s.endTime >= t0);
      if (lo < 0) lo = oldSegs.length - 1;
      hi = -1;
      for (let i = oldSegs.length - 1; i >= 0; i -= 1) {
        if (oldSegs[i].startTime <= t1) {
          hi = i;
          break;
        }
      }
      if (hi < 0) hi = 0;
      lo = Math.max(0, lo - 1);
      hi = Math.min(oldSegs.length - 1, hi + 1);
      window = { start: oldSegs[lo].startTime, end: oldSegs[hi].endTime };
    } else {
      window = { start: t0, end: t1 };
    }

    const windowPoints = list.filter((p) => p.timestamp >= window.start && p.timestamp <= window.end);
    const { segments: newSegs } = segmentTarget(targetId, windowPoints, this.params);
    const nextSegs =
      oldSegs.length > 0
        ? [...oldSegs.slice(0, lo), ...newSegs, ...oldSegs.slice(hi + 1)]
        : newSegs;
    this.segments.set(targetId, nextSegs);

    this.anomalies.set(targetId, validateAndSort(targetId, list).anomalies);

    const recomputedPairKeys: string[] = [];
    for (const otherId of this.pointsByTarget.keys()) {
      if (otherId === targetId) continue;
      const key = pairKeyOf(targetId, otherId);
      const existing = this.coTravel.get(key) ?? [];
      const kept = existing.filter(
        (iv) => iv.endTime <= window.start || iv.startTime >= window.end,
      );
      const [first, second] = key.split('|');
      const fresh = detectCoTravelForPair(
        first,
        this.segments.get(first) ?? [],
        second,
        this.segments.get(second) ?? [],
        this.params,
      ).filter((iv) => iv.endTime > window.start && iv.startTime < window.end);
      this.coTravel.set(key, spliceIntervals(kept, fresh));
      recomputedPairKeys.push(key);
    }

    return this.record(
      `correctPoint:${targetId}/${pointId}`,
      [targetId],
      window,
      newSegs.map((s) => s.id),
      recomputedPairKeys,
    );
  }

  setParams(next: Partial<InferenceParams>): RecomputeReport {
    this.params = { ...this.params, ...next };
    const recomputedSegmentIds: string[] = [];
    for (const [targetId, list] of this.pointsByTarget) {
      const oldSegs = this.segments.get(targetId) ?? [];
      const result = segmentTarget(targetId, list, this.params);
      const reconciled = result.segments.map((fresh) => {
        const match = oldSegs.find((old) => segmentsEqual(old, fresh));
        if (match) return match;
        recomputedSegmentIds.push(fresh.id);
        return fresh;
      });
      this.segments.set(targetId, reconciled);
      this.anomalies.set(targetId, result.anomalies);
    }
    const recomputedPairKeys: string[] = [];
    const targetIds = [...this.pointsByTarget.keys()];
    for (let i = 0; i < targetIds.length; i += 1) {
      for (let j = i + 1; j < targetIds.length; j += 1) {
        const key = pairKeyOf(targetIds[i], targetIds[j]);
        const oldIntervals = this.coTravel.get(key) ?? [];
        const fresh = detectCoTravelForPair(
          targetIds[i],
          this.segments.get(targetIds[i]) ?? [],
          targetIds[j],
          this.segments.get(targetIds[j]) ?? [],
          this.params,
        );
        const reconciled = fresh.map((iv) => oldIntervals.find((old) => intervalsEqual(old, iv)) ?? iv);
        const changed =
          reconciled.length !== oldIntervals.length ||
          reconciled.some((iv, k) => iv !== oldIntervals[k]);
        if (changed) recomputedPairKeys.push(key);
        this.coTravel.set(key, reconciled);
      }
    }
    return this.record(
      'setParams',
      targetIds,
      null,
      recomputedSegmentIds,
      recomputedPairKeys,
    );
  }

  getSegments(targetId: string): readonly Segment[] {
    return this.segments.get(targetId) ?? [];
  }

  getCoTravelIntervals(targetA: string, targetB: string): readonly CoTravelInterval[] {
    return this.coTravel.get(pairKeyOf(targetA, targetB)) ?? [];
  }

  getAnomalies(targetId: string): readonly Anomaly[] {
    return this.anomalies.get(targetId) ?? [];
  }

  getParams(): InferenceParams {
    return { ...this.params };
  }

  getState(): EngineState {
    const segmentsByTarget: Record<string, Segment[]> = {};
    for (const [k, v] of [...this.segments.entries()].sort()) {
      segmentsByTarget[k] = v.map((s) => ({ ...s, pointIds: [...s.pointIds] }));
    }
    const coTravelByPair: Record<string, CoTravelInterval[]> = {};
    for (const [k, v] of [...this.coTravel.entries()].sort()) {
      coTravelByPair[k] = v.map((iv) => ({ ...iv }));
    }
    const anomaliesByTarget: Record<string, Anomaly[]> = {};
    for (const [k, v] of [...this.anomalies.entries()].sort()) {
      anomaliesByTarget[k] = v.map((a) => ({ ...a }));
    }
    return { params: this.getParams(), segmentsByTarget, coTravelByPair, anomaliesByTarget };
  }

  private recomputeAllPairs(): string[] {
    const keys: string[] = [];
    const targetIds = [...this.pointsByTarget.keys()];
    for (let i = 0; i < targetIds.length; i += 1) {
      for (let j = i + 1; j < targetIds.length; j += 1) {
        const key = pairKeyOf(targetIds[i], targetIds[j]);
        this.coTravel.set(
          key,
          detectCoTravelForPair(
            targetIds[i],
            this.segments.get(targetIds[i]) ?? [],
            targetIds[j],
            this.segments.get(targetIds[j]) ?? [],
            this.params,
          ),
        );
        keys.push(key);
      }
    }
    return keys;
  }

  private record(
    reason: string,
    targetIds: string[],
    window: RecomputeWindow | null,
    recomputedSegmentIds: string[],
    recomputedPairKeys: string[],
  ): RecomputeReport {
    this.seq += 1;
    const report: RecomputeReport = {
      seq: this.seq,
      reason,
      targetIds,
      window,
      recomputedSegmentIds,
      recomputedPairKeys,
    };
    this.recomputeLog.push(report);
    return report;
  }
}

function spliceIntervals(
  kept: CoTravelInterval[],
  fresh: CoTravelInterval[],
): CoTravelInterval[] {
  const all = [...kept, ...fresh].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
  );
  const merged: CoTravelInterval[] = [];
  for (const iv of all) {
    const last = merged[merged.length - 1];
    if (last && iv.startTime <= last.endTime) {
      merged[merged.length - 1] = { ...last, endTime: Math.max(last.endTime, iv.endTime) };
    } else {
      merged.push(iv);
    }
  }
  return merged;
}
