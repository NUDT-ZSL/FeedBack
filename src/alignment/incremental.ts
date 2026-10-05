// 增量重推：在已有结论上，只重推受影响的片段区间与漂移区间，
// 未受影响的结论对象直接复用（保持引用相等），且最终结果与整段重推逐字段一致。

import {
  buildIntervals,
  computeAlignment,
  deriveConclusion,
  detectConflicts,
  detectIssues,
  offsetAt,
  sortAnchors,
  sortSegments,
} from './engine';
import type {
  Adjudication,
  AffectedRange,
  AlignmentInputs,
  AlignmentResult,
  Anchor,
  ConflictGroup,
  DriftInterval,
  Issue,
  SegmentConclusion,
} from './types';

export type ChangeSpec =
  | { type: 'anchor'; anchorId: string }
  | { type: 'segment'; segmentId: string }
  | { type: 'adjudication'; conflictId: string }
  | { type: 'frame-rate' }
  | { type: 'full'; reason: string };

export interface IncrementalState {
  inputs: AlignmentInputs;
  result: AlignmentResult;
}

export interface IncrementalOutput {
  result: AlignmentResult;
  affected: AffectedRange;
}

interface DeriveCtx {
  conflictBySegment: Map<string, ConflictGroup>;
  adjudicationById: Map<string, Adjudication>;
  issueIdsBySegment: Map<string, string[]>;
}

function buildDeriveCtx(inputs: AlignmentInputs, issues: Issue[], conflicts: ConflictGroup[]): DeriveCtx {
  const issueIdsBySegment = new Map<string, string[]>();
  for (const issue of issues) {
    for (const sid of issue.segmentIds ?? []) {
      if (!issueIdsBySegment.has(sid)) issueIdsBySegment.set(sid, []);
      issueIdsBySegment.get(sid)!.push(issue.id);
    }
  }
  const conflictBySegment = new Map<string, ConflictGroup>();
  for (const c of conflicts) {
    for (const sid of c.segmentIds) conflictBySegment.set(sid, c);
  }
  return {
    conflictBySegment,
    adjudicationById: new Map(inputs.adjudications.map((a) => [a.id, a])),
    issueIdsBySegment,
  };
}

/** 在一版锚点序列中，找到 anchorId 所在位置（或按时间的插入位置）两侧的护栏时刻 */
function guardRange(anchors: Anchor[], anchorId: string, fallbackTime?: number): [number, number] {
  const idx = anchors.findIndex((a) => a.id === anchorId);
  if (idx >= 0) {
    const left = idx > 0 ? anchors[idx - 1].subtitleTimeSec : -Infinity;
    const right = idx < anchors.length - 1 ? anchors[idx + 1].subtitleTimeSec : Infinity;
    return [left, right];
  }
  const t = fallbackTime ?? 0;
  let pos = 0;
  while (pos < anchors.length && anchors[pos].subtitleTimeSec < t) pos++;
  const left = pos > 0 ? anchors[pos - 1].subtitleTimeSec : -Infinity;
  const right = pos < anchors.length ? anchors[pos].subtitleTimeSec : Infinity;
  return [left, right];
}

function intervalsCovering(intervals: DriftInterval[], left: number, right: number): Set<string> {
  const ids = new Set<string>();
  for (const iv of intervals) {
    if (iv.toSec >= left && iv.fromSec <= right) ids.add(iv.id);
  }
  return ids;
}

/** 锚点增删改：只重推护栏时刻范围内的片段与区间 */
function rederiveAnchorChange(
  prev: IncrementalState,
  next: AlignmentInputs,
  anchorId: string,
): IncrementalOutput {
  const prevAnchors = sortAnchors(prev.inputs.anchors);
  const nextAnchors = sortAnchors(next.anchors);
  const oldAnchor = prev.inputs.anchors.find((a) => a.id === anchorId);
  const newAnchor = next.anchors.find((a) => a.id === anchorId);
  const fallbackTime = oldAnchor?.subtitleTimeSec ?? newAnchor?.subtitleTimeSec;

  const [prevLeft, prevRight] = guardRange(prevAnchors, anchorId, fallbackTime);
  const [nextLeft, nextRight] = guardRange(nextAnchors, anchorId, fallbackTime);

  const rebuiltIntervals = buildIntervals(next.anchors, next.media.frameRate);
  const affectedIntervalIds = new Set<string>([
    ...intervalsCovering(prev.result.intervals, prevLeft, prevRight),
    ...intervalsCovering(rebuiltIntervals, nextLeft, nextRight),
  ]);
  // 区间 id 由锚点构成，未受影响的区间直接复用旧对象（引用相等）
  const prevIntervalById = new Map(prev.result.intervals.map((iv) => [iv.id, iv]));
  const nextIntervals: DriftInterval[] = rebuiltIntervals.map((iv) =>
    affectedIntervalIds.has(iv.id) ? iv : prevIntervalById.get(iv.id) ?? iv,
  );

  // 问题只与锚点的越界/指向缺失及片段有关：锚点问题不进入片段结论，直接整体重检（开销低）
  const issues = detectIssues(next);
  const conflicts = prev.result.conflicts; // 片段与裁决未变，矛盾组不变
  const ctx = buildDeriveCtx(next, issues, conflicts);

  const sortedSegments = sortSegments(next.segments);
  const prevBySegmentId = new Map(prev.result.conclusions.map((c) => [c.segmentId, c]));
  const affectedSegmentIds: string[] = [];
  const conclusions: SegmentConclusion[] = [];

  for (let orderIndex = 0; orderIndex < sortedSegments.length; orderIndex++) {
    const seg = sortedSegments[orderIndex];
    const mid = (seg.startSec + seg.endSec) / 2;
    const inPrevGuard = mid > prevLeft - 1e-9 && mid < prevRight + 1e-9;
    const inNextGuard = mid > nextLeft - 1e-9 && mid < nextRight + 1e-9;
    const touched = inPrevGuard || inNextGuard;
    const cached = prevBySegmentId.get(seg.id);
    if (!touched && cached) {
      conclusions.push(cached);
      continue;
    }
    affectedSegmentIds.push(seg.id);
    conclusions.push(
      deriveConclusion(seg, orderIndex, nextAnchors, nextIntervals, next.media.frameRate, {
        conflict: ctx.conflictBySegment.get(seg.id),
        adjudicationById: ctx.adjudicationById,
        issueIdsBySegment: ctx.issueIdsBySegment,
      }),
    );
  }

  return {
    result: {
      issues,
      conflicts,
      intervals: nextIntervals,
      conclusions,
      frameRate: next.media.frameRate,
    },
    affected: {
      conclusionSegmentIds: affectedSegmentIds,
      intervalIds: [...affectedIntervalIds],
      frameProjectionOnly: false,
      fullRebuild: false,
      reason: `锚点 ${anchorId} 变更：重推相邻护栏区间内的片段`,
    },
  };
}

/** 片段增删改：受影响的是该片段所在矛盾组全体，以及排序序号变化的片段 */
function rederiveSegmentChange(
  prev: IncrementalState,
  next: AlignmentInputs,
  segmentId: string,
): IncrementalOutput {
  const nextAnchors = sortAnchors(next.anchors);
  // 锚点与帧率未变，漂移区间完全复用
  const intervals = prev.result.intervals;
  const issues = detectIssues(next);
  const conflicts = detectConflicts(next.segments, next.adjudications);
  const ctx = buildDeriveCtx(next, issues, conflicts);

  const sortedSegments = sortSegments(next.segments);
  const prevBySegmentId = new Map(prev.result.conclusions.map((c) => [c.segmentId, c]));

  const nextConflictMembers = new Set<string>([segmentId]);
  for (const c of conflicts) {
    if (c.segmentIds.includes(segmentId)) c.segmentIds.forEach((sid) => nextConflictMembers.add(sid));
  }
  for (const c of prev.result.conflicts) {
    if (c.segmentIds.includes(segmentId)) c.segmentIds.forEach((sid) => nextConflictMembers.add(sid));
  }

  const affectedSegmentIds: string[] = [];
  const conclusions: SegmentConclusion[] = [];
  for (let orderIndex = 0; orderIndex < sortedSegments.length; orderIndex++) {
    const seg = sortedSegments[orderIndex];
    const cached = prevBySegmentId.get(seg.id);
    const orderChanged = cached ? cached.orderIndex !== orderIndex : true;
    const conflictTouched = nextConflictMembers.has(seg.id);
    if (cached && !orderChanged && !conflictTouched) {
      conclusions.push(cached);
      continue;
    }
    affectedSegmentIds.push(seg.id);
    conclusions.push(
      deriveConclusion(seg, orderIndex, nextAnchors, intervals, next.media.frameRate, {
        conflict: ctx.conflictBySegment.get(seg.id),
        adjudicationById: ctx.adjudicationById,
        issueIdsBySegment: ctx.issueIdsBySegment,
      }),
    );
  }

  return {
    result: {
      issues,
      conflicts,
      intervals,
      conclusions,
      frameRate: next.media.frameRate,
    },
    affected: {
      conclusionSegmentIds: affectedSegmentIds,
      intervalIds: [],
      frameProjectionOnly: false,
      fullRebuild: false,
      reason: `片段 ${segmentId} 增删改：重推矛盾组成员与排序变化的片段`,
    },
  };
}

/** 裁决：片段与锚点均未变，仅重推该矛盾组的成员片段 */
function rederiveAdjudication(
  prev: IncrementalState,
  next: AlignmentInputs,
  conflictId: string,
): IncrementalOutput {
  const nextAnchors = sortAnchors(next.anchors);
  const intervals = prev.result.intervals;
  const issues = prev.result.issues; // 裁决不产生/消除数据问题
  const conflicts = detectConflicts(next.segments, next.adjudications);
  const ctx = buildDeriveCtx(next, issues, conflicts);

  const members = new Set<string>();
  for (const c of prev.result.conflicts) {
    if (c.id === conflictId) c.segmentIds.forEach((sid) => members.add(sid));
  }
  for (const c of conflicts) {
    if (c.id === conflictId) c.segmentIds.forEach((sid) => members.add(sid));
  }

  const sortedSegments = sortSegments(next.segments);
  const prevBySegmentId = new Map(prev.result.conclusions.map((c) => [c.segmentId, c]));
  const conclusions: SegmentConclusion[] = [];
  for (let orderIndex = 0; orderIndex < sortedSegments.length; orderIndex++) {
    const seg = sortedSegments[orderIndex];
    const cached = prevBySegmentId.get(seg.id);
    if (cached && !members.has(seg.id)) {
      conclusions.push(cached);
      continue;
    }
    conclusions.push(
      deriveConclusion(seg, orderIndex, nextAnchors, intervals, next.media.frameRate, {
        conflict: ctx.conflictBySegment.get(seg.id),
        adjudicationById: ctx.adjudicationById,
        issueIdsBySegment: ctx.issueIdsBySegment,
      }),
    );
  }

  return {
    result: {
      issues,
      conflicts,
      intervals,
      conclusions,
      frameRate: next.media.frameRate,
    },
    affected: {
      conclusionSegmentIds: [...members],
      intervalIds: [],
      frameProjectionOnly: false,
      fullRebuild: false,
      reason: `矛盾组 ${conflictId} 裁决：仅重推组成员片段`,
    },
  };
}

/** 帧率调整：偏移（秒）推导不变，只重投影帧字段；未变化的对象原样复用 */
function reprojectFrameRate(prev: IncrementalState, next: AlignmentInputs): IncrementalOutput {
  const fps = next.media.frameRate;
  const affectedSegmentIds: string[] = [];
  const conclusions: SegmentConclusion[] = [];
  for (const c of prev.result.conclusions) {
    const nextFrames = Math.round(c.offsetSec * fps);
    if (nextFrames === c.offsetFrames) {
      conclusions.push(c);
      continue;
    }
    affectedSegmentIds.push(c.segmentId);
    conclusions.push({ ...c, offsetFrames: nextFrames });
  }

  const affectedIntervalIds = new Set<string>();
  const intervals = prev.result.intervals.map((iv) => {
    const nextFramesPer1000 = iv.driftRateSecPerSec * fps * 1000;
    if (nextFramesPer1000 === iv.driftFramesPer1000) return iv;
    affectedIntervalIds.add(iv.id);
    return { ...iv, driftFramesPer1000: nextFramesPer1000 };
  });

  return {
    result: {
      issues: prev.result.issues,
      conflicts: prev.result.conflicts,
      intervals,
      conclusions,
      frameRate: fps,
    },
    affected: {
      conclusionSegmentIds: affectedSegmentIds,
      intervalIds: [...affectedIntervalIds],
      frameProjectionOnly: true,
      fullRebuild: false,
      reason: `帧率调整为 ${fps}fps：只重投影帧字段，偏移与漂移趋势推导不变`,
    },
  };
}

/**
 * 增量重推入口。
 * 约定：prev 是此前的输入与结果，next 是变更后的输入，change 描述变更点。
 */
export function recomputeAlignment(
  prev: IncrementalState | null,
  next: AlignmentInputs,
  change: ChangeSpec,
): IncrementalOutput {
  if (!prev) {
    return {
      result: computeAlignment(next),
      affected: {
        conclusionSegmentIds: next.segments.map((s) => s.id),
        intervalIds: [],
        frameProjectionOnly: false,
        fullRebuild: true,
        reason: '首次推导，整体重推',
      },
    };
  }
  switch (change.type) {
    case 'anchor':
      return rederiveAnchorChange(prev, next, change.anchorId);
    case 'segment':
      return rederiveSegmentChange(prev, next, change.segmentId);
    case 'adjudication':
      return rederiveAdjudication(prev, next, change.conflictId);
    case 'frame-rate':
      if (prev.inputs.media.frameRate === next.media.frameRate) {
        return { result: prev.result, affected: emptyAffected('帧率未变化，跳过重推') };
      }
      return reprojectFrameRate(prev, next);
    case 'full':
      return {
        result: computeAlignment(next),
        affected: {
          conclusionSegmentIds: next.segments.map((s) => s.id),
          intervalIds: next.anchors.map((a) => a.id),
          frameProjectionOnly: false,
          fullRebuild: true,
          reason: change.reason,
        },
      };
  }
}

function emptyAffected(reason: string): AffectedRange {
  return {
    conclusionSegmentIds: [],
    intervalIds: [],
    frameProjectionOnly: false,
    fullRebuild: false,
    reason,
  };
}

// 供测试/工具使用的纯函数再导出
export { computeAlignment, offsetAt, sortAnchors, sortSegments };
