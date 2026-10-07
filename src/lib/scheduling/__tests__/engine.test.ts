import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addWorkMinutes,
  countWorkingMinutes,
  nextWorkingTime,
  reschedule,
  sampleInput,
  sampleTweaks,
  schedule,
} from '../index'
import type { Loom, ScheduleInput, ScheduleResult } from '../index'

/** 可复现的伪随机数（LCG），用于性质测试。 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function shuffledInput(input: ScheduleInput, seed: number): ScheduleInput {
  const rand = rng(seed)
  const copy: ScheduleInput = JSON.parse(JSON.stringify(input))
  copy.looms = shuffle(copy.looms, rand)
  copy.orders = shuffle(copy.orders, rand)
  for (const order of copy.orders) {
    order.operations = shuffle(order.operations, rand)
    for (const op of order.operations) {
      op.loomIds = shuffle(op.loomIds, rand)
    }
  }
  return copy
}

/** 比对两次推演的外部可观察结果（忽略 meta 的重算范围描述）。 */
function assertSameOutcome(a: ScheduleResult, b: ScheduleResult, label: string) {
  assert.deepEqual(a.allocations, b.allocations, `${label}: 织机占用不一致`)
  assert.deepEqual(a.loomPlans, b.loomPlans, `${label}: 织机占用顺序不一致`)
  assert.deepEqual(a.completions, b.completions, `${label}: 订单完成时刻不一致`)
  assert.deepEqual(a.conflicts, b.conflicts, `${label}: 冲突裁决不一致`)
}

test('同一输入重复推演结果完全一致（确定性）', () => {
  const input = sampleInput()
  const r1 = schedule(input)
  const r2 = schedule(JSON.parse(JSON.stringify(input)))
  assert.deepEqual(r1, r2)
})

test('输入数组顺序不影响裁决结果（入口无关性）', () => {
  const input = sampleInput()
  const base = schedule(input)
  for (const seed of [1, 7, 42, 2026]) {
    assertSameOutcome(base, schedule(shuffledInput(input, seed)), `seed=${seed}`)
  }
})

test('非固定工序：织机占用不重叠且满足工序先后约束', () => {
  const result = schedule(sampleInput())
  const pinnedIds = new Set(
    sampleInput().orders.flatMap((o) =>
      o.operations.filter((op) => op.pinned).map((op) => op.id),
    ),
  )
  for (const [loomId, plan] of Object.entries(result.loomPlans)) {
    for (let i = 1; i < plan.length; i += 1) {
      const prev = plan[i - 1]
      const curr = plan[i]
      const involvesPinned = pinnedIds.has(prev.operationId) || pinnedIds.has(curr.operationId)
      if (!involvesPinned) {
        assert.ok(
          prev.endMin <= curr.startMin,
          `织机 ${loomId} 上 ${prev.operationId} 与 ${curr.operationId} 重叠`,
        )
      }
    }
  }
  const input = sampleInput()
  const allocOf = new Map(result.allocations.map((a) => [a.operationId, a]))
  for (const order of input.orders) {
    const ops = [...order.operations].sort((a, b) => a.sequence - b.sequence)
    for (let i = 1; i < ops.length; i += 1) {
      if (pinnedIds.has(ops[i].id)) continue
      const prev = allocOf.get(ops[i - 1].id)!
      const curr = allocOf.get(ops[i].id)!
      assert.ok(
        prev.endMin <= curr.startMin,
        `工序 ${ops[i].id} 先于其前置工序完成`,
      )
    }
  }
})

test('固定指派冲突：双方保留且依据可追溯', () => {
  const result = schedule(sampleInput())
  const overlaps = result.conflicts.filter((c) => c.type === 'pinned-overlap')
  assert.ok(overlaps.length >= 1, '应产生固定指派重叠冲突')
  const overlap = overlaps.find(
    (c) => c.kept.includes('op-hb-zhizao') && c.kept.includes('op-hb-xiubu'),
  )
  assert.ok(overlap, '织造与修补的固定指派重叠应被记录')
  // 双方占用均保留在结果中
  const ids = new Set(result.allocations.map((a) => a.operationId))
  assert.ok(ids.has('op-hb-zhizao') && ids.has('op-hb-xiubu'))
  assert.ok(typeof overlap.evidence.overlapStartMin === 'number')
  assert.ok(typeof overlap.evidence.loomId === 'string')
})

test('交付逾期：保留安排并记录逾期裁决', () => {
  const result = schedule(sampleInput())
  const late = result.completions.find((c) => c.late)
  assert.ok(late, '团花补子应逾期')
  const record = result.conflicts.find(
    (c) => c.type === 'due-violation' && c.kept.includes(late.orderId),
  )
  assert.ok(record, '应有逾期裁决记录')
  assert.equal(record.evidence.completedMin, late.completedMin)
})

test('日历：工时只在织机工作时段内推进', () => {
  const loom: Loom = {
    id: 'l1',
    name: 'l1',
    efficiency: 1,
    workPeriods: [
      { startMin: 480, endMin: 720 },
      { startMin: 840, endMin: 1080 },
    ],
  }
  const rand = rng(99)
  for (let i = 0; i < 200; i += 1) {
    const t = Math.floor(rand() * 3 * 1440)
    const work = Math.floor(rand() * 600)
    const start = nextWorkingTime(loom, t)
    const end = addWorkMinutes(loom, t, work)
    assert.equal(
      countWorkingMinutes(loom, start, end),
      work,
      `t=${t} work=${work} 消耗工作分钟数不符`,
    )
  }
  // 直接断言若干确定用例
  assert.equal(addWorkMinutes(loom, 0, 60), 540) // 08:00 开工，1 小时后 09:00
  assert.equal(addWorkMinutes(loom, 700, 60), 880) // 午歇跨越：20 分钟 + 14:00 后 40 分钟
  assert.equal(addWorkMinutes(loom, 1080, 120), 480 + 1440 + 120) // 次日
  assert.equal(countWorkingMinutes(loom, 480, 880), 280)
})

test('局部重算与整体重算结果一致（示例参数修正）', () => {
  const input = sampleInput()
  const prev = schedule(input)
  const tweaked = sampleTweaks(input)
  const inc = reschedule(prev, tweaked)
  assert.equal(inc.meta.mode, 'incremental')
  assert.ok(inc.meta.recomputedOperationIds.length < input.orders.flatMap((o) => o.operations).length)
  assert.ok(inc.meta.reusedOperationIds.length > 0)
  assertSameOutcome(inc, schedule(tweaked), '示例修正')
})

test('局部重算与整体重算结果一致（随机参数修正性质测试）', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const rand = rng(seed * 7919)
    const input = sampleInput()
    const prev = schedule(input)
    const tweaked: ScheduleInput = JSON.parse(JSON.stringify(input))
    // 随机修正若干工序工时
    const ops = tweaked.orders.flatMap((o) => o.operations)
    const tweakCount = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < tweakCount; i += 1) {
      const op = ops[Math.floor(rand() * ops.length)]
      op.baseMinutes = 30 + Math.floor(rand() * 600)
    }
    // 随机修正织机效率/工作时段
    if (rand() < 0.5) {
      const loom = tweaked.looms[Math.floor(rand() * tweaked.looms.length)]
      loom.efficiency = 0.5 + rand() * 1.5
    }
    if (rand() < 0.3) {
      const loom = tweaked.looms[Math.floor(rand() * tweaked.looms.length)]
      loom.workPeriods = [
        { startMin: 420 + Math.floor(rand() * 120), endMin: 720 },
        { startMin: 840, endMin: 1020 + Math.floor(rand() * 120) },
      ]
    }
    const inc = reschedule(prev, tweaked)
    const full = schedule(tweaked)
    assertSameOutcome(inc, full, `seed=${seed}`)
  }
})

test('结构性变更回退整体重算并说明原因', () => {
  const input = sampleInput()
  const prev = schedule(input)
  const tweaked: ScheduleInput = JSON.parse(JSON.stringify(input))
  tweaked.orders[0].priority = 9
  const result = reschedule(prev, tweaked)
  assert.equal(result.meta.mode, 'full')
  assert.match(result.meta.reason, /优先级/)
  assertSameOutcome(result, schedule(tweaked), '优先级变更')
})

test('仅交付时刻变化：占用复用，逾期裁决重估', () => {
  const input = sampleInput()
  const prev = schedule(input)
  const tweaked: ScheduleInput = JSON.parse(JSON.stringify(input))
  tweaked.orders[0].dueMin = 10
  const result = reschedule(prev, tweaked)
  assert.equal(result.meta.mode, 'violations-only')
  assert.deepEqual(result.allocations, prev.allocations)
  assertSameOutcome(result, schedule(tweaked), '交付时刻变更')
})
