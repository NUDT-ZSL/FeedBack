/**
 * 场景级回放验证：确定性、时间演变、最后生效值、越界重置、
 * 选中联动、异常输入一致性，以及"每步局部结论 == 整体重算"的全局不变量。
 * 运行：node --test tests/replay.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFleet, evaluateNavigationStatus } from '../src/simulation/engine.ts'
import { runScenario } from '../src/simulation/replay.ts'
import {
  SCENARIOS,
  invalidInputsControlScenario,
  invalidInputsScenario,
  lastWriteWinsControlScenario,
  lastWriteWinsScenario,
  selectionLinkageScenario,
  timeEvolutionScenario,
  wrapResetScenario,
} from '../src/simulation/scenarios.ts'
import { getNavigationStatusLabel } from '../src/simulation/statusLabels.ts'
import { PROGRESS_WRAP_RESET } from '../src/simulation/constants.ts'
import type { ReplayResult } from '../src/simulation/types.ts'

/** 全局不变量：轨迹每一步的船舶状态/告警都与基于该步输入的整体重算一致 */
function assertStepConsistency(result: ReplayResult): void {
  result.steps.forEach((step) => {
    const fleet = evaluateFleet(step.state.ships, step.state.waterLevel, step.state.windSpeed)
    step.state.ships.forEach((ship, index) => {
      assert.equal(
        ship.navigationStatus,
        fleet.evaluations[index].status,
        `${result.scenario}#${step.step} ${ship.id} 状态与整体重算不一致`,
      )
    })
    assert.equal(
      step.state.alertActive,
      fleet.alertActive,
      `${result.scenario}#${step.step} 告警与整体重算不一致`,
    )
  })
}

test('确定性：同一场景重复回放，轨迹逐字节一致、校验和相同', () => {
  for (const scenario of SCENARIOS) {
    const first = runScenario(scenario)
    const second = runScenario(scenario)
    assert.equal(first.checksum, second.checksum, `${scenario.name} 校验和不确定`)
    assert.equal(JSON.stringify(first), JSON.stringify(second), `${scenario.name} 轨迹不确定`)
  }
})

test('全局不变量：所有场景的每一步局部结论都与整体重算一致', () => {
  for (const scenario of SCENARIOS) {
    assertStepConsistency(runScenario(scenario))
  }
})

test('时间演变：水位/风随时间推进时，各船状态与告警按口径演变', () => {
  const result = runScenario(timeEvolutionScenario)
  const statusOf = (step: number, id: string) =>
    result.steps[step].state.ships.find((ship) => ship.id === id)!.navigationStatus

  // step 0：水位降到 3，所有船余量越限 → 全部 warning，告警开启
  assert.equal(result.steps[0].state.waterLevel, 3)
  assert.ok(result.steps[0].state.ships.every((ship) => ship.navigationStatus === 'warning'))
  assert.equal(result.steps[0].state.alertActive, true)

  // step 31：水位升到 9，余量恢复 → 全部 normal，告警解除
  const riseStep = result.steps.findIndex(
    (step) => step.record.op.type === 'setWaterLevel' && step.record.applied && step.state.waterLevel === 9,
  )
  assert.ok(riseStep > 0)
  // 各船翻转水位：ship3=7.77、ship4=8.46、ship6=8.69 恢复 normal；ship1/2/5 仍 warning
  const risen = result.steps[riseStep].state
  const normalIds = risen.ships.filter((ship) => ship.navigationStatus === 'normal').map((ship) => ship.id)
  assert.deepEqual(normalIds.sort(), ['ship3', 'ship4', 'ship6'])
  assert.equal(risen.alertActive, true)

  // 风速升到 8：余量充足的 ship3/4/6 转 danger（不触发告警），ship1/2/5 仍为 warning（优先）
  const windStep = result.steps.findIndex(
    (step) => step.record.op.type === 'setWindSpeed' && step.record.applied && step.state.windSpeed === 8,
  )
  assert.ok(windStep > riseStep)
  const windy = result.steps[windStep].state
  const dangerIds = windy.ships.filter((ship) => ship.navigationStatus === 'danger').map((ship) => ship.id)
  assert.deepEqual(dangerIds.sort(), ['ship3', 'ship4', 'ship6'])
  assert.equal(windy.alertActive, true)

  // 推进 30 帧后进度按航速单调推进（未越界船只）
  const before = result.steps[windStep].state.ships.find((ship) => ship.id === 'ship4')!
  const after = result.steps[windStep + 30].state.ships.find((ship) => ship.id === 'ship4')!
  const expected = before.progress + 0.8 * 0.003 * (1 / 60) * 60 * 30
  assert.ok(Math.abs(after.progress - expected) < 1e-9, `ship4 进度 ${after.progress} 应为 ${expected}`)

  // 依据留痕：每个结论都能给出数值理由
  const evidence = result.steps[0].evaluation.evaluations.find((item) => item.shipId === 'ship1')!
  assert.match(evidence.reason, /余量 .* < 阈值 0.5/)
  void statusOf
})

test('最后生效值：同一时刻连续多组水位/风调整，最终状态只与最后值一致', () => {
  const actual = runScenario(lastWriteWinsScenario)
  const control = runScenario(lastWriteWinsControlScenario)
  assert.deepEqual(actual.finalState, control.finalState)
  assert.equal(actual.finalState.waterLevel, 8.5)
  assert.equal(actual.finalState.windSpeed, 5)
})

test('越界重置：进度超过 1.1 的船舶被重置为 -0.1，边界船保持确定性行为', () => {
  const result = runScenario(wrapResetScenario)
  const shipAt = (step: number, id: string) =>
    result.steps[step].state.ships.find((ship) => ship.id === id)!

  // edge-b（1.09, 航速 2.5）：第 1 帧到 1.0975 未越界，第 2 帧越界重置为 -0.1
  assert.ok(Math.abs(shipAt(0, 'edge-b').progress - 1.0975) < 1e-9)
  assert.equal(shipAt(1, 'edge-b').progress, PROGRESS_WRAP_RESET)
  // edge-a（1.1, 航速 0.5）：第 1 帧推进到 1.1015 越界 → 重置
  assert.equal(shipAt(0, 'edge-a').progress, PROGRESS_WRAP_RESET)
  // edge-c（0 起点）：第 1 帧推进 0.003
  assert.ok(Math.abs(shipAt(0, 'edge-c').progress - 0.003) < 1e-9)
  // edge-d（-0.1, 航速 0）：保持 -0.1 不动
  assert.equal(shipAt(7, 'edge-d').progress, -0.1)
  // 重置后从新起点继续推进，不保留溢出：edge-b 第 3 帧 = -0.1 + 0.0075
  assert.ok(Math.abs(shipAt(2, 'edge-b').progress - (PROGRESS_WRAP_RESET + 0.0075)) < 1e-9)
})

test('选中联动：被选中船舶状态变化后，展示结论仍与推演结果一致；重复选中可取消', () => {
  const result = runScenario(selectionLinkageScenario)

  // step 0：选中 ship3
  assert.equal(result.steps[0].state.selectedShipId, 'ship3')
  // step 1-2：水位 10 + 风速 8，ship3 余量充足 → danger，展示文案须与推演一致
  const dangerStep = result.steps[2]
  const selected = dangerStep.state.ships.find((ship) => ship.id === dangerStep.state.selectedShipId)!
  const fresh = evaluateNavigationStatus(selected, dangerStep.state.waterLevel, dangerStep.state.windSpeed)
  assert.equal(selected.navigationStatus, fresh.status)
  assert.equal(getNavigationStatusLabel(selected.navigationStatus), '危险停航')
  // step 3-4：重复选中同一艘 → 取消；再次选中 → 重新选中
  assert.equal(result.steps[3].state.selectedShipId, null)
  assert.equal(result.steps[4].state.selectedShipId, 'ship3')
  // step 5：水位降到 1，ship3 余量越限 → warning，展示文案同步
  const warningStep = result.steps[5]
  const ship3 = warningStep.state.ships.find((ship) => ship.id === 'ship3')!
  assert.equal(ship3.navigationStatus, 'warning')
  assert.equal(getNavigationStatusLabel(ship3.navigationStatus), '谨慎通过')
  // step 6-7：切换选中 ship1、清空选中，展示目标随之切换/消失
  assert.equal(result.steps[6].state.selectedShipId, 'ship1')
  assert.equal(result.steps[7].state.selectedShipId, null)
})

test('异常输入：越界水位/风、非法步长、不存在的船全部被拒绝留痕，状态与对照组一致', () => {
  const result = runScenario(invalidInputsScenario)
  const control = runScenario(invalidInputsControlScenario)

  const rejected = result.steps.filter((step) => !step.record.applied)
  assert.equal(rejected.length, 7)
  // 每个被拒绝的操作都有明确原因，不允许静默跳过
  for (const step of rejected) {
    assert.ok(step.record.reason, `step ${step.step} 缺少拒绝原因`)
  }
  // 拒绝原因与输入类型对应
  const reasons = rejected.map((step) => step.record.reason!)
  assert.ok(reasons.some((reason) => reason.includes('超出允许范围')))
  assert.ok(reasons.some((reason) => reason.includes('不是有限数值')))
  assert.ok(reasons.some((reason) => reason.includes('tick 步长')))
  assert.ok(reasons.some((reason) => reason.includes('不存在')))

  // 非法操作不产生任何局部副作用：最终状态与只施加合法操作的对照组完全一致
  assert.deepEqual(result.finalState, control.finalState)

  // 逐步核对：每个非法操作前后的状态快照完全相同
  for (const step of result.steps) {
    if (step.record.applied) continue
    const previous = result.steps[step.step - 1]
    if (previous) {
      assert.deepEqual(step.state, previous.state, `step ${step.step} 非法操作改变了状态`)
    }
  }
})

test('批量回归：全部场景可重复执行且校验和稳定', () => {
  const checksums = SCENARIOS.map((scenario) => [scenario.name, runScenario(scenario).checksum])
  const again = SCENARIOS.map((scenario) => [scenario.name, runScenario(scenario).checksum])
  assert.deepEqual(checksums, again)
})
