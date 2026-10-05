// 对齐推演模块的核心数据模型

/** 媒体信息 */
export interface MediaInfo {
  /** 媒体总时长（秒） */
  durationSec: number;
  /** 帧率（fps），用于把偏移/漂移投影到帧号 */
  frameRate: number;
}

/**
 * 关键锚点：在媒体时间轴上已确认的对应关系
 * mediaTimeSec 处的画面，对应字幕时间轴上的 subtitleTimeSec
 * segmentId 可选：指向该锚点依附的字幕片段；片段缺失即为“锚点指向缺失”
 */
export interface Anchor {
  id: string;
  mediaTimeSec: number;
  subtitleTimeSec: number;
  /** 可选：锚点依附的字幕片段；指向不存在的片段时标记 dangling-anchor */
  segmentId?: string;
}

/** 字幕片段 */
export interface SubtitleSegment {
  id: string;
  /** 起始时刻（秒，字幕时间轴） */
  startSec: number;
  /** 结束时刻（秒，字幕时间轴）；小于 startSec 即为倒序 */
  endSec: number;
  text: string;
  /** 来源标记，例如 ASR / 人工 / OCR */
  source: string;
}

/** 数据问题类型 */
export type IssueKind =
  | 'reversed-time' // 片段时刻倒序
  | 'out-of-media' // 片段或锚点超出媒体总时长
  | 'overlap' // 起止区间重叠
  | 'dangling-anchor'; // 锚点指向的片段缺失

export interface Issue {
  id: string;
  kind: IssueKind;
  message: string;
  segmentIds?: string[];
  anchorId?: string;
}

/** 漂移趋势 */
export type DriftTrend = 'ahead' | 'behind' | 'stable' | 'extrapolated';

export const DRIFT_TREND_LABEL: Record<DriftTrend, string> = {
  ahead: '字幕超前（漂移增大）',
  behind: '字幕滞后（漂移减小）',
  stable: '基本稳定',
  extrapolated: '锚点外推（无相邻锚点）',
};

/** 锚点之间（或锚点外）的漂移区间 */
export interface DriftInterval {
  id: string;
  /** 区间在字幕时间轴上的范围，首尾区间延伸到 ±Infinity */
  fromSec: number;
  toSec: number;
  /** 起止锚点 id；外推区间只含一个 */
  anchorIds: string[];
  /** 漂移速率：每经过 1 秒字幕时间，偏移（字幕-媒体）变化多少秒 */
  driftRateSecPerSec: number;
  /** 折算到每 1000 帧的漂移帧 */
  driftFramesPer1000: number;
  trend: DriftTrend;
  extrapolated: boolean;
}

/** 矛盾组：同一时刻出现多条来源互相矛盾的片段 */
export interface ConflictGroup {
  id: string;
  segmentIds: string[];
  /** 判定为采纳的片段 id */
  chosenSegmentId: string | null;
  /** 判定为驳回的片段 id */
  rejectedSegmentIds: string[];
  /** 最新一次裁决记录 id；未裁决为 null */
  adjudicationId: string | null;
  reason: string;
}

/** 裁决记录 */
export interface Adjudication {
  id: string;
  conflictId: string;
  /** 采纳的片段 id */
  chosenSegmentId: string;
  /** 驳回的片段 id 列表 */
  rejectedSegmentIds: string[];
  note?: string;
  /** 裁决序号（同组多次裁决时越大越新） */
  seq: number;
  createdAt: number;
}

/** 单条对齐结论 */
export interface SegmentConclusion {
  segmentId: string;
  /** 在“字幕时间轴排序”中的序号（从 0 开始，被驳回的片段也参与排序并保留） */
  orderIndex: number;
  /** 用于推导的代表时刻（字幕时间轴上的区间中点） */
  midSec: number;
  /** 推导出的偏移 = 字幕时刻 - 媒体时刻（秒） */
  offsetSec: number;
  /** 偏移折算为帧 */
  offsetFrames: number;
  /** 片段起始对齐到媒体时间轴的位置（秒） */
  alignedMediaStartSec: number;
  alignedMediaEndSec: number;
  /** 所在漂移区间 */
  intervalId: string;
  driftTrend: DriftTrend;
  driftRateSecPerSec: number;
  /** 依据 */
  basis: {
    /** 推导所依据的锚点 id（1 个表示外推，2 个表示区间内插） */
    anchorIds: string[];
    /** 影响该结论的裁决记录 id */
    adjudicationIds: string[];
    /** 是否为锚点覆盖范围外的外推结论 */
    extrapolated: boolean;
  };
  /** 矛盾组 id（属于某组时存在） */
  conflictId?: string;
  /** 是否在裁决中被驳回（保留但不参与漂移趋势统计） */
  rejected: boolean;
  issueIds: string[];
}

export interface AlignmentResult {
  issues: Issue[];
  conflicts: ConflictGroup[];
  intervals: DriftInterval[];
  conclusions: SegmentConclusion[];
  /** 生成结果时使用的帧率 */
  frameRate: number;
}

export interface AlignmentInputs {
  media: MediaInfo;
  anchors: Anchor[];
  segments: SubtitleSegment[];
  adjudications: Adjudication[];
}

/** 一次增量重推的受影响范围 */
export interface AffectedRange {
  /** 本次重推的结论（片段 id） */
  conclusionSegmentIds: string[];
  /** 本次重推的漂移区间（区间 id） */
  intervalIds: string[];
  /** 是否只重投影了帧字段（帧率调整） */
  frameProjectionOnly: boolean;
  /** 是否整体重推 */
  fullRebuild: boolean;
  reason: string;
}
