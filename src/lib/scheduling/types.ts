/**
 * 织造排产与工时推演的领域模型。
 *
 * 该模块不依赖任何界面状态、全局对象或当前时间：同样的输入必然产生
 * 同样的输出（确定性），可在浏览器、Node HTTP 服务与 CLI 中直接调用。
 *
 * 时间一律使用「自推演原点起的分钟数」表示，原点由 ScheduleInput.originDate
 * 给出（仅用于展示换算），推演本身不读取系统时钟。
 */

/** 织机每个工作日的可用时段（按日重复），分钟数为自当日 00:00 起的偏移。 */
export interface WorkPeriod {
  startMin: number
  endMin: number
}

export interface Loom {
  id: string
  name: string
  /** 效率系数：>0。工序在该织机上所需工作台时 = ceil(baseMinutes / efficiency)。 */
  efficiency: number
  /** 该织机每个工作日的可用窗口，按 startMin 升序、互不重叠。 */
  workPeriods: WorkPeriod[]
  /** 从第几天开始可用（相对原点），缺省为 0。 */
  availableFromDay?: number
}

export interface PinnedAssignment {
  loomId: string
  startMin: number
}

export interface Operation {
  id: string
  orderId: string
  /** 工序名称，如 挑经 / 引纬 / 织造 / 收卷。 */
  name: string
  /** 同一订单内的先后次序，小者先做；构成工序先后约束。 */
  sequence: number
  /** 标准工时（分钟，效率 1.0 时所需的织机工作台时）。 */
  baseMinutes: number
  /** 候选织机。单元素表示该工序只能在指定织机上进行。 */
  loomIds: string[]
  /** 固定指派：占用指定织机的指定起始时刻，即使冲突也保留双方。 */
  pinned?: PinnedAssignment
}

export interface Order {
  id: string
  name: string
  /** 排产优先级，数值小者先裁决。 */
  priority: number
  /** 交付时刻（自原点起的分钟数）；完成时刻超过该值产生可追溯的逾期裁决记录。 */
  dueMin?: number
  operations: Operation[]
}

export interface ScheduleInput {
  /** 推演原点日期 YYYY-MM-DD，仅用于展示换算，不参与裁决。 */
  originDate: string
  looms: Loom[]
  orders: Order[]
}

export interface CandidateEvidence {
  loomId: string
  earliestStartMin: number
  endMin: number
}

export interface AllocationEvidence {
  /** 因工序先后约束允许的最早开始时刻。 */
  readyMin: number
  /** 各候选织机上的最早可行时刻，按裁决规则排序。 */
  candidates: CandidateEvidence[]
  chosen: 'pinned' | 'earliest-start' | 'single-candidate'
  /** 是否因并列而按织机编号做了稳定裁决。 */
  tieBroken?: boolean
  note?: string
}

/** 一道工序在一台织机上的一段占用。一道工序有且仅有一条占用记录。 */
export interface Allocation {
  operationId: string
  orderId: string
  loomId: string
  startMin: number
  endMin: number
  /** 实际占用的织机工作台时（分钟）。 */
  workMinutes: number
  evidence: AllocationEvidence
}

export type ConflictType =
  | 'pinned-overlap'
  | 'pinned-precedence'
  | 'due-violation'

/** 无法自动裁决时保留双方（或保留逾期安排）并记录可追溯依据。 */
export interface ConflictRecord {
  id: string
  type: ConflictType
  /** 被同时保留的双方：工序 id（pinned 类）或订单 id（逾期类）。 */
  kept: string[]
  summary: string
  evidence: Record<string, number | string | string[]>
}

export interface OrderCompletion {
  orderId: string
  /** 完成时刻 = 该订单最后一道工序的结束时刻。 */
  completedMin: number
  dueMin?: number
  late: boolean
  delayMin?: number
}

export interface ScheduleMeta {
  mode: 'full' | 'incremental' | 'violations-only' | 'unchanged'
  reason: string
  changedLoomIds: string[]
  changedOperationIds: string[]
  /** 本次重新推演的工序（受影响订单与时间段）。 */
  recomputedOperationIds: string[]
  /** 直接复用上一轮结果的工序。 */
  reusedOperationIds: string[]
  /** 局部重算的时间起点（自原点起分钟），即受影响时间段的起点。 */
  horizonMin?: number
}

export interface ScheduleResult {
  /** 按 (织机, 开始时刻) 排序的全部占用，供整体比对。 */
  allocations: Allocation[]
  /** 每台织机的占用顺序。 */
  loomPlans: Record<string, Allocation[]>
  completions: OrderCompletion[]
  conflicts: ConflictRecord[]
  meta: ScheduleMeta
  /** 归一化后的输入快照，供下一轮增量差异检测；也是裁决可追溯输入的一部分。 */
  input: ScheduleInput
}
