/**
 * 推演引擎单元级验证：吃水换算、余量/风速边界、进度越界重置、
 * 载重/船型与风险等级的口径边界、异常输入校验。
 * 运行：node --test tests/engine.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceProgress,
  clampProgress,
  computeClearance,
  computeEffectiveDraft,
  createSimulation,
  evaluateFleet,
  evaluateNavigationStatus,
  validateWaterLevel,
  validateWindSpeed,
} from '../src/simulation/engine.ts'
import {
  DANGER_WIND_THRESHOLD,
  PROGRESS_WRAP_RESET,
  PROGRESS_WRAP_THRESHOLD,
  WARNING_CLEARANCE_THRESHOLD,
} from '../src/simulation/constants.ts'
import { DEFAULT_SHIPS } from '../src/simulation/defaultFleet.ts'
import type { ShipData } from '../src/simulation/types.ts'

function makeShip(overrides: Partial<ShipData>): ShipData {
  return { ...DEFAULT_SHIPS[0], ...overrides }
}

test('吃水换算：参考水位处等于原吃水，低水位加深、高水位变浅', () => {
  assert.equal(computeEffectiveDraft(2.8, 5), 2.8)
  assert.ok(Math.abs(computeEffectiveDraft(2.8, 3) - 3.0) < 1e-12)
  assert.ok(Math.abs(computeEffectiveDraft(2.8, 8) - 2.5) < 1e-12)
})

test('余量边界：clearance 恰好等于阈值 0.5 时不判 warning（严格小于）', () => {
  const ship = makeShip({ draft: 0 })
  // waterLevel=5 时 clearance = 5*0.1 - 0*0.3 = 0.5，恰好等于阈值
  const atThreshold = evaluateNavigationStatus(ship, 5, 0)
  assert.equal(atThreshold.clearance, WARNING_CLEARANCE_THRESHOLD)
  assert.equal(atThreshold.status, 'normal')
  assert.equal(atThreshold.rule, 'normal')
  // 低 0.1 水位后 clearance = 0.487 < 0.5 → warning
  const below = evaluateNavigationStatus(ship, 4.9, 0)
  assert.ok(below.clearance < WARNING_CLEARANCE_THRESHOLD)
  assert.equal(below.status, 'warning')
  assert.equal(below.rule, 'warning-clearance')
})

test('风速边界：风速恰好 7 级判 danger，6.999 不判；warning 优先于 danger', () => {
  const ship = makeShip({ draft: 0 })
  // waterLevel=10 时 clearance = 1.0，远离余量阈值，隔离风速因素
  const atDanger = evaluateNavigationStatus(ship, 10, DANGER_WIND_THRESHOLD)
  assert.equal(atDanger.status, 'danger')
  assert.equal(atDanger.rule, 'danger-wind')
  const justBelow = evaluateNavigationStatus(ship, 10, DANGER_WIND_THRESHOLD - 0.001)
  assert.equal(justBelow.status, 'normal')
  // 余量越限且风速越限时，warning 优先
  const both = evaluateNavigationStatus(ship, 0, 8)
  assert.equal(both.status, 'warning')
  assert.equal(both.rule, 'warning-clearance')
})

test('进度推进：严格大于 1.1 才重置，重置值恒为 -0.1，不保留溢出', () => {
  // 恰好 1.1 不重置
  assert.equal(advanceProgress(PROGRESS_WRAP_THRESHOLD, 0, 1), PROGRESS_WRAP_THRESHOLD)
  // 超过 1.1 即重置为 -0.1（溢出量被丢弃）
  assert.equal(advanceProgress(1.1, 1, 1 / 60), PROGRESS_WRAP_RESET)
  assert.equal(advanceProgress(1.09, 2.5, 1), PROGRESS_WRAP_RESET)
  // 未越界时按 speed * 0.003 * delta * 60 推进
  assert.ok(Math.abs(advanceProgress(0.5, 2, 0.5) - 0.68) < 1e-12)
  // 钳制范围 [0, 1]
  assert.equal(clampProgress(1.2), 1)
  assert.equal(clampProgress(-0.3), 0)
})

test('输入校验：水位 [0,10]、风速 [0,8] 边界值合法，越界与非数值非法', () => {
  assert.equal(validateWaterLevel(0), null)
  assert.equal(validateWaterLevel(10), null)
  assert.ok(validateWaterLevel(-0.1))
  assert.ok(validateWaterLevel(10.1))
  assert.ok(validateWaterLevel(Number.NaN))
  assert.ok(validateWaterLevel(Number.POSITIVE_INFINITY))
  assert.equal(validateWindSpeed(0), null)
  assert.equal(validateWindSpeed(8), null)
  assert.ok(validateWindSpeed(8.1))
  assert.ok(validateWindSpeed(-1))
  assert.ok(validateWindSpeed(Number.NaN))
})

test('载重与船型口径：当前口径下载货量与船型不影响风险判定（留痕防口径漂移）', () => {
  const light = makeShip({ cargoWeight: 0, type: 'fishing', draft: 2 })
  const heavy = makeShip({ cargoWeight: 500, type: 'cargo', draft: 2 })
  for (const waterLevel of [0, 2.5, 5, 7.5, 10]) {
    for (const windSpeed of [0, 4, 7, 8]) {
      const a = evaluateNavigationStatus(light, waterLevel, windSpeed)
      const b = evaluateNavigationStatus(heavy, waterLevel, windSpeed)
      assert.equal(a.status, b.status, `waterLevel=${waterLevel} wind=${windSpeed} 载重/船型不应影响结论`)
    }
  }
})

test('吃水与风险边界：每艘船的状态翻转水位与解析解一致', () => {
  // clearance(WL) = 0.13*WL - 0.3*draft - 0.15，翻转点 WL* = (0.65 + 0.3*draft)/0.13
  for (const ship of DEFAULT_SHIPS) {
    const analytic = (0.65 + 0.3 * ship.draft) / 0.13
    // 在翻转点两侧各取一点验证符号
    const below = evaluateNavigationStatus(ship, analytic - 0.01, 0)
    const above = evaluateNavigationStatus(ship, analytic + 0.01, 0)
    assert.equal(below.status, 'warning', `${ship.id} 翻转点下方应为 warning`)
    assert.equal(above.status, 'normal', `${ship.id} 翻转点上方应为 normal`)
  }
})

test('告警口径：仅 warning 触发全局告警，danger 不触发', () => {
  const ships = [makeShip({ id: 'a', draft: 0 })]
  // 高水位 + 8 级风 → danger 但无 warning → 不告警
  const dangerOnly = evaluateFleet(ships, 10, 8)
  assert.equal(dangerOnly.evaluations[0].status, 'danger')
  assert.equal(dangerOnly.alertActive, false)
  // 低水位 → warning → 告警
  const warning = evaluateFleet(ships, 0, 0)
  assert.equal(warning.evaluations[0].status, 'warning')
  assert.equal(warning.alertActive, true)
})

test('推演实例：非法操作被拒绝留痕且不改变状态，合法操作后整体重算', () => {
  const sim = createSimulation()
  const before = sim.getState()
  const rejected = sim.apply({ type: 'setWaterLevel', value: 99 })
  assert.equal(rejected.applied, false)
  assert.ok(rejected.reason)
  assert.deepEqual(sim.getState(), before)
  sim.apply({ type: 'setWaterLevel', value: 0 })
  const after = sim.getState()
  // 水位 0 时所有船余量必越限 → 全部 warning 且告警
  const fleet = evaluateFleet(after.ships, 0, after.windSpeed)
  assert.ok(after.ships.every((ship) => ship.navigationStatus === 'warning'))
  assert.equal(after.alertActive, true)
  assert.ok(fleet.alertActive)
})
