/**
 * 背压推演引擎 —— 核心类型定义。
 * 引擎为纯函数式、可离线运行（浏览器与 Node 均可），不依赖任何 DOM API。
 */

/** 缺失来源标识的事件统一归入该保留来源（显式处置，不静默丢弃）。 */
export const UNKNOWN_SOURCE = "__unknown__";

/** 原始输入事件：来源标识、到达时刻、事件体。 */
export interface StreamEvent {
  id: string;
  /** 允许缺失；缺失时归入 UNKNOWN_SOURCE 并记录数据质量问题。 */
  sourceId?: string;
  /** 到达时刻（秒，允许乱序与同一时刻多条并存）。 */
  arrivalTime: number;
  payload?: unknown;
}

export type TierActionType = "drop" | "downsample" | "expandBuffer" | "pauseSource";

export interface TierAction {
  type: TierActionType;
  /** downsample: 保留比例 (0,1]，按确定性规则保留。 */
  keepRatio?: number;
  /** expandBuffer: 生效期间的缓冲容量（事件数）。 */
  capacity?: number;
  /** pauseSource: 暂停的来源；缺省表示暂停全部来源。 */
  sources?: string[];
}

/**
 * 消费档位：积压超过 threshold 时升级到该档位，回落至 releaseBelow 时降级。
 * escalateTo 允许显式指定升级目标（可能成环，需校验/裁决）。
 */
export interface TierConfig {
  id: string;
  label?: string;
  /** 进入该档位的积压阈值（事件数）。 */
  threshold: number;
  /** 回落阈值，缺省等于 threshold（无迟滞）。 */
  releaseBelow?: number;
  /** 该档位生效期间的消费速率（事件/秒）。 */
  consumeRate: number;
  action: TierAction;
  /** 显式升级目标档位 id；缺省按阈值升序取下一档。 */
  escalateTo?: string;
}

export interface SimConfig {
  /** 基础消费速率（事件/秒），未触发任何档位时使用。 */
  baseConsumeRate: number;
  /** 基础缓冲容量（事件数），缺省 +Infinity。 */
  baseCapacity?: number;
  tiers: TierConfig[];
}

/** 数据质量问题（显式记录，不静默跳过）。 */
export interface DataIssue {
  code:
    | "MISSING_SOURCE"
    | "MISSING_ID"
    | "INVALID_TIME"
    | "DUPLICATE_ID"
    | "NEGATIVE_TIME";
  message: string;
  eventIndex: number;
  eventId?: string;
}

/** 配置问题：重叠阈值、成环、悬空目标、非法参数。 */
export interface ConfigIssue {
  code:
    | "TIER_OVERLAP"
    // 多个档位共用同一阈值（同一积压水平触发多个档位）
    | "TIER_CYCLE"      // escalateTo 链成环
    | "DANGLING_TARGET" // escalateTo 指向不存在的档位
    | "INVALID_THRESHOLD"
    | "INVALID_RATE"
    | "INVALID_ACTION";
  message: string;
  tierIds: string[];
  /** 是否必须人工裁决后才能推演。 */
  blocking: boolean;
}

/** 人工裁决：对配置冲突或同刻并发判定给出确定结论。 */
export interface Adjudication {
  id: string;
  /** overlap: 阈值重叠时选定唯一生效档位；cycle: 在环上选定断点。 */
  kind: "overlap" | "cycle";
  /** 冲突锚点：overlap 为共享阈值；cycle 为环上某档位 id。 */
  anchor: number | string;
  /** overlap: 选定的档位 id；cycle: 在该档位处断开（回退到默认升序规则）。 */
  chosenTierId: string;
  note?: string;
}

/** 规范化后的事件：保证 id/sourceId 存在、时间合法、顺序确定。 */
export interface NormEvent {
  id: string;
  sourceId: string;
  arrivalTime: number;
  payload?: unknown;
  /** 输入顺序，用于同时刻事件的确定性排序。 */
  inputIndex: number;
}

export type EventStatus =
  | "kept"            // 正常入队并被消费
  | "dropped-admit"   // 入队时被 drop 档位丢弃
  | "dropped-overflow"// 缓冲容量不足被丢弃
  | "dropped-trim"    // 档位切换收缩容量时被裁掉
  | "downsampled-out" // 被降采样丢弃
  | "held"            // 暂停来源期间被暂存（未进入积压）
  | "queued";         // 仿真结束时仍在队列中

export interface EventDecision {
  eventId: string;
  sourceId: string;
  arrivalTime: number;
  status: EventStatus;
  /** 做出该处置的档位切换记录 id（可追溯依据）。 */
  decidedBy: string;
  /** 该事件经历过的全部处置依据（如先 held 后 kept），按时间顺序。 */
  history?: string[];
  /** 被消费完成的时刻（仅 kept）。 */
  consumedAt?: number;
}

/** 档位切换记录：时刻、方向、触发依据、受影响事件区间。 */
export interface SwitchRecord {
  id: string;
  time: number;
  fromTier: string | null; // null 表示基础档
  toTier: string | null;
  direction: "escalate" | "release" | "adjudicated";
  trigger: {
    backlog: number;
    threshold: number;
    rule: string; // 人类可读的触发依据
  };
  /** 该档位生效的事件区间 [start, end)，end 为下一次切换或仿真结束。 */
  range: { start: number; end: number };
  /** 切换瞬间的副作用（容量收缩裁剪、扩容等）。 */
  effects: { trimmedEventIds: string[]; capacity: number };
  /** 若该切换由人工裁决产生，记录裁决 id。 */
  adjudicationId?: string;
}

/** 积压采样点（事件边界处记录）。 */
export interface BacklogSample {
  time: number;
  total: number;
  perSource: Record<string, number>;
  tierId: string | null;
}

export interface SimResult {
  events: EventDecision[];
  switches: SwitchRecord[];
  series: BacklogSample[];
  issues: DataIssue[];
  configIssues: ConfigIssue[];
  stats: {
    totalEvents: number;
    kept: number;
    dropped: number;
    downsampledOut: number;
    held: number;
    queued: number;
    endTime: number;
  };
}

/** 批量用例：一组事件流 + 一套档位配置 + 可选变更/裁决脚本。 */
export interface BatchCase {
  name: string;
  events: StreamEvent[];
  config: SimConfig;
  adjudications?: Adjudication[];
  /** 变更脚本：用于验证增量重推与整体重推一致。 */
  mutations?: CaseMutation[];
}

export type CaseMutation =
  | { kind: "sourceRate"; sourceId: string; factor: number }
  | { kind: "tierThreshold"; tierId: string; threshold: number }
  | { kind: "tierRate"; tierId: string; consumeRate: number }
  | { kind: "adjudicate"; adjudication: Adjudication };
