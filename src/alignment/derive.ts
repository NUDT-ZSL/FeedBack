import { analyze, type Analysis, type AnchorPoint } from './analyze';
import type {
  DerivationInput,
  DerivationState,
  DriftTrend,
  MediaInfo,
  SegmentConclusion,
  SubtitleSegment,
} from './types';

/** 漂移速率低于该阈值（毫秒/秒）视为稳定 */
export const DRIFT_STABLE_THRESHOLD_MS_PER_SEC = 1;

function classifyTrend(slopeMsPerSec: number | null): DriftTrend {
  if (slopeMsPerSec === null) return 'unknown';
  if (Math.abs(slopeMsPerSec) <= DRIFT_STABLE_THRESHOLD_MS_PER_SEC) return 'stable';
  return slopeMsPerSec > 0 ? 'drifting-later' : 'drifting-earlier';
}

function slopeBetween(a: AnchorPoint, b: AnchorPoint): number {
  return (b.offset - a.offset) / ((b.time - a.time) / 1000);
}

interface Interpolation {
  offsetMs: number;
  slopeMsPerSec: number | null;
  anchorIds: string[];
}

/** 在锚点点位上按片段起始时刻做分段线性插值，区间外取最近锚点的偏移 */
export function interpolate(points: AnchorPoint[], time: number): Interpolation {
  if (points.length === 0) {
    return { offsetMs: 0, slopeMsPerSec: null, anchorIds: [] };
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (time <= first.time) {
    const slope = points.length > 1 ? slopeBetween(points[0], points[1]) : null;
    return {
      offsetMs: first.offset,
      slopeMsPerSec: slope,
      anchorIds: points.length > 1 ? [points[0].anchorId, points[1].anchorId] : [first.anchorId],
    };
  }
  if (time >= last.time) {
    const slope = points.length > 1
      ? slopeBetween(points[points.length - 2], points[points.length - 1])
      : null;
    return {
      offsetMs: last.offset,
      slopeMsPerSec: slope,
      anchorIds: points.length > 1
        ? [points[points.length - 2].anchorId, points[points.length - 1].anchorId]
        : [last.anchorId],
    };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const ratio = (time - a.time) / (b.time - a.time);
  return {
    offsetMs: a.offset + (b.offset - a.offset) * ratio,
    slopeMsPerSec: slopeBetween(a, b),
    anchorIds: [a.anchorId, b.anchorId],
  };
}

/** 推导单个片段的对齐结论（全量与增量共用同一纯函数，保证结果一致） */
export function deriveSegment(
  seg: SubtitleSegment,
  index: number,
  analysis: Analysis,
  media: MediaInfo,
): SegmentConclusion {
  const prevSegmentId = index > 0 ? analysis.sortedSegments[index - 1].id : null;
  const nextSegmentId = index < analysis.sortedSegments.length - 1
    ? analysis.sortedSegments[index + 1].id
    : null;
  const adjudicationIds = analysis.adjudicationIdsBySegment.get(seg.id) ?? [];

  if (analysis.pendingConflictBySegment.has(seg.id)) {
    return {
      segmentId: seg.id,
      status: 'pending-adjudication',
      offsetMs: null,
      offsetFrames: null,
      driftSlopeMsPerSec: null,
      driftTrend: 'unknown',
      basis: { anchorIds: [], prevSegmentId, nextSegmentId, adjudicationIds },
    };
  }
  if (!analysis.activeIds.has(seg.id)) {
    return {
      segmentId: seg.id,
      status: 'excluded',
      offsetMs: null,
      offsetFrames: null,
      driftSlopeMsPerSec: null,
      driftTrend: 'unknown',
      basis: { anchorIds: [], prevSegmentId, nextSegmentId, adjudicationIds },
    };
  }

  const { offsetMs, slopeMsPerSec, anchorIds } = interpolate(analysis.anchorPoints, seg.startMs);
  return {
    segmentId: seg.id,
    status: 'derived',
    offsetMs,
    offsetFrames: Math.round((offsetMs * media.frameRate) / 1000),
    driftSlopeMsPerSec: slopeMsPerSec,
    driftTrend: classifyTrend(slopeMsPerSec),
    basis: { anchorIds, prevSegmentId, nextSegmentId, adjudicationIds },
  };
}

/** 整体重推：从原始输入完整推导所有结论 */
export function deriveFull(input: DerivationInput): DerivationState {
  const analysis = analyze(input.segments, input.anchors, input.adjudications);
  const conclusions = analysis.sortedSegments.map((seg, idx) =>
    deriveSegment(seg, idx, analysis, input.media),
  );
  return {
    media: { ...input.media },
    segments: input.segments.map((seg) => ({ ...seg })),
    anchors: input.anchors.map((anchor) => ({ ...anchor })),
    adjudications: input.adjudications.map((adj) => ({ ...adj })),
    sortedIds: analysis.sortedSegments.map((seg) => seg.id),
    conflicts: analysis.conflicts,
    anomalies: analysis.anomalies,
    conclusions,
  };
}
