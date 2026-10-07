/**
 * 排产与工时推演的离线验收脚本（不启动界面即可运行）：
 *   npx tsx scripts/schedule-check.ts
 *
 * 验收内容：
 * 1. 同一批织机/订单/工序数据，分别经「直接调用」「模拟界面装配」
 *    「模拟 HTTP 序列化」三条入口推演，织机占用顺序、订单完成时刻与
 *    冲突裁决必须完全一致。
 * 2. 修正若干工序与织机参数后，局部重算结果必须与整体重算一致，
 *    且冲突裁决依据可追溯。
 * 退出码：全部一致为 0，任一不一致为 1。
 */
import {
  reschedule,
  sampleInput,
  sampleTweaks,
  schedule,
} from '../src/lib/scheduling/index'
import type { ScheduleInput, ScheduleResult } from '../src/lib/scheduling/index'

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

function outcomeOf(result: ScheduleResult): string {
  return JSON.stringify({
    allocations: result.allocations,
    loomPlans: result.loomPlans,
    completions: result.completions,
    conflicts: result.conflicts,
  })
}

/** 模拟界面入口：从界面层状态（数组顺序由渲染顺序决定）装配输入。 */
function assembleViaUiState(input: ScheduleInput): ScheduleInput {
  const state = {
    looms: [...input.looms].reverse(),
    orders: [...input.orders].reverse().map((o) => ({
      ...o,
      operations: [...o.operations].reverse(),
    })),
  }
  return { originDate: input.originDate, looms: state.looms, orders: state.orders }
}

/** 模拟 HTTP 入口：JSON 序列化往返（键顺序与数组顺序可能变化）。 */
function assembleViaHttp(input: ScheduleInput): ScheduleInput {
  const wire = JSON.stringify({ payload: input })
  return (JSON.parse(wire) as { payload: ScheduleInput }).payload
}

function main(): void {
  const input = sampleInput()

  console.log('== 入口一致性 ==')
  const direct = schedule(input)
  const viaUi = schedule(assembleViaUiState(input))
  const viaHttp = schedule(assembleViaHttp(input))
  check('直接调用 vs 界面装配：织机占用/完成时刻/冲突裁决一致', outcomeOf(direct) === outcomeOf(viaUi))
  check('直接调用 vs HTTP 序列化：织机占用/完成时刻/冲突裁决一致', outcomeOf(direct) === outcomeOf(viaHttp))

  console.log('\n== 冲突裁决可追溯 ==')
  const overlap = direct.conflicts.filter((c) => c.type === 'pinned-overlap')
  check('固定指派冲突保留双方', overlap.length >= 1 && overlap.every((c) => c.kept.length === 2),
    `${overlap.length} 起`)
  check('冲突记录包含可追溯依据', overlap.every((c) => typeof c.evidence.loomId === 'string' && typeof c.evidence.overlapStartMin === 'number'))
  const late = direct.conflicts.filter((c) => c.type === 'due-violation')
  check('逾期订单保留并记录依据', late.every((c) => typeof c.evidence.completedMin === 'number' && typeof c.evidence.dueMin === 'number'),
    `${late.length} 起`)

  console.log('\n== 参数修正：局部重算 ==')
  const tweaked = sampleTweaks(input)
  const incremental = reschedule(direct, tweaked)
  const full = schedule(tweaked)
  check('修正后按局部范围重算', incremental.meta.mode === 'incremental',
    `重算 ${incremental.meta.recomputedOperationIds.length} 道工序，复用 ${incremental.meta.reusedOperationIds.length} 道，时间起点 ${incremental.meta.horizonMin}`)
  check('局部重算与整体重算结果一致', outcomeOf(incremental) === outcomeOf(full))
  check('重算范围可追溯（meta 记录变更织机/工序）',
    incremental.meta.changedLoomIds.length > 0 || incremental.meta.changedOperationIds.length > 0,
    `织机 [${incremental.meta.changedLoomIds}] 工序 [${incremental.meta.changedOperationIds}]`)

  console.log('')
  if (failures > 0) {
    console.error(`${failures} 项验收未通过`)
    process.exit(1)
  }
  console.log('全部验收项通过')
}

main()
