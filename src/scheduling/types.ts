/**
 * 织造排产与工时推演 —— 领域模型与结果类型。
 * 本模块为纯 TypeScript，不依赖 DOM / React，可在 Node 下离线运行。
 */

/** 织机 */
export interface Loom {
  id: string;
  name: string;
  /** 每日可用分钟数（单班 480 / 双班 960 等） */
  dailyCapacityMinutes: number;
}

/** 织机对某工序类型的承接能力，priority 数值越小优先级越高 */
export interface Capability {
  loomId: string;
  processType: string;
  priority: number;
}

/** 订单 */
export interface Order {
  id: string;
  name: string;
  /** 投料时刻（分钟，自推演纪元起算） */
  releaseMinute: number;
  /** 交期（分钟），用于工时结论中的交期风险判定 */
  dueMinute: number;
}

/** 工序 */
export interface ProcessStep {
  id: string;
  orderId: string;
  /** 工序类型，用于匹配织机能力 */
  processType: string;
  /** 标准工时（分钟） */
  standardMinutes: number;
  /** 前置工序 id 列表（同订单或跨订单均可） */
  dependsOn: string[];
}

/** 推演输入：同一批织机、订单与工序数据 */
export interface SchedulingInput {
  looms: Loom[];
  orders: Order[];
  steps: ProcessStep[];
  capabilities: Capability[];
}

/** 校验发现：error 为致命（拒绝排产），warning 为可裁决（继续排产并记录裁决依据） */
export interface Finding {
  severity: 'error' | 'warning';
  code:
    | 'MISSING_LOOM_REF'
    | 'MISSING_STEP_REF'
    | 'MISSING_ORDER_REF'
    | 'DEPENDENCY_CYCLE'
    | 'CAPABILITY_GAP'
    | 'PRIORITY_CONFLICT'
    | 'INVALID_FIELD'
    | 'DUPLICATE_ID';
  message: string;
  /** 关联实体 id，用于失败定位 */
  refs: string[];
}

/** 候选织机裁决记录中的一条候选 */
export interface CandidateVerdict {
  loomId: string;
  priority: number;
  outcome: 'selected' | 'rejected';
  reason: string;
}

/** 顺延依据：开工为何晚于前置就绪时刻 */
export interface DelayBasis {
  /** 因前置/投料约束就绪的时刻 */
  readyMinute: number;
  /** 实际开工时刻 */
  startMinute: number;
  /** 顺延分钟数（0 表示未顺延） */
  delayMinutes: number;
  /** 顺延原因；无顺延为空串 */
  reason: string;
}

/** 单条工序的排产结论 */
export interface ScheduledStep {
  stepId: string;
  orderId: string;
  processType: string;
  loomId: string;
  startMinute: number;
  endMinute: number;
  /** 占用工时（分钟），等于标准工时 */
  workMinutes: number;
  delay: DelayBasis;
}

/** 织机维度工时结论 */
export interface LoomSummary {
  loomId: string;
  busyMinutes: number;
  idleMinutes: number;
  utilization: number;
}

/** 订单维度工时结论 */
export interface OrderSummary {
  orderId: string;
  workMinutes: number;
  makespanEnd: number;
  dueMinute: number;
  lateMinutes: number;
}

/** 推演输出 */
export interface ScheduleResult {
  ok: boolean;
  findings: Finding[];
  /** 按 (startMinute, stepId) 排序的可执行档期 */
  entries: ScheduledStep[];
  /** 裁决依据（含优先级冲突的完整候选比较过程） */
  adjudications: Adjudication[];
  loomSummaries: LoomSummary[];
  orderSummaries: OrderSummary[];
}

/** 一条裁决记录：某工序为何落到某台织机 */
export interface Adjudication {
  stepId: string;
  processType: string;
  selectedLoomId: string;
  candidates: CandidateVerdict[];
  reason: string;
}

/** 局部调整描述 */
export type SchedulingChange =
  | { kind: 'dependency'; stepId: string; dependsOn: string[] }
  | { kind: 'capability'; loomId: string; processType: string; priority: number | null };

/** 增量重推结果 */
export interface IncrementalResult {
  ok: boolean;
  findings: Finding[];
  /** 本次实际重推的工序 id（受影响集合） */
  affectedStepIds: string[];
  result: ScheduleResult;
}
