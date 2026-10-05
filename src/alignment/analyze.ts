import type {
  Adjudication,
  Anchor,
  ConflictGroup,
  SegmentAnomaly,
  SubtitleSegment,
} from './types';

/** 参与插值的锚点点位：以目标片段起始时刻为横轴位置 */
export interface AnchorPoint {
  anchorId: string;
  time: number;
  offset: number;
}

export interface Analysis {
  /** 按 (startMs, 录入顺序) 稳定排序后的片段 */
  sortedSegments: SubtitleSegment[];
  /** segmentId -> 排序后下标 */
  orderIndex: Map<string, number>;
  conflicts: ConflictGroup[];
  anomalies: SegmentAnomaly[];
  /** 参与推演的片段（非待裁决、非裁决落选） */
  activeIds: Set<string>;
  /** 待裁决片段所属的冲突 key */
  pendingConflictBySegment: Map<string, string>;
  /** 有效锚点点位，按 time 升序 */
  anchorPoints: AnchorPoint[];
  /** segmentId -> 生效的裁决记录 id 列表 */
  adjudicationIdsBySegment: Map<string, string[]>;
}

export function conflictKeyFor(startMs: number): string {
  return `conflict@${startMs}`;
}

/**
 * 分析录入数据：排序、冲突分组、异常检测、有效锚点解析。
 * 原则：任何异常都只标记、不丢弃；矛盾片段双方全部保留并置为待裁决。
 */
export function analyze(
  segments: SubtitleSegment[],
  anchors: Anchor[],
  adjudications: Adjudication[],
): Analysis {
  const sortedSegments = segments
    .map((seg, inputIndex) => ({ seg, inputIndex }))
    .sort((a, b) => a.seg.startMs - b.seg.startMs || a.inputIndex - b.inputIndex)
    .map((entry) => entry.seg);

  const orderIndex = new Map<string, number>();
  sortedSegments.forEach((seg, idx) => orderIndex.set(seg.id, idx));

  const anomalies: SegmentAnomaly[] = [];

  for (const seg of sortedSegments) {
    if (seg.startMs > seg.endMs) {
      anomalies.push({ kind: 'reversed', segmentId: seg.id, startMs: seg.startMs, endMs: seg.endMs });
    }
  }

  for (let i = 1; i < sortedSegments.length; i += 1) {
    const prev = sortedSegments[i - 1];
    const curr = sortedSegments[i];
    if (curr.startMs < prev.endMs) {
      anomalies.push({ kind: 'overlap', segmentId: curr.id, otherSegmentId: prev.id });
    }
  }

  // 冲突分组：同一起始时刻、且 (text, source) 不完全一致的多条片段
  const byStart = new Map<number, SubtitleSegment[]>();
  for (const seg of sortedSegments) {
    const list = byStart.get(seg.startMs) ?? [];
    list.push(seg);
    byStart.set(seg.startMs, list);
  }

  const conflicts: ConflictGroup[] = [];
  const adjudicationByConflict = new Map<string, Adjudication>();
  for (const adj of adjudications) {
    adjudicationByConflict.set(adj.conflictKey, adj);
  }

  const activeIds = new Set<string>();
  const pendingConflictBySegment = new Map<string, string>();
  const adjudicationIdsBySegment = new Map<string, string[]>();
  const excludedIds = new Set<string>();

  for (const [startMs, group] of byStart) {
    if (group.length < 2) continue;
    const first = group[0];
    const contradictory = group.some((seg) => seg.text !== first.text || seg.source !== first.source);
    if (!contradictory) continue;
    const key = conflictKeyFor(startMs);
    const adjudication = adjudicationByConflict.get(key);
    const winner = adjudication && group.some((seg) => seg.id === adjudication.winnerSegmentId)
      ? adjudication.winnerSegmentId
      : null;
    conflicts.push({
      key,
      startMs,
      segmentIds: group.map((seg) => seg.id),
      status: winner ? 'resolved' : 'pending',
    });
    anomalies.push({ kind: 'conflict', conflictKey: key, segmentIds: group.map((seg) => seg.id) });
    for (const seg of group) {
      if (winner === null) {
        pendingConflictBySegment.set(seg.id, key);
      } else if (seg.id !== winner) {
        excludedIds.add(seg.id);
      }
      if (adjudication) {
        const list = adjudicationIdsBySegment.get(seg.id) ?? [];
        list.push(adjudication.id);
        adjudicationIdsBySegment.set(seg.id, list);
      }
    }
  }

  for (const seg of sortedSegments) {
    if (!pendingConflictBySegment.has(seg.id) && !excludedIds.has(seg.id)) {
      activeIds.add(seg.id);
    }
  }

  // 锚点解析：目标缺失或目标当前不可参与推演时，锚点不生效但保留并标记
  const segmentById = new Map(segments.map((seg) => [seg.id, seg]));
  const anchorPoints: AnchorPoint[] = [];
  for (const anchor of anchors) {
    const target = segmentById.get(anchor.segmentId);
    if (!target) {
      anomalies.push({ kind: 'dangling-anchor', anchorId: anchor.id, segmentId: anchor.segmentId });
      continue;
    }
    if (!activeIds.has(anchor.segmentId)) {
      anomalies.push({ kind: 'inactive-anchor-target', anchorId: anchor.id, segmentId: anchor.segmentId });
      continue;
    }
    anchorPoints.push({
      anchorId: anchor.id,
      time: target.startMs,
      offset: anchor.mediaTimeMs - target.startMs,
    });
  }
  anchorPoints.sort((a, b) => a.time - b.time);
  // 同一时刻多个有效锚点：保留先出现者，避免插值除零
  const deduped: AnchorPoint[] = [];
  for (const point of anchorPoints) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === point.time) continue;
    deduped.push(point);
  }

  return {
    sortedSegments,
    orderIndex,
    conflicts,
    anomalies,
    activeIds,
    pendingConflictBySegment,
    anchorPoints: deduped,
    adjudicationIdsBySegment,
  };
}
