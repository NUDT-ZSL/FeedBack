/**
 * 织造排产与工时推演 —— 领域模型定义。
 * 本模块为纯函数式离线引擎，不依赖任何界面状态。
 */

/** 一天内的工作时段，分钟数从当地零点起算（如 480 = 08:00）。 */
export interface WorkWindow {
  startMinute: number;
  endMinute: number;
}

/** 织机工作历：按星期索引（0=周一 … 6=周日）的工作时段列表。 */
export interface WorkCalendar {
  id: string;
  /** 相对 UTC 的固定偏移（分钟），不处理夏令时。 */
  timezoneOffsetMinutes: number;
  days: WorkWindow[][];
}

export interface Loom {
  id: string;
  name: string;
  /** 效率系数，1.0 为标准效率；工时按 workMinutes / efficiency 折算。 */
  efficiency: number;
  calendar: WorkCalendar;
}

export interface Operation {
  id: string;
  orderId: string;
  /** 订单内工序序号，仅用于展示与排序稳定性。 */
  sequence: number;
  name: string;
  /** 可承造的候选织机。 */
  loomIds: string[];
  /** 标准工时（分钟，按效率 1.0 计）。 */
  workMinutes: number;
  /** 前置工序（同订单内），全部完成后本工序才就绪。 */
  dependsOn: string[];
}

export interface Order {
  id: string;
  name: string;
  /** 优先级，数值小者优先。 */
  priority: number;
  /** 交期（ISO 时间）。 */
  dueAt: string;
  /** 可开工时间（ISO 时间）。 */
  releaseAt: string;
}

export interface ScheduleInput {
  looms: Loom[];
  orders: Order[];
  operations: Operation[];
  /** 推演起点（ISO 时间）。 */
  horizonStart: string;
}

/** 一次织机占用（排产结果的基本单元）。 */
export interface ScheduledSegment {
  operationId: string;
  orderId: string;
  loomId: string;
  /** 内部纪元分钟（UTC）。 */
  startMinute: number;
  endMinute: number;
  /** ISO 起止时刻，便于展示与比对。 */
  startAt: string;
  endAt: string;
  /** 是否来自冻结/钉单（局部重算时保留的前置结果）。 */
  pinned: boolean;
}

/** 裁决轨迹：每一次织机竞争、让位、冲突都留痕，保证可追溯。 */
export interface DecisionTrace {
  kind: 'assign' | 'adjudicate' | 'conflict';
  atMinute: number;
  loomId: string;
  operationId: string;
  /** 采用的裁决规则描述。 */
  rule: string;
  /** 人可读的裁决依据。 */
  detail: string;
  /** 同场竞争的其他工序。 */
  contenders: string[];
}

/** 冲突记录：无法裁决时保留双方，并给出可追溯依据。 */
export interface ConflictRecord {
  id: string;
  loomId: string;
  /** 冲突双方（或多方）工序，全部保留。 */
  operationIds: string[];
  interval: { startMinute: number; endMinute: number };
  reason: string;
  adjudication: string;
  /** 结构化证据，便于离线审计。 */
  evidence: Record<string, unknown>;
}

export interface OrderCompletion {
  orderId: string;
  /** 全部工序完成的时刻；存在未排工序时为 null。 */
  completionMinute: number | null;
  completionAt: string | null;
}

export interface ScheduleResult {
  segments: ScheduledSegment[];
  orderCompletions: OrderCompletion[];
  conflicts: ConflictRecord[];
  traces: DecisionTrace[];
  meta: {
    engineVersion: string;
    mode: 'full' | 'incremental';
    /** 输入规范化后的内容哈希，同一批输入必然相同。 */
    inputHash: string;
    /** 结果摘要哈希，用于跨入口一致性比对。 */
    resultDigest: string;
  };
}

/** 参数修正：只声明被修改的字段，引擎据此圈定受影响范围。 */
export interface ScheduleRevision {
  loomEfficiency?: Record<string, number>;
  loomCalendar?: Record<string, WorkCalendar>;
  operationWorkMinutes?: Record<string, number>;
  operationLoomIds?: Record<string, string[]>;
  orderPriority?: Record<string, number>;
  orderDueAt?: Record<string, string>;
}

/** 局部重算圈定的受影响范围。 */
export interface AffectedScope {
  /** 重算时间界（纪元分钟）：此前的排产决定被冻结保留。 */
  fromMinute: number;
  fromAt: string;
  orderIds: string[];
  operationIds: string[];
}

export interface IncrementalResult {
  result: ScheduleResult;
  affected: AffectedScope;
}
