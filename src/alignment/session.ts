import {
  adjudicationOf,
  conflictKeyFor,
  deriveAll,
  orderKeyOf,
  sortSegments,
  validAnchorsOf,
} from './engine'
import type {
  Adjudication,
  AlignmentState,
  Anchor,
  DerivationResult,
  MediaInfo,
  Segment,
  SegmentConclusion,
} from './types'

export type ChangeKind =
  | 'init'
  | 'frame-rate'
  | 'media-duration'
  | 'anchor-upsert'
  | 'anchor-remove'
  | 'segment-upsert'
  | 'segment-remove'
  | 'adjudicate'

export interface ChangeLogEntry {
  seq: number
  kind: ChangeKind
  description: string
  affectedSegmentIds: string[]
  reusedSegmentIds: string[]
  totalSegments: number
  version: number
}

export class AlignmentSession {
  private state: AlignmentState
  private result: DerivationResult
  private version = 0
  readonly changeLog: ChangeLogEntry[] = []

  constructor(initial: AlignmentState) {
    this.state = structuredClone(initial)
    this.version = 1
    this.result = deriveAll(this.state, this.version)
    this.changeLog.push({
      seq: 1,
      kind: 'init',
      description: '初始化：整体推导一次',
      affectedSegmentIds: this.result.conclusions.map((c) => c.segmentId),
      reusedSegmentIds: [],
      totalSegments: this.state.segments.length,
      version: this.version,
    })
  }

  getState(): AlignmentState {
    return structuredClone(this.state)
  }

  getResult(): DerivationResult {
    return this.result
  }

  setMedia(next: MediaInfo): void {
    const prev = this.state.media
    this.state.media = { ...next }
    const frameChanged = prev.frameRate !== next.frameRate
    const affected = frameChanged ? new Set(this.state.segments.map((s) => s.id)) : new Set<string>()
    this.commit(frameChanged ? 'frame-rate' : 'media-duration', affected,
      `媒体信息更新：时长 ${prev.duration}→${next.duration}s，帧率 ${prev.frameRate}→${next.frameRate}`)
  }

  upsertAnchor(anchor: Anchor): void {
    const oldAnchors = this.state.anchors
    const existed = oldAnchors.some((a) => a.id === anchor.id)
    this.state.anchors = [...this.state.anchors.filter((a) => a.id !== anchor.id), anchor]
    const affected = this.anchorIntervalIds(oldAnchors, this.state.anchors, anchor.id)
    this.commit('anchor-upsert', affected,
      `${existed ? '修正' : '新增'}锚点 ${anchor.id} → 片段 ${anchor.segmentId} @${anchor.mediaTime}s`)
  }

  removeAnchor(anchorId: string): void {
    const oldAnchors = this.state.anchors
    this.state.anchors = this.state.anchors.filter((a) => a.id !== anchorId)
    const affected = this.anchorIntervalIds(oldAnchors, this.state.anchors, anchorId)
    this.commit('anchor-remove', affected, `删除锚点 ${anchorId}`)
  }

  upsertSegment(segment: Segment): void {
    const oldSegs = this.state.segments
    const previous = oldSegs.find((s) => s.id === segment.id) ?? null
    this.state.segments = [...this.state.segments.filter((s) => s.id !== segment.id), segment]
    const affected = this.segmentNeighborhoodIds(previous, segment)
    this.commit('segment-upsert', affected,
      `${previous ? '修正' : '新增'}片段 ${segment.id} [${segment.start}, ${segment.end}] 来源=${segment.source}`)
  }

  removeSegment(segmentId: string): void {
    const previous = this.state.segments.find((s) => s.id === segmentId) ?? null
    this.state.segments = this.state.segments.filter((s) => s.id !== segmentId)
    const affected = this.segmentNeighborhoodIds(previous, null)
    this.commit('segment-remove', affected, `删除片段 ${segmentId}`)
  }

  adjudicate(conflictKey: string, chosenSegmentId: string, note?: string): Adjudication {
    const group = this.result.conflicts.find((g) => g.key === conflictKey)
    if (!group) throw new Error(`找不到矛盾组 ${conflictKey}`)
    const adjudication = adjudicationOf(group, chosenSegmentId, Date.now(), note)
    this.state.adjudications = [
      ...this.state.adjudications.filter((a) => a.conflictKey !== conflictKey),
      adjudication,
    ]
    const affected = new Set(group.segmentIds)
    this.commit('adjudicate', affected,
      `裁决 ${conflictKey}：采纳片段 ${chosenSegmentId}，其余 ${adjudication.rejectedSegmentIds.length} 条挂起`)
    return adjudication
  }

  private commit(kind: ChangeKind, affected: Set<string>, description: string): void {
    this.version += 1
    const fresh = deriveAll(this.state, this.version)
    const prevById = new Map(this.result.conclusions.map((c) => [c.segmentId, c]))
    const currentIds = new Set(fresh.conclusions.map((c) => c.segmentId))
    const reused: string[] = []
    const conclusions: SegmentConclusion[] = fresh.conclusions.map((conclusion) => {
      if (!affected.has(conclusion.segmentId) && prevById.has(conclusion.segmentId)) {
        reused.push(conclusion.segmentId)
        return prevById.get(conclusion.segmentId)!
      }
      return conclusion
    })
    this.result = { ...fresh, conclusions, version: this.version }
    this.changeLog.push({
      seq: this.version,
      kind,
      description,
      affectedSegmentIds: [...affected].filter((id) => currentIds.has(id)),
      reusedSegmentIds: reused,
      totalSegments: this.state.segments.length,
      version: this.version,
    })
  }

  private anchorIntervalIds(oldAnchors: Anchor[], newAnchors: Anchor[], changedId: string): Set<string> {
    const interval = [
      this.neighborInterval(oldAnchors, changedId),
      this.neighborInterval(newAnchors, changedId),
    ]
    const lo = Math.min(...interval.map(([t]) => t))
    const hi = Math.max(...interval.map(([, t]) => t))
    const ids = new Set<string>()
    for (const seg of this.state.segments) {
      if (seg.start > lo && seg.start < hi) ids.add(seg.id)
    }
    const target = [...oldAnchors, ...newAnchors].find((a) => a.id === changedId)
    if (target) ids.add(target.segmentId)
    return ids
  }

  private neighborInterval(anchors: Anchor[], changedId: string): [number, number] {
    const valid = validAnchorsOf({
      media: this.state.media,
      anchors,
      segments: this.state.segments,
      adjudications: [],
    })
    const idx = valid.findIndex((a) => a.id === changedId)
    if (idx >= 0) {
      return [valid[idx - 1]?.mediaTime ?? -Infinity, valid[idx + 1]?.mediaTime ?? Infinity]
    }
    const removed = anchors.find((a) => a.id === changedId)
    const t = removed?.mediaTime ?? 0
    let lo = -Infinity
    let hi = Infinity
    for (const a of valid) {
      if (a.mediaTime <= t) lo = a.mediaTime
      if (a.mediaTime >= t && hi === Infinity) hi = a.mediaTime
    }
    return [lo, hi]
  }

  private segmentNeighborhoodIds(previous: Segment | null, next: Segment | null): Set<string> {
    const ids = new Set<string>()
    const addAround = (seg: Segment, list: Segment[]) => {
      ids.add(seg.id)
      const ordered = sortSegments(list)
      const idx = ordered.findIndex((s) => s.id === seg.id)
      if (idx > 0) ids.add(ordered[idx - 1].id)
      if (idx >= 0 && idx + 1 < ordered.length) ids.add(ordered[idx + 1].id)
      for (const other of list) {
        if (other.id !== seg.id && conflictKeyFor(other.start) === conflictKeyFor(seg.start)) {
          ids.add(other.id)
        }
      }
    }
    if (next) addAround(next, this.state.segments)
    if (previous) {
      const oldList =
        next && previous.start === next.start
          ? this.state.segments
          : [...this.state.segments.filter((s) => s.id !== previous.id), previous]
      addAround(previous, oldList)
    }
    for (const anchor of this.state.anchors) {
      if (ids.has(anchor.segmentId)) {
        for (const id of this.anchorIntervalIds(this.state.anchors, this.state.anchors, anchor.id)) {
          ids.add(id)
        }
      }
    }
    return ids
  }
}

export function compareWithFullRederive(session: AlignmentSession): string[] {
  const fresh = deriveAll(session.getState(), session.getResult().version)
  const mismatches: string[] = []
  const current = session.getResult()
  if (fresh.anomalies.length !== current.anomalies.length) mismatches.push('anomalies 数量不一致')
  if (fresh.conflicts.length !== current.conflicts.length) mismatches.push('conflicts 数量不一致')
  const byId = new Map(current.conclusions.map((c) => [c.segmentId, c]))
  for (const expected of fresh.conclusions) {
    const actual = byId.get(expected.segmentId)
    if (!actual) {
      mismatches.push(`缺少片段 ${expected.segmentId} 的结论`)
      continue
    }
    const fields: (keyof SegmentConclusion)[] = [
      'offset', 'offsetFrames', 'adjustedStart', 'adjustedEnd',
      'driftTrend', 'driftRate', 'suppressed', 'pendingConflict', 'anomalies', 'orderKey',
    ]
    for (const field of fields) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
        mismatches.push(`片段 ${expected.segmentId} 字段 ${field} 与整体重推不一致`)
      }
    }
    for (const basisField of ['anchorIds', 'adjudicationIds', 'orderKey'] as const) {
      if (JSON.stringify(actual.basis[basisField]) !== JSON.stringify(expected.basis[basisField])) {
        mismatches.push(`片段 ${expected.segmentId} 依据 ${basisField} 与整体重推不一致`)
      }
    }
  }
  return mismatches
}

export { orderKeyOf }
