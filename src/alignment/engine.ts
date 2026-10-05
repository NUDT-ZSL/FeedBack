// 对齐推演引擎：整段重推（computeAlignment）与增量重推（recomputeAlignment）
//
// 推导模型：
// - 锚点给出“字幕时刻 - 媒体时刻”的偏移样本，按字幕时刻排序后分段线性插值；
// - 每个片段用区间中点在偏移曲线上取值，得到该片段的偏移与对齐到媒体轴的位置；
// - 相邻锚点之间构成漂移区间，漂移速率 = 偏移差 / 字幕时间差；
// - 首锚点之前 / 末锚点之后为外推区间，偏移取最近锚点的值，漂移速率记 0。
//
// 冲突与问题：
// - 倒序、越界、重叠、锚点指向缺失都只标记为 Issue，绝不静默丢弃或择一；
// - 同一时刻来自不同来源的矛盾片段组成 ConflictGroup，双方全部保留，
//   状态为待裁决；裁决后驳回方保留在结果中（rejected=true）但不参与漂移统计。

import type {
  Adjudication,
  AlignmentInputs,
  AlignmentResult,
  Anchor,
  ConflictGroup,
  DriftInterval,
  DriftTrend,
  Issue,
  SegmentConclusion,
  SubtitleSegment,
} from './types';

const EPS = 1e-9;
/** 漂移速率小于该值视为稳定 */
const STABLE_DRIFT_EPS = 1e-4;

export function conflictIdFor(segmentIds: string[]): string {
  return 'conflict:' + [...segmentIds].sort().join('|');
}

function issueId(kind: string, key: string): string {
  return `issue:${kind}:${key}`;
}

/** 按字幕时间轴排序片段（稳定：起点、终点、id） */
export function sortSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return [...segments].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec || a.id.localeCompare(b.id));
}

/** 按字幕时刻排序锚点（稳定：字幕时刻、媒体时刻、id） */
export function sortAnchors(anchors: Anchor[]): Anchor[] {
  return [...anchors].sort(
    (a, b) => a.subtitleTimeSec - b.subtitleTimeSec || a.mediaTimeSec - b.mediaTimeSec || a.id.localeCompare(b.id),
  );
}

/** 检测数据问题：倒序 / 越界 / 重叠 / 锚点指向缺失。全部保留，仅标记。 */
export function detectIssues(inputs: AlignmentInputs): Issue[] {
  const issues: Issue[] = [];
  const { media, anchors, segments } = inputs;
  const segmentIds = new Set(segments.map((s) => s.id));

  for (const seg of segments) {
    if (seg.endSec < seg.startSec) {
      issues.push({
        id: issueId('reversed-time', seg.id),
        kind: 'reversed-time',
        message: `片段「${seg.text || seg.id}」时刻倒序：${seg.startSec}s > ${seg.endSec}s`,
        segmentIds: [seg.id],
      });
    }
    if (seg.startSec < 0 || Math.max(seg.startSec, seg.endSec) > media.durationSec) {
      issues.push({
        id: issueId('out-of-media', seg.id),
        kind: 'out-of-media',
        message: `片段「${seg.text || seg.id}」超出媒体总时长 ${media.durationSec}s`,
        segmentIds: [seg.id],
      });
    }
  }

  const sorted = sortSegments(segments);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.startSec >= a.endSec - EPS) break;
      issues.push({
        id: issueId('overlap', [a.id, b.id].sort().join('|')),
        kind: 'overlap',
        message: `片段「${a.text || a.id}」与「${b.text || b.id}」区间重叠`,
        segmentIds: [a.id, b.id],
      });
    }
  }

  for (const anchor of anchors) {
    if (anchor.segmentId && !segmentIds.has(anchor.segmentId)) {
      issues.push({
        id: issueId('dangling-anchor', anchor.id),
        kind: 'dangling-anchor',
        message: `锚点 ${anchor.id} 指向缺失的片段 ${anchor.segmentId}`,
        anchorId: anchor.id,
      });
    }
    if (anchor.mediaTimeSec < 0 || anchor.mediaTimeSec > media.durationSec) {
      issues.push({
        id: issueId('anchor-out-of-media', anchor.id),
        kind: 'out-of-media',
        message: `锚点 ${anchor.id} 的媒体时刻超出媒体总时长`,
        anchorId: anchor.id,
      });
    }
  }

  return issues.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 检测矛盾组：同一时刻（区间重叠）且来源不同、文本不同的片段。
 * 所有成员全部保留；是否已有裁决取决于 adjudications 记录。
 */
export function detectConflicts(
  segments: SubtitleSegment[],
  adjudications: Adjudication[],
): ConflictGroup[] {
  const sorted = sortSegments(segments);
  const n = sorted.length;
  const parent = sorted.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.startSec >= a.endSec - EPS) break;
      if (a.source !== b.source && a.text !== b.text) union(i, j);
    }
  }

  const groups = new Map<number, SubtitleSegment[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(sorted[i]);
  }

  const latestByConflict = new Map<string, Adjudication>();
  for (const adj of adjudications) {
    const prev = latestByConflict.get(adj.conflictId);
    if (!prev || adj.seq > prev.seq) latestByConflict.set(adj.conflictId, adj);
  }

  const result: ConflictGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ids = members.map((m) => m.id).sort();
    const id = conflictIdFor(ids);
    const sources = [...new Set(members.map((m) => m.source))].join(' / ');
    const adj = latestByConflict.get(id) ?? null;
    const memberSet = new Set(ids);
    const rejected = adj ? adj.rejectedSegmentIds.filter((rid) => memberSet.has(rid)) : [];
    result.push({
      id,
      segmentIds: ids,
      chosenSegmentId: adj && memberSet.has(adj.chosenSegmentId) ? adj.chosenSegmentId : null,
      rejectedSegmentIds: rejected,
      adjudicationId: adj ? adj.id : null,
      reason: `同一时刻存在 ${members.length} 条来源矛盾（${sources}）的片段`,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** 构建漂移区间（含首尾外推区间） */
export function buildIntervals(anchors: Anchor[], frameRate: number): DriftInterval[] {
  const sorted = sortAnchors(anchors);
  const intervals: DriftInterval[] = [];
  const offsetOf = (a: Anchor) => a.subtitleTimeSec - a.mediaTimeSec;

  const trendOf = (rate: number, extrapolated: boolean): DriftTrend => {
    if (extrapolated) return 'extrapolated';
    if (rate > STABLE_DRIFT_EPS) return 'ahead';
    if (rate < -STABLE_DRIFT_EPS) return 'behind';
    return 'stable';
  };

  const makeInterval = (
    id: string,
    fromSec: number,
    toSec: number,
    anchorIds: string[],
    rate: number,
    extrapolated: boolean,
  ): DriftInterval => ({
    id,
    fromSec,
    toSec,
    anchorIds,
    driftRateSecPerSec: rate,
    driftFramesPer1000: rate * frameRate * 1000,
    trend: trendOf(rate, extrapolated),
    extrapolated,
  });

  if (sorted.length === 0) {
    intervals.push(makeInterval('interval:none', -Infinity, Infinity, [], 0, true));
    return intervals;
  }

  intervals.push(makeInterval(`interval:before:${sorted[0].id}`, -Infinity, sorted[0].subtitleTimeSec, [sorted[0].id], 0, true));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const span = b.subtitleTimeSec - a.subtitleTimeSec;
    const rate = span > EPS ? (offsetOf(b) - offsetOf(a)) / span : 0;
    intervals.push(makeInterval(`interval:between:${a.id}|${b.id}`, a.subtitleTimeSec, b.subtitleTimeSec, [a.id, b.id], rate, false));
  }
  const last = sorted[sorted.length - 1];
  intervals.push(makeInterval(`interval:after:${last.id}`, last.subtitleTimeSec, Infinity, [last.id], 0, true));
  return intervals;
}

/** 在字幕时刻 t 处求偏移（分段线性插值，范围外取最近锚点偏移） */
export function offsetAt(sortedAnchors: Anchor[], t: number): { offset: number; intervalIndex: number } {
  if (sortedAnchors.length === 0) return { offset: 0, intervalIndex: 0 };
  if (t <= sortedAnchors[0].subtitleTimeSec) {
    const a = sortedAnchors[0];
    return { offset: a.subtitleTimeSec - a.mediaTimeSec, intervalIndex: 0 };
  }
  const last = sortedAnchors[sortedAnchors.length - 1];
  if (t >= last.subtitleTimeSec) {
    return { offset: last.subtitleTimeSec - last.mediaTimeSec, intervalIndex: sortedAnchors.length };
  }
  for (let i = 0; i < sortedAnchors.length - 1; i++) {
    const a = sortedAnchors[i];
    const b = sortedAnchors[i + 1];
    if (t >= a.subtitleTimeSec && t <= b.subtitleTimeSec) {
      const span = b.subtitleTimeSec - a.subtitleTimeSec;
      const offsetA = a.subtitleTimeSec - a.mediaTimeSec;
      const offsetB = b.subtitleTimeSec - b.mediaTimeSec;
      const ratio = span > EPS ? (t - a.subtitleTimeSec) / span : 0;
      return { offset: offsetA + (offsetB - offsetA) * ratio, intervalIndex: i + 1 };
    }
  }
  return { offset: last.subtitleTimeSec - last.mediaTimeSec, intervalIndex: sortedAnchors.length };
}

/** 为单个片段推导结论（纯函数，增量与整段重推共用，保证结果一致） */
export function deriveConclusion(
  segment: SubtitleSegment,
  orderIndex: number,
  sortedAnchors: Anchor[],
  intervals: DriftInterval[],
  frameRate: number,
  context: {
    conflict?: ConflictGroup;
    adjudicationById: Map<string, Adjudication>;
    issueIdsBySegment: Map<string, string[]>;
  },
): SegmentConclusion {
  const midSec = (segment.startSec + segment.endSec) / 2;
  const { offset, intervalIndex } = offsetAt(sortedAnchors, midSec);
  const interval = intervals[intervalIndex];
  const conflict = context.conflict;
  const rejected = conflict ? conflict.rejectedSegmentIds.includes(segment.id) : false;
  const adjudicationIds: string[] = [];
  if (conflict?.adjudicationId) {
    const adj = context.adjudicationById.get(conflict.adjudicationId);
    if (adj) adjudicationIds.push(adj.id);
  }
  return {
    segmentId: segment.id,
    orderIndex,
    midSec,
    offsetSec: offset,
    offsetFrames: Math.round(offset * frameRate),
    alignedMediaStartSec: segment.startSec - offset,
    alignedMediaEndSec: segment.endSec - offset,
    intervalId: interval.id,
    driftTrend: interval.trend,
    driftRateSecPerSec: interval.driftRateSecPerSec,
    basis: {
      anchorIds: [...interval.anchorIds],
      adjudicationIds,
      extrapolated: interval.extrapolated,
    },
    conflictId: conflict?.id,
    rejected,
    issueIds: context.issueIdsBySegment.get(segment.id) ?? [],
  };
}

/** 整段重推：从输入一次性推导全部结论 */
export function computeAlignment(inputs: AlignmentInputs): AlignmentResult {
  const issues = detectIssues(inputs);
  const conflicts = detectConflicts(inputs.segments, inputs.adjudications);
  const sortedAnchors = sortAnchors(inputs.anchors);
  const intervals = buildIntervals(inputs.anchors, inputs.media.frameRate);
  const sortedSegments = sortSegments(inputs.segments);

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
  const adjudicationById = new Map(inputs.adjudications.map((a) => [a.id, a]));

  const conclusions = sortedSegments.map((seg, orderIndex) =>
    deriveConclusion(seg, orderIndex, sortedAnchors, intervals, inputs.media.frameRate, {
      conflict: conflictBySegment.get(seg.id),
      adjudicationById,
      issueIdsBySegment,
    }),
  );

  return {
    issues,
    conflicts,
    intervals,
    conclusions,
    frameRate: inputs.media.frameRate,
  };
}
