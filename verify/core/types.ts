/**
 * 三维时序回放与关键事件定位工作台 —— 判定链路核心类型。
 * 本目录（verify/）为离线批量验证能力：纯函数实现，无任何外部依赖，
 * 不访问网络，可用 `npm run verify` 直接批量执行全部用例。
 */

/** 空间记录：某对象在某时刻的一次状态观测。 */
export interface SpatialRecord {
  id: string;
  objectId: string;
  /** 逻辑时间戳（毫秒或任意单调序号）。 */
  timestamp: number;
  /** 状态载荷，同一对象同一时刻出现不同 state 即构成矛盾记录。 */
  state: string;
  /** 该记录推导所依赖的其他记录 id（关联推导边）。 */
  dependsOn?: string[];
}

/** 关键事件：通过记录或对象关联到回放时间线。 */
export interface KeyEvent {
  id: string;
  timestamp: number;
  /** 事件关联的记录 id。 */
  linkedRecordIds?: string[];
  /** 事件直接关联的对象 id。 */
  linkedObjectIds?: string[];
}

/** 导入输入：支持任意批次切分。 */
export interface ImportInput {
  records?: SpatialRecord[];
  events?: KeyEvent[];
}

export type AnomalyKind = 'missing-ref' | 'self-ref' | 'cycle';

/**
 * 可追溯异常：任何指向缺失 / 自引用 / 成环都必须落成 Anomaly，
 * 携带归属主体与完整引用路径，绝不静默跳过。
 */
export interface Anomaly {
  kind: AnomalyKind;
  /** 异常归属主体：'record:<id>' 或 'event:<id>'。 */
  owner: string;
  /** 触发异常的引用路径（成环时为环上节点序列）。 */
  path: string[];
  message: string;
}

export interface TimelineEntry {
  timestamp: number;
  /** 裁决前双方保留；裁决后仅保留胜方。 */
  states: string[];
  /** 裁决后指向保留记录 id，未裁决为 null。 */
  adjudicated: string | null;
}

export interface ConflictGroup {
  objectId: string;
  timestamp: number;
  /** 参与矛盾的记录 id（双方均保留）。 */
  recordIds: string[];
  states: string[];
  resolved: boolean;
  winnerId: string | null;
}

export interface EventImpact {
  eventId: string;
  objectIds: string[];
  interval: { start: number; end: number };
  derivedFromRecords: string[];
  derivedFromObjects: string[];
  withdrawn: boolean;
}

/** 回放结论：跨导入顺序 / 批次切分必须完全一致（经 canonical 序列化比对）。 */
export interface ReplayConclusion {
  timelines: Record<string, TimelineEntry[]>;
  conflicts: Record<string, ConflictGroup>;
  eventImpacts: Record<string, EventImpact>;
  anomalies: Anomaly[];
}

export interface Scope {
  objectIds: string[];
  intervals: Record<string, { start: number; end: number }>;
}

export interface ImportResult {
  records: Map<string, SpatialRecord>;
  events: Map<string, KeyEvent>;
  anomalies: Anomaly[];
  /** 清洗后的推导边：childId -> parentIds（缺失 / 自引用 / 成环边已剔除）。 */
  edges: Map<string, string[]>;
}
