export interface MediaInfo {
  duration: number
  frameRate: number
}

export interface Anchor {
  id: string
  mediaTime: number
  segmentId: string
  note?: string
}

export interface Segment {
  id: string
  start: number
  end: number
  text: string
  source: string
}

export type AnomalyKind =
  | 'reversed-time'
  | 'overlap'
  | 'missing-anchor-target'
  | 'source-conflict'

export interface Anomaly {
  id: string
  kind: AnomalyKind
  segmentIds: string[]
  anchorId?: string
  detail: string
}

export interface Adjudication {
  id: string
  conflictKey: string
  chosenSegmentId: string
  rejectedSegmentIds: string[]
  decidedAt: number
  note?: string
}

export interface ConflictGroup {
  key: string
  time: number
  segmentIds: string[]
  sources: string[]
  status: 'pending' | 'resolved'
  resolution?: Adjudication
}

export type DriftTrend =
  | 'stable'
  | 'drifting-forward'
  | 'drifting-backward'
  | 'extrapolated'
  | 'unanchored'

export interface ConclusionBasis {
  anchorIds: string[]
  adjudicationIds: string[]
  orderKey: string
  version: number
}

export interface SegmentConclusion {
  segmentId: string
  orderKey: string
  offset: number
  offsetFrames: number
  adjustedStart: number
  adjustedEnd: number
  driftTrend: DriftTrend
  driftRate: number | null
  suppressed: boolean
  pendingConflict: boolean
  anomalies: AnomalyKind[]
  basis: ConclusionBasis
}

export interface DerivationResult {
  conclusions: SegmentConclusion[]
  anomalies: Anomaly[]
  conflicts: ConflictGroup[]
  version: number
}

export interface AlignmentState {
  media: MediaInfo
  anchors: Anchor[]
  segments: Segment[]
  adjudications: Adjudication[]
}

export const ANOMALY_LABELS: Record<AnomalyKind, string> = {
  'reversed-time': '时刻倒序',
  overlap: '区间重叠',
  'missing-anchor-target': '锚点指向缺失片段',
  'source-conflict': '来源矛盾',
}

export const DRIFT_LABELS: Record<DriftTrend, string> = {
  stable: '稳定',
  'drifting-forward': '前向漂移(偏移增大)',
  'drifting-backward': '反向漂移(偏移减小)',
  extrapolated: '锚点外推',
  unanchored: '无锚点',
}
