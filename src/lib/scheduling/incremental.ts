/**
 * 参数修正后的局部重算。
 *
 * 差异检测：对比上一轮结果中的输入快照与新输入，识别变更的织机与工序。
 *
 * 重算范围（可证明与整体重算一致）：
 * - 规范裁决顺序仅由 (优先级, 订单号, 工序序号, 工序号) 决定；工时类参数
 *   （工序标准工时、织机效率、织机工作时段）的修正不会改变该顺序。
 * - 一道工序的裁决只依赖规范顺序在它之前的工序落位结果，因此首个受影响
 *   工序之前的全部占用可以原样冻结复用；其后的工序按同一条裁决路径重算。
 * - 织机参数修正会波及该织机上的全部占用，故这些工序全部计入受影响集合。
 *
 * 以下变更会改变裁决顺序或候选织机集合，局部重算无法保证一致，自动
 * 回退为整体重算并在 meta.reason 中说明：优先级、工序序号、候选织机、
 * 固定指派、以及任何织机/订单/工序的新增或删除。
 */
import { normalizeInput, runSchedule } from './engine'
import type {
  Allocation,
  ConflictRecord,
  Loom,
  Operation,
  ScheduleInput,
  ScheduleResult,
} from './types'

interface InputDiff {
  fullReasons: string[]
  changedLoomIds: string[]
  changedOperationIds: string[]
  dueChanged: boolean
}

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function loomScheduleParamsChanged(a: Loom, b: Loom): boolean {
  if (a.efficiency !== b.efficiency) return true
  if ((a.availableFromDay ?? 0) !== (b.availableFromDay ?? 0)) return true
  if (a.workPeriods.length !== b.workPeriods.length) return true
  return a.workPeriods.some(
    (p, i) =>
      p.startMin !== b.workPeriods[i].startMin ||
      p.endMin !== b.workPeriods[i].endMin,
  )
}

function operationStructuralChanged(a: Operation, b: Operation): boolean {
  if (a.sequence !== b.sequence) return true
  if (a.loomIds.length !== b.loomIds.length) return true
  if (a.loomIds.some((id, i) => id !== b.loomIds[i])) return true
  const pa = a.pinned
  const pb = b.pinned
  if ((pa === undefined) !== (pb === undefined)) return true
  if (pa && pb && (pa.loomId !== pb.loomId || pa.startMin !== pb.startMin)) {
    return true
  }
  return false
}

export function diffInputs(prev: ScheduleInput, next: ScheduleInput): InputDiff {
  const diff: InputDiff = {
    fullReasons: [],
    changedLoomIds: [],
    changedOperationIds: [],
    dueChanged: false,
  }
  const prevLooms = new Map(prev.looms.map((l) => [l.id, l]))
  const nextLooms = new Map(next.looms.map((l) => [l.id, l]))
  for (const id of prevLooms.keys()) {
    if (!nextLooms.has(id)) diff.fullReasons.push(`织机 ${id} 被删除`)
  }
  for (const [id, loom] of nextLooms) {
    const before = prevLooms.get(id)
    if (!before) {
      diff.fullReasons.push(`新增织机 ${id}`)
    } else if (loomScheduleParamsChanged(before, loom)) {
      diff.changedLoomIds.push(id)
    }
  }

  const prevOrders = new Map(prev.orders.map((o) => [o.id, o]))
  const nextOrders = new Map(next.orders.map((o) => [o.id, o]))
  for (const id of prevOrders.keys()) {
    if (!nextOrders.has(id)) diff.fullReasons.push(`订单 ${id} 被删除`)
  }
  for (const [id, order] of nextOrders) {
    const before = prevOrders.get(id)
    if (!before) {
      diff.fullReasons.push(`新增订单 ${id}`)
      continue
    }
    if (before.priority !== order.priority) {
      diff.fullReasons.push(`订单 ${id} 优先级变化`)
    }
    if (before.dueMin !== order.dueMin) diff.dueChanged = true
    const prevOps = new Map(before.operations.map((op) => [op.id, op]))
    const nextOps = new Map(order.operations.map((op) => [op.id, op]))
    for (const opId of prevOps.keys()) {
      if (!nextOps.has(opId)) diff.fullReasons.push(`工序 ${opId} 被删除`)
    }
    for (const [opId, op] of nextOps) {
      const prevOp = prevOps.get(opId)
      if (!prevOp) {
        diff.fullReasons.push(`新增工序 ${opId}`)
      } else if (operationStructuralChanged(prevOp, op)) {
        diff.fullReasons.push(`工序 ${opId} 序号/候选织机/固定指派变化`)
      } else if (prevOp.baseMinutes !== op.baseMinutes) {
        diff.changedOperationIds.push(opId)
      }
    }
  }
  diff.changedLoomIds.sort()
  diff.changedOperationIds.sort()
  return diff
}

/** 规范裁决顺序中每道工序的位置（仅由优先级/编号/序号决定）。 */
function canonicalPositions(input: ScheduleInput): Map<string, number> {
  const orders = new Map(input.orders.map((o) => [o.id, o]))
  const ops: Operation[] = []
  for (const order of input.orders) ops.push(...order.operations)
  ops.sort((a, b) => {
    const oa = orders.get(a.orderId)!
    const ob = orders.get(b.orderId)!
    return (
      oa.priority - ob.priority ||
      compareStr(a.orderId, b.orderId) ||
      a.sequence - b.sequence ||
      compareStr(a.id, b.id)
    )
  })
  return new Map(ops.map((op, i) => [op.id, i]))
}

function conflictInvolvesOnly(
  conflict: ConflictRecord,
  operationIds: Set<string>,
): boolean {
  if (conflict.type === 'due-violation') return false
  return conflict.kept.every((id) => operationIds.has(id))
}

/**
 * 参数修正后的局部重算入口。
 * @param previous 上一轮推演结果（含输入快照）
 * @param nextInput 修正后的完整输入
 */
export function reschedule(
  previous: ScheduleResult,
  nextInput: ScheduleInput,
): ScheduleResult {
  const prevInput = previous.input
  const next = normalizeInput(nextInput)
  const diff = diffInputs(prevInput, next)

  if (diff.fullReasons.length > 0) {
    return runSchedule(next, undefined, {
      mode: 'full',
      reason: `结构性变更，回退整体重算：${diff.fullReasons.join('；')}`,
      changedLoomIds: diff.changedLoomIds,
      changedOperationIds: diff.changedOperationIds,
    })
  }

  const nothingChanged =
    diff.changedLoomIds.length === 0 &&
    diff.changedOperationIds.length === 0 &&
    !diff.dueChanged
  if (nothingChanged) {
    return {
      ...previous,
      input: next,
      meta: { ...previous.meta, mode: 'unchanged', reason: '参数无实质变化' },
    }
  }

  const onlyDueChanged =
    diff.changedLoomIds.length === 0 && diff.changedOperationIds.length === 0
  if (onlyDueChanged) {
    // 占用不变，仅按新交付时刻重估逾期裁决。
    const carried = previous.conflicts.filter((c) => c.type !== 'due-violation')
    const result = runSchedule(next, {
      allocations: previous.allocations,
      conflicts: carried,
    })
    return {
      ...result,
      meta: {
        ...result.meta,
        mode: 'violations-only',
        reason: '仅交付时刻变化，占用复用，重估逾期裁决',
        recomputedOperationIds: [],
        reusedOperationIds: previous.allocations.map((a) => a.operationId),
      },
    }
  }

  // 受影响工序集合：直接变更的工序 + 候选织机（含固定指派）涉及变更
  // 织机的全部工序。候选织机参数变化会改变这些工序的织机选择与工时
  // 推算，即使它们上一轮并未落在该织机上。
  const changedLooms = new Set(diff.changedLoomIds)
  const affected = new Set<string>(diff.changedOperationIds)
  for (const order of next.orders) {
    for (const op of order.operations) {
      if (op.loomIds.some((id) => changedLooms.has(id))) affected.add(op.id)
      if (op.pinned && changedLooms.has(op.pinned.loomId)) affected.add(op.id)
    }
  }
  for (const alloc of previous.allocations) {
    if (changedLooms.has(alloc.loomId)) affected.add(alloc.operationId)
  }

  const positions = canonicalPositions(next)
  let firstAffectedPos = Number.POSITIVE_INFINITY
  for (const id of affected) {
    const pos = positions.get(id)
    if (pos !== undefined && pos < firstAffectedPos) firstAffectedPos = pos
  }

  const recomputedIds: string[] = []
  const frozenAllocations: Allocation[] = []
  for (const alloc of previous.allocations) {
    const pos = positions.get(alloc.operationId)
    if (pos !== undefined && pos >= firstAffectedPos) {
      recomputedIds.push(alloc.operationId)
    } else {
      frozenAllocations.push(alloc)
    }
  }
  const frozenSet = new Set(frozenAllocations.map((a) => a.operationId))
  const carriedConflicts = previous.conflicts.filter(
    (c) => c.type !== 'due-violation' && conflictInvolvesOnly(c, frozenSet),
  )

  const horizonMin = previous.allocations
    .filter((a) => recomputedIds.includes(a.operationId))
    .reduce<number | undefined>(
      (acc, a) => (acc === undefined || a.startMin < acc ? a.startMin : acc),
      undefined,
    )

  const result = runSchedule(next, {
    allocations: frozenAllocations,
    conflicts: carriedConflicts,
  })
  return {
    ...result,
    meta: {
      ...result.meta,
      mode: 'incremental',
      reason: `局部重算：变更织机 [${diff.changedLoomIds.join(', ')}]，变更工序 [${diff.changedOperationIds.join(', ')}]`,
      changedLoomIds: diff.changedLoomIds,
      changedOperationIds: diff.changedOperationIds,
      recomputedOperationIds: recomputedIds,
      reusedOperationIds: frozenAllocations.map((a) => a.operationId),
      ...(horizonMin !== undefined ? { horizonMin } : {}),
    },
  }
}
