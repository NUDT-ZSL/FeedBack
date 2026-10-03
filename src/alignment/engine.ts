import type {
  Adjudication,
  AlignmentState,
  Anchor,
  Anomaly,
  AnomalyKind,
  ConflictGroup,
  DerivationResult,
  DriftTrend,
  Segment,
  SegmentConclusion,
} from './types'

export const DRIFT_EPSILON = 1e-3
export const TIME_BUCKET_PRECISION = 3

export function timeBucket(t: number): string {
  return t.toFixed(TIME_BUCKET_PRECISION)
}

export function conflictKeyFor(t: number): string {
  return `conflict@${timeBucket(t)}`
}

export function orderKeyOf(seg: Segment): string {
  return `${timeBucket(seg.start)}|${seg.id}`
}

export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

export function validAnchorsOf(state: AlignmentState): Anchor[] {
  const segIds = new Set(state.segments.map((s) => s.id))
  return state.anchors
    .filter((a) => segIds.has(a.segmentId))
    .sort((a, b) => (a.mediaTime !== b.mediaTime ? a.mediaTime - b.mediaTime : a.id < b.id ? -1 : 1))
}

export function detectAnomalies(state: AlignmentState): Anomaly[] {
  const anomalies: Anomaly[] = []
  const segById = new Map(state.segments.map((s) => [s.id, s]))

  for (const seg of state.segments) {
    if (seg.end < seg.start) {
      anomalies.push({
        id: `reversed:${seg.id}`,
        kind: 'reversed-time',
        segmentIds: [seg.id],
        detail: `片段 ${seg.id} 结束时刻 ${seg.end}s 早于开始时刻 ${seg.start}s`,
      })
    }
  }

  const ordered = sortSegments(state.segments)
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const cur = ordered[i]
    const nxt = ordered[i + 1]
    if (nxt.start < cur.end) {
      anomalies.push({
        id: `overlap:${cur.id}:${nxt.id}`,
        kind: 'overlap',
        segmentIds: [cur.id, nxt.id],
        detail: `片段 ${cur.id} [${cur.start}, ${cur.end}] 与 ${nxt.id} [${nxt.start}, ${nxt.end}] 区间重叠`,
      })
    }
  }

  for (const anchor of state.anchors) {
    if (!segById.has(anchor.segmentId)) {
      anomalies.push({
        id: `missing-anchor:${anchor.id}`,
        kind: 'missing-anchor-target',
        segmentIds: [],
        anchorId: anchor.id,
        detail: `锚点 ${anchor.id} (${anchor.mediaTime}s) 指向不存在的片段 ${anchor.segmentId}`,
      })
    }
  }

  for (const group of detectConflicts(state)) {
    anomalies.push({
      id: `conflict:${group.key}`,
      kind: 'source-conflict',
      segmentIds: group.segmentIds,
      detail: `时刻 ${group.time}s 存在 ${group.segmentIds.length} 条来源矛盾的片段 (${group.sources.join(' / ')})`,
    })
  }

  return anomalies
}

export function detectConflicts(state: AlignmentState): ConflictGroup[] {
  const buckets = new Map<string, Segment[]>()
  for (const seg of state.segments) {
    const key = conflictKeyFor(seg.start)
    const list = buckets.get(key) ?? []
    list.push(seg)
    buckets.set(key, list)
  }
  const adjudicationByKey = new Map(state.adjudications.map((a) => [a.conflictKey, a]))
  const groups: ConflictGroup[] = []
  for (const [key, segs] of buckets) {
    const sources = [...new Set(segs.map((s) => s.source))]
    if (segs.length < 2 || sources.length < 2) continue
    const resolution = adjudicationByKey.get(key)
    const resolved = resolution !== undefined && segs.some((s) => s.id === resolution.chosenSegmentId)
    groups.push({
      key,
      time: segs[0].start,
      segmentIds: sortSegments(segs).map((s) => s.id),
      sources,
      status: resolved ? 'resolved' : 'pending',
      resolution: resolved ? resolution : undefined,
    })
  }
  return groups.sort((a, b) => a.time - b.time)
}

interface AnchorPoint {
  anchor: Anchor
  offset: number
}

function anchorPoints(state: AlignmentState): AnchorPoint[] {
  const segById = new Map(state.segments.map((s) => [s.id, s]))
  return validAnchorsOf(state).map((anchor) => ({
    anchor,
    offset: anchor.mediaTime - segById.get(anchor.segmentId)!.start,
  }))
}

function classifyDrift(rate: number | null, anchored: boolean): DriftTrend {
  if (rate === null) return anchored ? 'extrapolated' : 'unanchored'
  if (Math.abs(rate) < DRIFT_EPSILON) return 'stable'
  return rate > 0 ? 'drifting-forward' : 'drifting-backward'
}

export function deriveAll(state: AlignmentState, version = 0): DerivationResult {
  const anomalies = detectAnomalies(state)
  const conflicts = detectConflicts(state)
  const points = anchorPoints(state)
  const conflictBySegment = new Map<string, ConflictGroup>()
  for (const group of conflicts) {
    for (const id of group.segmentIds) conflictBySegment.set(id, group)
  }
  const anomalyKindsBySegment = new Map<string, AnomalyKind[]>()
  for (const anomaly of anomalies) {
    for (const id of anomaly.segmentIds) {
      const list = anomalyKindsBySegment.get(id) ?? []
      if (!list.includes(anomaly.kind)) list.push(anomaly.kind)
      anomalyKindsBySegment.set(id, list)
    }
  }

  const conclusions: SegmentConclusion[] = sortSegments(state.segments).map((seg) => {
    const t = seg.start
    let prev: AnchorPoint | null = null
    let next: AnchorPoint | null = null
    for (const p of points) {
      if (p.anchor.mediaTime <= t) prev = p
      if (p.anchor.mediaTime >= t) {
        next = p
        break
      }
    }

    let offset: number
    let driftRate: number | null
    let anchored: boolean
    const anchorIds: string[] = []
    if (prev && next) {
      anchorIds.push(prev.anchor.id, next.anchor.id)
      anchored = true
      const t1 = prev.anchor.mediaTime
      const t2 = next.anchor.mediaTime
      if (t1 === t2) {
        offset = prev.offset
        driftRate = 0
      } else {
        driftRate = (next.offset - prev.offset) / (t2 - t1)
        offset = prev.offset + driftRate * (t - t1)
      }
    } else if (prev || next) {
      const only = (prev ?? next)!
      anchorIds.push(only.anchor.id)
      offset = only.offset
      driftRate = null
      anchored = true
    } else {
      offset = 0
      driftRate = null
      anchored = false
    }

    const conflict = conflictBySegment.get(seg.id)
    const adjudicationIds: string[] = []
    let suppressed = false
    let pendingConflict = false
    if (conflict) {
      if (conflict.status === 'resolved' && conflict.resolution) {
        adjudicationIds.push(conflict.resolution.id)
        suppressed = conflict.resolution.chosenSegmentId !== seg.id
      } else {
        pendingConflict = true
      }
    }

    return {
      segmentId: seg.id,
      orderKey: orderKeyOf(seg),
      offset,
      offsetFrames: Math.round(offset * state.media.frameRate),
      adjustedStart: seg.start + offset,
      adjustedEnd: seg.end + offset,
      driftTrend: classifyDrift(driftRate, anchored),
      driftRate,
      suppressed,
      pendingConflict,
      anomalies: anomalyKindsBySegment.get(seg.id) ?? [],
      basis: { anchorIds, adjudicationIds, orderKey: orderKeyOf(seg), version },
    }
  })

  return { conclusions, anomalies, conflicts, version }
}

export function adjudicationOf(
  conflict: ConflictGroup,
  chosenSegmentId: string,
  decidedAt: number,
  note?: string,
): Adjudication {
  return {
    id: `adj-${conflict.key}-${decidedAt}`,
    conflictKey: conflict.key,
    chosenSegmentId,
    rejectedSegmentIds: conflict.segmentIds.filter((id) => id !== chosenSegmentId),
    decidedAt,
    note,
  }
}
