// 移动轨迹推演的核心数据类型。
// 全部为纯数据结构（无外部服务、无时区/随机性），保证结论可序列化、可复现。

/** 一个目标（人/设备）在某一时刻上报的位置点 */
export interface PositionPoint {
  id: string;
  targetId: string;
  /** epoch 毫秒 */
  timestamp: number;
  /** 经度；null 表示坐标缺失 */
  lng: number | null;
  /** 纬度；null 表示坐标缺失 */
  lat: number | null;
}

/** 停留/移动划分参数 */
export interface SegmentationParams {
  /** 与停留锚点距离不超过该值视为同一次停留（米，闭区间） */
  stayRadiusMeters: number;
  /** 聚类持续时长达到该值才判定为停留段（毫秒，闭区间） */
  minStayDurationMs: number;
  /** 与停留锚点距离在 (jitterRadius, stayRadius] 内视为采样抖动（米） */
  jitterRadiusMeters: number;
}

/** 同行关系判定参数 */
export interface CompanionParams {
  /** 两个停留锚点距离不超过该值才算空间同行（米，闭区间） */
  maxDistanceMeters: number;
  /** 时间区间重叠至少达到该时长才记录同行（毫秒，闭区间） */
  minOverlapMs: number;
  /** 相邻两段同行区间间隔不超过该值则合并（毫秒，闭区间） */
  gapToleranceMs: number;
}

export type SegmentKind = 'stay' | 'move';

/** 停留段/移动段。pointIds 互不重叠地覆盖全部有效点，段按时间首尾相接 */
export interface Segment {
  /** 内容指纹 ID：任一构成点/类型变化都会产生新 ID，未变化则稳定复用 */
  id: string;
  targetId: string;
  kind: SegmentKind;
  startMs: number;
  endMs: number;
  pointIds: string[];
  /** 停留锚点（聚类首点坐标）；移动段为 null */
  anchor: { lng: number; lat: number } | null;
}

export type IssueKind =
  | 'missing-coordinates'
  | 'invalid-timestamp'
  | 'out-of-order'
  | 'jitter';

export type IssueSeverity = 'error' | 'warning';

/** 异常输入的显式暴露记录。error 级异常点不参与分段，但绝不会被静默丢弃 */
export interface ValidationIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  targetId: string;
  pointId: string;
  message: string;
}

export interface SegmentationResult {
  targetId: string;
  segments: Segment[];
  issues: ValidationIssue[];
}

/** 一次同行区间（两个目标在同一地点停留的时间重叠合并结果） */
export interface CompanionInterval {
  id: string;
  targetA: string;
  targetB: string;
  startMs: number;
  endMs: number;
}

/** 引擎使用的全部判定参数 */
export interface EngineParams {
  segmentation: SegmentationParams;
  companionship: CompanionParams;
}

/** 修正点或调整参数后增量重推的可追溯报告 */
export interface IncrementalReport {
  /** 推演版本号，每次修正/参数调整自增 */
  version: number;
  affectedTargets: string[];
  /** 新增或内容发生变化的分段 ID */
  changedSegmentIds: string[];
  /** 消失的旧分段 ID */
  removedSegmentIds: string[];
  /** 未重推、原样复用的分段 ID */
  reusedSegmentIds: string[];
  /** 实际重推的目标对（pairKey，如 "A|B"） */
  recomputedPairs: string[];
  /** 原样复用的目标对 */
  reusedPairs: string[];
  /** 窗口化重推实际覆盖的旧分段下标范围；null 表示该目标全量重推 */
  window: { lo: number; hi: number } | null;
  /** 受影响目标当前的全部异常记录 */
  issues: ValidationIssue[];
}

/** 某一版本下的完整推演结论，可整体快照、比对、归档 */
export interface EngineSnapshot {
  version: number;
  params: EngineParams;
  segmentsByTarget: Record<string, Segment[]>;
  issuesByTarget: Record<string, ValidationIssue[]>;
  /** key 为排序后的目标对 "X|Y" */
  companions: Record<string, CompanionInterval[]>;
}
