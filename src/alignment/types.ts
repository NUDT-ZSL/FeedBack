/** 媒体信息：总时长与帧率 */
export interface MediaInfo {
  durationMs: number;
  frameRate: number;
}

/** 关键锚点：声明某字幕片段的起始时刻应对齐到媒体时间轴的 mediaTimeMs */
export interface Anchor {
  id: string;
  mediaTimeMs: number;
  segmentId: string;
}

/** 字幕片段（保留录入顺序，不做静默清洗） */
export interface SubtitleSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  source: string;
}

/** 裁决记录：针对某一冲突组选定保留片段 */
export interface Adjudication {
  id: string;
  conflictKey: string;
  winnerSegmentId: string;
  note?: string;
}

/** 冲突组：同一起始时刻出现多条来源/文本矛盾的片段 */
export interface ConflictGroup {
  key: string;
  startMs: number;
  segmentIds: string[];
  status: 'pending' | 'resolved';
}

/** 数据异常标记（不静默丢弃，全部显式上报） */
export type SegmentAnomaly =
  | { kind: 'reversed'; segmentId: string; startMs: number; endMs: number }
  | { kind: 'overlap'; segmentId: string; otherSegmentId: string }
  | { kind: 'dangling-anchor'; anchorId: string; segmentId: string }
  | { kind: 'inactive-anchor-target'; anchorId: string; segmentId: string }
  | { kind: 'conflict'; conflictKey: string; segmentIds: string[] };

export type DriftTrend = 'stable' | 'drifting-later' | 'drifting-earlier' | 'unknown';

/** 结论依据：可逐条追溯到锚点、片段顺序与裁决记录 */
export interface ConclusionBasis {
  /** 参与偏移插值的锚点 id（0~2 个） */
  anchorIds: string[];
  /** 排序后相邻片段 id，用于定位顺序依据 */
  prevSegmentId: string | null;
  nextSegmentId: string | null;
  /** 该片段所涉裁决记录 id */
  adjudicationIds: string[];
}

export type ConclusionStatus = 'derived' | 'pending-adjudication' | 'excluded';

export interface SegmentConclusion {
  segmentId: string;
  status: ConclusionStatus;
  /** 建议偏移量：正数表示字幕应向后（更晚）移动 */
  offsetMs: number | null;
  /** 按当前帧率换算的帧偏移 */
  offsetFrames: number | null;
  /** 漂移速率：每媒体秒偏移变化的毫秒数 */
  driftSlopeMsPerSec: number | null;
  driftTrend: DriftTrend;
  basis: ConclusionBasis | null;
}

/** 一次推演的完整状态快照 */
export interface DerivationState {
  media: MediaInfo;
  segments: SubtitleSegment[];
  anchors: Anchor[];
  adjudications: Adjudication[];
  /** 全部片段按 (startMs, 录入顺序) 排序后的 id 序列 */
  sortedIds: string[];
  conflicts: ConflictGroup[];
  anomalies: SegmentAnomaly[];
  /** 与 sortedIds 一一对应 */
  conclusions: SegmentConclusion[];
}

export interface DerivationInput {
  media: MediaInfo;
  segments: SubtitleSegment[];
  anchors: Anchor[];
  adjudications: Adjudication[];
}
