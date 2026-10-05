/** 离线事件流背压引擎 —— 核心类型定义 */

/** 输入事件：按到达时刻进入事件集合 */
export interface StreamEvent {
  id: string;
  /** 事件来源（同一来源同一时刻用于判重/判冲突） */
  source: string;
  /** 到达时刻（秒） */
  time: number;
  /** 事件体积（积压增量） */
  size: number;
  /** 内容指纹，用于区分"重复"与"冲突" */
  payload: string;
}

/** 同一来源同一时刻的重复/冲突事件组：双方保留，裁决前为 pending */
export interface ConflictGroup {
  id: string;
  source: string;
  time: number;
  /** 组内全部事件（>=2，均不丢弃） */
  events: StreamEvent[];
  /** duplicate=内容完全一致；conflict=内容不一致 */
  kind: 'duplicate' | 'conflict';
  status: 'pending' | 'resolved';
  /** 裁决后保留的事件 id */
  resolvedEventId?: string;
}

/** 背压调节参数 */
export interface Params {
  /** 消费速率（单位/秒） */
  consumeRate: number;
  /** 背压触发阈值（积压量） */
  threshold: number;
  /** 突发上限（单个时刻允许的最大瞬时到达量） */
  burstLimit: number;
}

/** 参数版本：从 fromTime 起生效 */
export interface ParamsVersion {
  params: Params;
  version: number;
  fromTime: number;
}

/** 每条结论都记录其计算依据的版本，保证可追溯 */
export interface Basis {
  eventVersion: number;
  paramsVersion: number;
}

/** 背压决策（触发/解除/突发越限），携带可解释依据 */
export interface Decision {
  id: string;
  kind: 'trigger' | 'release' | 'burst';
  intervalIndex: number;
  /** 决策发生的精确时刻 */
  time: number;
  /** 决策时刻的积压量 */
  backlog: number;
  /** 命中的规则标识 */
  rule: 'threshold-exceeded' | 'threshold-reached-below' | 'burst-limit-exceeded';
  /** 人类可读依据：哪个区间、哪条阈值、当时积压多少 */
  explanation: string;
  basis: Basis;
}

/** 单个时间区间的推算结果 */
export interface IntervalResult {
  index: number;
  start: number;
  end: number;
  /** 计入推算的到达量 */
  arrivals: number;
  /** 因待裁决被排除的到达量 */
  excludedArrivals: number;
  /** 区间内是否含待裁决冲突（裁决前不参与背压结论） */
  tainted: boolean;
  /** 区间是否暂缓给出背压结论 */
  withheld: boolean;
  carryIn: number;
  peak: number;
  carryOut: number;
  backpressureActiveIn: boolean;
  backpressureActiveOut: boolean;
  decisions: Decision[];
  basis: Basis;
  /** 增量重推时该区间结果是否复用自缓存（未受影响） */
  reusedFromCache: boolean;
}

/** 一次推算的完整输出（增量与整体两条路径共用同一结构） */
export interface EngineResult {
  intervals: IntervalResult[];
  decisions: Decision[];
  /** 积压曲线采样点（分段线性，到达时刻有垂直跳变） */
  curve: Array<{ time: number; backlog: number }>;
  currentBacklog: number;
  totalArrived: number;
  totalConsumed: number;
  eventVersion: number;
  paramsVersion: number;
}
