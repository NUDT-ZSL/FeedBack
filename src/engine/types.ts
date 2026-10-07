// ---------------------------------------------------------------------------
// 背压推演引擎 · 数据模型
// 时间模型：离散整数 tick（毫秒）。所有输入时间非整数时向下取整并记录 issue。
// ---------------------------------------------------------------------------

export type Tick = number;

/** 输入事件：来源标识 + 到达时刻 + 事件体 */
export interface StreamEvent {
  id: string;
  /** 来源标识；缺失/空字符串时归入保留来源 "__unknown__" 并记录 issue */
  source: string;
  /** 到达时刻（tick），允许乱序，引擎按 (tick, 原始序号) 稳定排序 */
  tick: number;
  /** 事件体 */
  payload?: unknown;
}

export type ActionKind = 'drop' | 'downsample' | 'expand' | 'pause';

/** 档位处置动作 */
export interface ActionSpec {
  kind: ActionKind;
  /** drop: 每 tick 丢弃最新到达事件的比例 (0,1] */
  dropRatio?: number;
  /** downsample: 每 k 条保留 1 条（确定性，序号自档位生效起重新计数） */
  keepEvery?: number;
  /** expand: 缓冲扩容增量（条） */
  expandBy?: number;
  /** pause: 暂停该来源摄入的时长（tick），期间到达事件暂存，恢复后按序补入 */
  pauseTicks?: number;
}

/** 消费速率档位 */
export interface TierConfig {
  id: string;
  label?: string;
  /** 该档位下的消费速率（事件/tick） */
  rate: number;
  /** 积压上阈值：backlog > upThreshold 时该档位变为可选 */
  upThreshold: number;
  /** 积压下阈值（滞回）：backlog < downThreshold 时该档位不再可选；缺省 = upThreshold */
  downThreshold?: number;
  /** 进入该档位后执行的处置动作 */
  action?: ActionSpec;
  /** 显式切换边：仅允许切往列出的档位；设置后完全替代默认阶梯邻接 */
  allowedNext?: string[];
}

export interface SourceConfig {
  id: string;
  /** 基础缓冲容量（条），缺省 Infinity；expand 动作在此基础上累加 */
  baseCapacity?: number;
}

/** 人工裁决：针对一次冲突判定的覆盖决定 */
export interface ManualAdjudication {
  /** 裁决键：来源 + 触发时刻（冲突判定的稳定标识） */
  source: string;
  tick: Tick;
  /** 强制选用的档位 id */
  chosenTierId: string;
  /** 裁决理由（可追溯） */
  reason?: string;
}

export interface ScenarioConfig {
  tiers: TierConfig[];
  sources?: SourceConfig[];
  /** 时间轴上限；缺省 = 事件最大时刻 + 最大 pauseTicks + 1，且不超过 MAX_TICKS */
  horizon?: Tick;
  /** 增量推导的分块大小（tick），缺省 64 */
  blockSize?: number;
  adjudications?: ManualAdjudication[];
}

export interface Scenario {
  id: string;
  config: ScenarioConfig;
  events: StreamEvent[];
}

// ---------------------------------------------------------------------------
// 校验问题：所有异常输入都显式记录，绝不静默跳过
// ---------------------------------------------------------------------------

export type IssueSeverity = 'warning' | 'error';

export interface ValidationIssue {
  severity: IssueSeverity;
  code:
    | 'EVENT_MISSING_SOURCE'
    | 'EVENT_DUPLICATE_ID'
    | 'EVENT_NON_INTEGER_TICK'
    | 'EVENT_NEGATIVE_TICK'
    | 'EVENT_BEYOND_HORIZON'
    | 'TIER_DUPLICATE_ID'
    | 'TIER_INVALID_RATE'
    | 'TIER_INVALID_THRESHOLD'
    | 'TIER_THRESHOLD_OVERLAP'
    | 'TIER_NO_BASE'
    | 'TIER_EDGE_UNKNOWN_TARGET'
    | 'TIER_EDGE_CYCLE'
    | 'TIER_ACTION_INVALID'
    | 'ADJUDICATION_UNMATCHED'
    | 'HORIZON_TRUNCATED'
    | 'BACKLOG_REMAINING';
  message: string;
  source?: string;
  eventId?: string;
  tierId?: string;
  tick?: Tick;
}

// ---------------------------------------------------------------------------
// 处置决策与切换记录
// ---------------------------------------------------------------------------

/** 一次档位切换记录：时刻、触发依据、受影响事件区间 */
export interface SwitchRecord {
  /** 稳定 id：来源内切换序号，如 "srcA#3" */
  id: string;
  source: string;
  /** 切换生效时刻（评估发生于 tick-1 结束，作用于 [tick, ...) */
  tick: Tick;
  fromTier: string;
  toTier: string;
  /** 触发依据 */
  basis: {
    backlog: number;
    upThreshold: number;
    downThreshold: number;
    candidates: string[];
  };
  /** 受影响事件区间 [affectedFrom, affectedTo]，affectedTo 在窗口关闭时回填 */
  affectedFrom: Tick;
  affectedTo: Tick;
  /** 受影响事件数（窗口关闭时回填） */
  affectedEventCount: number;
  /** 是否为冲突判定（多候选并列） */
  conflict: boolean;
  /** 冲突候选（含被否决方） */
  conflictCandidates?: string[];
  /** 人工裁决结果 */
  adjudication?: { chosenTierId: string; reason?: string };
}

/** 对单个事件的一次处置决策（同一事件可被多次决策覆盖） */
export interface Decision {
  switchId: string;
  tierId: string;
  action: ActionKind | 'admit';
  tick: Tick;
  /** 决策来源：auto 自动判定 / manual 人工裁决 */
  origin: 'auto' | 'manual';
  /** 补充说明（如容量溢出丢弃、降采样保留等） */
  detail?: string;
}

export type EventDisposition = 'kept' | 'dropped' | 'consumed';

export interface EventResult {
  id: string;
  source: string;
  tick: Tick;
  /** 最终生效结论 */
  disposition: EventDisposition;
  /** 完整决策链（按时间序），可追溯 */
  decisions: Decision[];
  /** 最终生效的切换 id（被消费时为空） */
  effectiveSwitchId?: string;
}

export interface BacklogSample {
  tick: Tick;
  backlog: number;
  capacity: number;
  tierId: string;
  paused: boolean;
}

export interface SourceResult {
  source: string;
  samples: BacklogSample[];
  switches: SwitchRecord[];
  events: EventResult[];
  stats: {
    total: number;
    kept: number;
    dropped: number;
    consumed: number;
    /** 时间轴结束时仍滞留缓冲的事件数 */
    pending: number;
  };
}

export interface DeriveResult {
  scenarioId: string;
  horizon: Tick;
  sources: Record<string, SourceResult>;
  switches: SwitchRecord[];
  issues: ValidationIssue[];
  /** 增量推导信息 */
  incremental?: {
    reusedBlocks: number;
    recomputedBlocks: number;
    affectedSources: string[];
    affectedFromTick: Tick | null;
  };
}

// ---------------------------------------------------------------------------
// 增量推导：分块与进位状态
// ---------------------------------------------------------------------------

/** 块边界进位状态：使块可独立重算并拼接 */
export interface CarryState {
  tick: Tick;
  /** 已准入、排队待消费的真实事件（有序） */
  queued: StreamEvent[];
  capacity: number;
  tierId: string;
  pausedUntil: Tick;
  /** 暂停期间暂存、尚未准入的事件 */
  held: StreamEvent[];
  /** downsample 计数器（当前档位窗口内已见事件数） */
  downsampleCounter: number;
  /** drop 门控计数器 */
  dropCounter: number;
  /** 消费速率小数累加器（支持非整数速率） */
  rateCarry: number;
  /** 当前档位窗口起始 tick */
  windowStart: Tick;
  /** 当前窗口已影响事件数 */
  windowAffected: number;
  /** 来源内切换序号 */
  switchSeq: number;
  /** 当前窗口档位的选定来源（人工裁决优先） */
  windowOrigin: 'auto' | 'manual';
  /** 尚未关闭的切换窗口记录（关闭时推入所属块的 switches） */
  openSwitch: SwitchRecord | null;
}

export interface BlockOutput {
  startTick: Tick;
  endTick: Tick;
  /** 块输入指纹：块内事件 + 全局配置 */
  inputHash: string;
  /** 块起始进位（复用判定依据） */
  carryIn: CarryState;
  samples: BacklogSample[];
  switches: SwitchRecord[];
  /** 事件结论增量：事件 id -> 决策与最终结论 */
  eventResults: EventResult[];
  carryOut: CarryState;
}

export interface SourceBlocks {
  source: string;
  /** 输入指纹：事件序列 + 来源配置 + 相关档位配置 */
  inputHash: string;
  blocks: BlockOutput[];
  result: SourceResult;
}

export interface DeriveState {
  scenarioId: string;
  configHash: string;
  blockSize: number;
  horizon: Tick;
  sources: Record<string, SourceBlocks>;
  result: DeriveResult;
}

export const UNKNOWN_SOURCE = '__unknown__';
export const MAX_TICKS = 100000;
