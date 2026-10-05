import { analyze, type Analysis, type AnchorPoint } from './analyze';
import { deriveSegment } from './derive';
import type {
  Adjudication,
  Anchor,
  DerivationInput,
  DerivationState,
  MediaInfo,
  SegmentConclusion,
  SubtitleSegment,
} from './types';

/** 支持增量应用的变更类型 */
export type Change =
  | { type: 'media'; media: MediaInfo }
  | { type: 'anchor-upsert'; anchor: Anchor }
  | { type: 'anchor-remove'; anchorId: string }
  | { type: 'segment-upsert'; segment: SubtitleSegment }
  | { type: 'segment-remove'; segmentId: string }
  | { type: 'adjudicate'; adjudication: Adjudication };

export interface IncrementalResult {
  state: DerivationState;
  /** 本次实际重推的片段 id（按排序后顺序） */
  affectedIds: string[];
  input: DerivationInput;
}

export function inputOf(state: DerivationState): DerivationInput {
  return {
    media: { ...state.media },
    segments: state.segments.map((seg) => ({ ...seg })),
    anchors: state.anchors.map((anchor) => ({ ...anchor })),
    adjudications: state.adjudications.map((adj) => ({ ...adj })),
  };
}

export function applyChangeToInput(input: DerivationInput, change: Change): DerivationInput {
  const next: DerivationInput = {
    media: { ...input.media },
    segments: input.segments.map((seg) => ({ ...seg })),
    anchors: input.anchors.map((anchor) => ({ ...anchor })),
    adjudications: input.adjudications.map((adj) => ({ ...adj })),
  };
  switch (change.type) {
    case 'media':
      next.media = { ...change.media };
      break;
    case 'anchor-upsert': {
      const idx = next.anchors.findIndex((anchor) => anchor.id === change.anchor.id);
      if (idx >= 0) next.anchors[idx] = { ...change.anchor };
      else next.anchors.push({ ...change.anchor });
      break;
    }
    case 'anchor-remove':
      next.anchors = next.anchors.filter((anchor) => anchor.id !== change.anchorId);
      break;
    case 'segment-upsert': {
      const idx = next.segments.findIndex((seg) => seg.id === change.segment.id);
      if (idx >= 0) next.segments[idx] = { ...change.segment };
      else next.segments.push({ ...change.segment });
      break;
    }
    case 'segment-remove':
      next.segments = next.segments.filter((seg) => seg.id !== change.segmentId);
      break;
    case 'adjudicate': {
      const idx = next.adjudications.findIndex((adj) => adj.conflictKey === change.adjudication.conflictKey);
      if (idx >= 0) next.adjudications[idx] = { ...change.adjudication };
      else next.adjudications.push({ ...change.adjudication });
      break;
    }
  }
  return next;
}

function pointsByAnchorId(points: AnchorPoint[]): Map<string, AnchorPoint> {
  return new Map(points.map((point) => [point.anchorId, point]));
}

/**
 * 受扰动锚点（位于 points 中下标 k）影响的片段时间区间。
 * 边界片段的漂移趋势依赖最近两个锚点，因此区间需向外多扩一位。
 */
function disturbedInterval(points: AnchorPoint[], k: number): [number, number] {
  const n = points.length;
  const lo = k <= 1 ? -Infinity : points[k - 1].time;
  const hi = k >= n - 2 ? Infinity : points[k + 1].time;
  return [lo, hi];
}

function markInterval(affected: Set<string>, analysis: Analysis, lo: number, hi: number): void {
  for (const seg of analysis.sortedSegments) {
    if (seg.startMs >= lo && seg.startMs <= hi) affected.add(seg.id);
  }
}

function markNeighbors(affected: Set<string>, analysis: Analysis, segmentId: string): void {
  const idx = analysis.orderIndex.get(segmentId);
  if (idx === undefined) return;
  affected.add(segmentId);
  if (idx > 0) affected.add(analysis.sortedSegments[idx - 1].id);
  if (idx < analysis.sortedSegments.length - 1) affected.add(analysis.sortedSegments[idx + 1].id);
}

/**
 * 计算变更后需要重推的片段集合。
 * 依据：结论只受「包围它的锚点区间」「排序邻居」「自身状态」影响，
 * 因此锚点扰动只需重推其前后锚点之间的片段，片段/裁决变更只需重推自身与邻居。
 */
function computeAffected(
  prevInput: DerivationInput,
  nextInput: DerivationInput,
  prevAnalysis: Analysis,
  nextAnalysis: Analysis,
  change: Change,
): Set<string> | 'all' {
  if (change.type === 'media') {
    // 帧率影响所有片段的帧偏移换算；时长不影响任何已推导结论
    return change.media.frameRate !== prevInput.media.frameRate ? 'all' : new Set();
  }

  const affected = new Set<string>();

  // 1) 锚点点位扰动：新增/删除/移动/偏移变化的锚点，影响其前后锚点区间
  const prevPoints = pointsByAnchorId(prevAnalysis.anchorPoints);
  const nextPoints = pointsByAnchorId(nextAnalysis.anchorPoints);
  const anchorIds = new Set([...prevPoints.keys(), ...nextPoints.keys()]);
  for (const anchorId of anchorIds) {
    const before = prevPoints.get(anchorId);
    const after = nextPoints.get(anchorId);
    const disturbed =
      !before || !after || before.time !== after.time || before.offset !== after.offset;
    if (!disturbed) continue;
    for (const points of [prevAnalysis.anchorPoints, nextAnalysis.anchorPoints]) {
      const k = points.findIndex((point) => point.anchorId === anchorId);
      if (k < 0) continue;
      const [lo, hi] = disturbedInterval(points, k);
      markInterval(affected, nextAnalysis, lo, hi);
    }
  }

  // 2) 片段自身与排序邻居
  if (change.type === 'segment-upsert' || change.type === 'segment-remove') {
    const id = change.type === 'segment-upsert' ? change.segment.id : change.segmentId;
    markNeighbors(affected, nextAnalysis, id);
    markNeighbors(affected, prevAnalysis, id);
  }
  if (change.type === 'adjudicate') {
    const conflict = nextAnalysis.conflicts.find((c) => c.key === change.adjudication.conflictKey)
      ?? prevAnalysis.conflicts.find((c) => c.key === change.adjudication.conflictKey);
    for (const segmentId of conflict?.segmentIds ?? [change.adjudication.winnerSegmentId]) {
      markNeighbors(affected, nextAnalysis, segmentId);
      markNeighbors(affected, prevAnalysis, segmentId);
    }
  }

  // 3) 状态（active/pending/excluded）发生变化的片段
  const allIds = new Set([...prevAnalysis.activeIds, ...nextAnalysis.activeIds]);
  for (const id of allIds) {
    if (prevAnalysis.activeIds.has(id) !== nextAnalysis.activeIds.has(id)) {
      affected.add(id);
    }
  }
  const pendingAll = new Set([
    ...prevAnalysis.pendingConflictBySegment.keys(),
    ...nextAnalysis.pendingConflictBySegment.keys(),
  ]);
  for (const id of pendingAll) {
    if (prevAnalysis.pendingConflictBySegment.has(id) !== nextAnalysis.pendingConflictBySegment.has(id)) {
      affected.add(id);
    }
  }

  return affected;
}

/**
 * 增量重推：只对受影响片段重新推导，其余片段沿用缓存结论。
 * 结论由与整体重推完全相同的纯函数生成，保证逐条一致。
 */
export function applyChange(prev: DerivationState, change: Change): IncrementalResult {
  const prevInput = inputOf(prev);
  const nextInput = applyChangeToInput(prevInput, change);
  const prevAnalysis = analyze(prevInput.segments, prevInput.anchors, prevInput.adjudications);
  const nextAnalysis = analyze(nextInput.segments, nextInput.anchors, nextInput.adjudications);

  const affected = computeAffected(prevInput, nextInput, prevAnalysis, nextAnalysis, change);

  const prevConclusionById = new Map<string, SegmentConclusion>();
  prev.conclusions.forEach((conclusion) => prevConclusionById.set(conclusion.segmentId, conclusion));

  const affectedIds: string[] = [];
  const conclusions = nextAnalysis.sortedSegments.map((seg, idx) => {
    const cached = prevConclusionById.get(seg.id);
    if (affected !== 'all' && cached && !affected.has(seg.id)) {
      return cached;
    }
    affectedIds.push(seg.id);
    return deriveSegment(seg, idx, nextAnalysis, nextInput.media);
  });

  return {
    state: {
      media: { ...nextInput.media },
      segments: nextInput.segments,
      anchors: nextInput.anchors,
      adjudications: nextInput.adjudications,
      sortedIds: nextAnalysis.sortedSegments.map((seg) => seg.id),
      conflicts: nextAnalysis.conflicts,
      anomalies: nextAnalysis.anomalies,
      conclusions,
    },
    affectedIds,
    input: nextInput,
  };
}
