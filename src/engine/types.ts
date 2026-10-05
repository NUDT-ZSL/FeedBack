/** 离线事件流：原始事件 */
export interface StreamEvent {
  id: string;
  source: string;
  /** 到达时刻，ms */
  timestamp: number;
  /** 工作量（积压单位） */
  size: number;
  kind?: string;
  payload?: string;
}

/** 裁决动作 */
export type AdjudicationAction =
  | { type: 'keep'; eventId: string }
  | { type: 'keepAll' }
  | { type: 'dropAll' };

/** 同一来源同一时刻的重复/冲突组 */
export interface ConflictGroup {
  /** `${source}@${timestamp}` */
  key: string;
  source: string;
  timestamp: number;
  /** duplicate=内容完全一致；conflict=内容冲突 */
  kind: 'duplicate' | 'conflict';
  eventIds: string[];
  /** pending=待裁决（双方保留，不参与背压结论）；resolved=已裁决 */
  status: 'pending' | 'resolved';
  resolution?: AdjudicationAction;
}

/** 事件集合（不可变，每次修正 version+1） */
export interface EventSet {
  version: number;
  events: StreamEvent[];
  conflicts: ConflictGroup[];
}

/** 引擎参数（每次调整 version+1） */
export interface EngineParams {
  version: number;
  /** 区间长度 ms */
  tickMs: number;
  /** 每区间消费量 */
  consumeRate: number;
  /** 积压超过该值触发背压 */
  highThreshold: number;
  /** 积压回落到该值（含）以下解除背压 */
  lowThreshold: number;
  /** 单区间突发上限，超出部分顺延到后续区间 */
  burstLimit: number;
}

/** 积压曲线上的一个区间点 */
export interface CurvePoint {
  tick: number;
  time: number;
  /** 本区间实际准入的到达量 */
  arrivals: number;
  /** 上一区间顺延而来的量 */
  spilledIn: number;
  /** 顺延到下一区间的量 */
  spilledOut: number;
  /** 本区间消费量 */
  consumed: number;
  /** 区间末积压 */
  backlog: number;
  /** 含待裁决事件，不参与背压结论 */
  disputed: boolean;
  /** 区间末背压是否处于激活态 */
  bpActive: boolean;
}

export type DecisionType = 'trigger' | 'release';

/** 背压触发/解除决策（含处置结论与判定依据） */
export interface Decision {
  seq: number;
  tick: number;
  time: number;
  type: DecisionType;
  /** 处置结论 */
  action: string;
  backlog: number;
  threshold: number;
  thresholdKind: 'high' | 'low';
  /** 可解释依据：哪个区间、哪条阈值、当时积压多少 */
  explanation: string;
  /** 结论依据的版本，保证可追溯 */
  basis: { eventsVersion: number; paramsVersion: number };
}

export interface Derivation {
  curve: CurvePoint[];
  decisions: Decision[];
  disputedTicks: number[];
  stats: {
    peakBacklog: number;
    peakTick: number;
    /** 本次实际重推的区间数 */
    rederivedTicks: number;
    /** 从上一结果直接复用的区间数 */
    reusedTicks: number;
  };
  basis: { eventsVersion: number; paramsVersion: number };
}
