/**
 * 确定性排产与工时推演核心。
 *
 * 裁决规则（全部显式、可复现）：
 * 1. 裁决顺序：按 (订单优先级, 订单编号, 工序序号, 工序编号) 的规范顺序
 *    逐道工序裁决，与输入数组的排列顺序无关。
 * 2. 工序先后约束：同一订单内 sequence 更小的工序全部结束后，本工序才可开始。
 * 3. 织机选择：固定指派（pinned）的工序按指定织机与时刻落位；其余工序在
 *    候选织机上取「最早可行开始时刻」，并列时按织机编号稳定裁决。
 * 4. 织机占用冲突：同一台织机上的占用区间不得重叠；可移动工序通过
 *    最早空档搜索自动避让。
 * 5. 无法自动裁决（固定指派互相重叠、固定指派违反先后约束、交付逾期）时，
 *    保留双方/保留安排，并生成带依据的 ConflictRecord，绝不静默择一。
 */
import {
  addWorkMinutes,
  nextWorkingTime,
  workMinutesRequired,
} from './calendar'
import type {
  Allocation,
  AllocationEvidence,
  CandidateEvidence,
  ConflictRecord,
  Loom,
  Operation,
  Order,
  OrderCompletion,
  ScheduleInput,
  ScheduleMeta,
  ScheduleResult,
} from './types'

interface Interval {
  start: number
  end: number
  operationId: string
}

interface EngineContext {
  input: ScheduleInput
  looms: Map<string, Loom>
  orders: Map<string, Order>
  operations: Map<string, Operation>
  /** 规范裁决顺序。 */
  canonical: Operation[]
  canonicalPos: Map<string, number>
  allocations: Map<string, Allocation>
  loomIntervals: Map<string, Interval[]>
  conflicts: ConflictRecord[]
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 归一化输入：复制并按稳定键排序，使结果与调用方给出的数组顺序无关。 */
export function normalizeInput(input: ScheduleInput): ScheduleInput {
  const looms = [...input.looms]
    .map((l) => ({
      ...l,
      workPeriods: [...l.workPeriods].sort((a, b) => a.startMin - b.startMin),
    }))
    .sort((a, b) => compareStrings(a.id, b.id))
  const orders = [...input.orders]
    .map((o) => ({
      ...o,
      operations: [...o.operations]
        .map((op) => ({ ...op, loomIds: [...op.loomIds].sort(compareStrings) }))
        .sort(
          (a, b) => a.sequence - b.sequence || compareStrings(a.id, b.id),
        ),
    }))
    .sort((a, b) => a.priority - b.priority || compareStrings(a.id, b.id))
  return { originDate: input.originDate, looms, orders }
}

function buildContext(input: ScheduleInput): EngineContext {
  const looms = new Map<string, Loom>()
  const orders = new Map<string, Order>()
  const operations = new Map<string, Operation>()
  const canonical: Operation[] = []
  for (const loom of input.looms) looms.set(loom.id, loom)
  for (const order of input.orders) {
    orders.set(order.id, order)
    for (const op of order.operations) {
      operations.set(op.id, op)
      canonical.push(op)
    }
  }
  canonical.sort((a, b) => {
    const oa = orders.get(a.orderId)!
    const ob = orders.get(b.orderId)!
    return (
      oa.priority - ob.priority ||
      compareStrings(a.orderId, b.orderId) ||
      a.sequence - b.sequence ||
      compareStrings(a.id, b.id)
    )
  })
  const canonicalPos = new Map<string, number>()
  canonical.forEach((op, i) => canonicalPos.set(op.id, i))
  const loomIntervals = new Map<string, Interval[]>()
  for (const loom of input.looms) loomIntervals.set(loom.id, [])
  return {
    input,
    looms,
    orders,
    operations,
    canonical,
    canonicalPos,
    allocations: new Map(),
    loomIntervals,
    conflicts: [],
  }
}

function insertInterval(list: Interval[], iv: Interval): void {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].start < iv.start) lo = mid + 1
    else hi = mid
  }
  list.splice(lo, 0, iv)
}

/** 在织机既有占用中寻找不早于 ready 的最早可行空档（确定性）。 */
function earliestSlot(
  loom: Loom,
  intervals: Interval[],
  ready: number,
  workMin: number,
): { start: number; end: number } {
  let t = nextWorkingTime(loom, ready)
  for (const iv of intervals) {
    if (iv.end <= t) continue
    const end = addWorkMinutes(loom, t, workMin)
    if (end <= iv.start) return { start: t, end }
    t = nextWorkingTime(loom, Math.max(t, iv.end))
  }
  return { start: t, end: addWorkMinutes(loom, t, workMin) }
}

function readyTimeOf(ctx: EngineContext, op: Operation): number {
  const order = ctx.orders.get(op.orderId)!
  let ready = 0
  for (const pred of order.operations) {
    if (pred.sequence >= op.sequence) continue
    const alloc = ctx.allocations.get(pred.id)
    if (!alloc) {
      throw new Error(
        `工序 ${pred.id} 应先于 ${op.id} 完成裁决，规范顺序被破坏`,
      )
    }
    if (alloc.endMin > ready) ready = alloc.endMin
  }
  return ready
}

function recordConflict(ctx: EngineContext, conflict: ConflictRecord): void {
  ctx.conflicts.push(conflict)
}

function scheduleOperation(ctx: EngineContext, op: Operation): void {
  const ready = readyTimeOf(ctx, op)

  if (op.pinned) {
    const loom = ctx.looms.get(op.pinned.loomId)
    if (!loom) {
      throw new Error(`工序 ${op.id} 固定指派的织机不存在: ${op.pinned.loomId}`)
    }
    const workMin = workMinutesRequired(op.baseMinutes, loom)
    const start = op.pinned.startMin
    const end = addWorkMinutes(loom, start, workMin)
    const evidence: AllocationEvidence = {
      readyMin: ready,
      candidates: [
        { loomId: loom.id, earliestStartMin: start, endMin: end },
      ],
      chosen: 'pinned',
      note: '固定指派：按指定织机与时刻落位，冲突不自动规避',
    }
    const alloc: Allocation = {
      operationId: op.id,
      orderId: op.orderId,
      loomId: loom.id,
      startMin: start,
      endMin: end,
      workMinutes: workMin,
      evidence,
    }
    // 与既有占用重叠：保留双方，记录可追溯依据。
    for (const iv of ctx.loomIntervals.get(loom.id)!) {
      if (iv.end <= start || iv.start >= end) continue
      const other = ctx.allocations.get(iv.operationId)!
      recordConflict(ctx, {
        id: `pinned-overlap:${[op.id, iv.operationId].sort().join(':')}`,
        type: 'pinned-overlap',
        kept: [op.id, iv.operationId].sort(),
        summary: `固定指派工序 ${op.id} 与工序 ${iv.operationId} 在织机 ${loom.id} 上占用重叠，双方均保留`,
        evidence: {
          loomId: loom.id,
          pinnedOperationId: op.id,
          otherOperationId: iv.operationId,
          pinnedInterval: `${start}-${end}`,
          otherInterval: `${other.startMin}-${other.endMin}`,
          overlapStartMin: Math.max(start, other.startMin),
          overlapEndMin: Math.min(end, other.endMin),
        },
      })
    }
    if (start < ready) {
      recordConflict(ctx, {
        id: `pinned-precedence:${op.id}`,
        type: 'pinned-precedence',
        kept: [op.id],
        summary: `固定指派工序 ${op.id} 的开始时刻早于其前置工序完成时刻，按指派保留`,
        evidence: {
          operationId: op.id,
          pinnedStartMin: start,
          readyMin: ready,
          violationMin: ready - start,
        },
      })
    }
    ctx.allocations.set(op.id, alloc)
    insertInterval(ctx.loomIntervals.get(loom.id)!, {
      start,
      end,
      operationId: op.id,
    })
    return
  }

  const candidates: CandidateEvidence[] = []
  for (const loomId of op.loomIds) {
    const loom = ctx.looms.get(loomId)
    if (!loom) throw new Error(`工序 ${op.id} 引用了不存在的织机: ${loomId}`)
    const workMin = workMinutesRequired(op.baseMinutes, loom)
    const slot = earliestSlot(loom, ctx.loomIntervals.get(loomId)!, ready, workMin)
    candidates.push({
      loomId,
      earliestStartMin: slot.start,
      endMin: slot.end,
    })
  }
  candidates.sort(
    (a, b) =>
      a.earliestStartMin - b.earliestStartMin || compareStrings(a.loomId, b.loomId),
  )
  const chosen = candidates[0]
  const tieBroken =
    candidates.length > 1 &&
    candidates[1].earliestStartMin === chosen.earliestStartMin
  const loom = ctx.looms.get(chosen.loomId)!
  const workMin = workMinutesRequired(op.baseMinutes, loom)
  const evidence: AllocationEvidence = {
    readyMin: ready,
    candidates,
    chosen: op.loomIds.length === 1 ? 'single-candidate' : 'earliest-start',
    ...(tieBroken ? { tieBroken: true as const, note: '最早开始时刻并列，按织机编号稳定裁决' } : {}),
  }
  const alloc: Allocation = {
    operationId: op.id,
    orderId: op.orderId,
    loomId: chosen.loomId,
    startMin: chosen.earliestStartMin,
    endMin: chosen.endMin,
    workMinutes: workMin,
    evidence,
  }
  ctx.allocations.set(op.id, alloc)
  insertInterval(ctx.loomIntervals.get(chosen.loomId)!, {
    start: alloc.startMin,
    end: alloc.endMin,
    operationId: op.id,
  })
}

function buildResult(
  ctx: EngineContext,
  meta: ScheduleMeta,
  carriedConflicts: ConflictRecord[],
): ScheduleResult {
  const completions: OrderCompletion[] = []
  for (const order of ctx.input.orders) {
    let completed = 0
    for (const op of order.operations) {
      const alloc = ctx.allocations.get(op.id)
      if (alloc && alloc.endMin > completed) completed = alloc.endMin
    }
    const late = order.dueMin !== undefined && completed > order.dueMin
    completions.push({
      orderId: order.id,
      completedMin: completed,
      ...(order.dueMin !== undefined ? { dueMin: order.dueMin } : {}),
      late,
      ...(late ? { delayMin: completed - (order.dueMin ?? 0) } : {}),
    })
    if (late) {
      carriedConflicts.push({
        id: `due-violation:${order.id}`,
        type: 'due-violation',
        kept: [order.id],
        summary: `订单 ${order.id} 完成时刻 ${completed} 超过交付时刻 ${order.dueMin}，安排保留并记录`,
        evidence: {
          orderId: order.id,
          completedMin: completed,
          dueMin: order.dueMin ?? 0,
          delayMin: completed - (order.dueMin ?? 0),
        },
      })
    }
  }
  completions.sort((a, b) => compareStrings(a.orderId, b.orderId))

  const conflicts = [...ctx.conflicts, ...carriedConflicts].sort((a, b) =>
    compareStrings(a.id, b.id),
  )

  const loomPlans: Record<string, Allocation[]> = {}
  for (const loom of ctx.input.looms) {
    loomPlans[loom.id] = (ctx.loomIntervals.get(loom.id) ?? []).map(
      (iv) => ctx.allocations.get(iv.operationId)!,
    )
  }
  const allocations = ctx.input.looms.flatMap((loom) => loomPlans[loom.id])

  return {
    allocations,
    loomPlans,
    completions,
    conflicts,
    meta,
    input: ctx.input,
  }
}

export interface FrozenState {
  /** 已裁决且本轮不得改动的占用（局部重算时复用的前缀）。 */
  allocations: Allocation[]
  /** 与冻结占用相关的既有冲突记录，原样保留。 */
  conflicts: ConflictRecord[]
}

/**
 * 在既有冻结占用的前提下推演剩余工序。
 * 完整推演等价于 frozen 为空；局部重算与完整推演共用同一条裁决路径，
 * 保证两条路径的结果一致。
 */
export function runSchedule(
  rawInput: ScheduleInput,
  frozen: FrozenState = { allocations: [], conflicts: [] },
  meta?: Partial<ScheduleMeta>,
): ScheduleResult {
  const input = normalizeInput(rawInput)
  const ctx = buildContext(input)
  for (const alloc of frozen.allocations) {
    ctx.allocations.set(alloc.operationId, alloc)
    insertInterval(ctx.loomIntervals.get(alloc.loomId)!, {
      start: alloc.startMin,
      end: alloc.endMin,
      operationId: alloc.operationId,
    })
  }
  const frozenIds = new Set(frozen.allocations.map((a) => a.operationId))
  for (const op of ctx.canonical) {
    if (frozenIds.has(op.id)) continue
    scheduleOperation(ctx, op)
  }
  const fullMeta: ScheduleMeta = {
    mode: 'full',
    reason: '整体推演',
    changedLoomIds: [],
    changedOperationIds: [],
    recomputedOperationIds: ctx.canonical.map((op) => op.id),
    reusedOperationIds: [],
    ...meta,
  }
  return buildResult(ctx, fullMeta, [...frozen.conflicts])
}

/** 整体推演：同一输入在任何入口得到同一结果。 */
export function schedule(input: ScheduleInput): ScheduleResult {
  return runSchedule(input)
}

export const __internals = { buildContext, normalizeInput, compareStrings }
