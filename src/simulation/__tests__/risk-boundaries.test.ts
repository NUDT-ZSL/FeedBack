import { describe, expect, it } from 'vitest'
import {
  applyEnvironment,
  computeClearance,
  evaluateNavigationStatus,
  getMaxCargo,
} from '../engine'
import {
  DANGER_WIND_THRESHOLD,
  SHIP_TYPE_LIMITS,
  WARNING_CLEARANCE_THRESHOLD,
} from '../constants'
import { ShipType } from '../types'
import { makeShip, newState, shipOf } from './helpers'

const env = (waterLevel: number, windSpeed: number) => ({ waterLevel, windSpeed })

describe('吃水 / 载重 / 船型 与风险等级的边界取值', () => {
  it('净余水深恰好等于 0.5 时不触发警告（严格小于）', () => {
    // 吃水 1.3、水位 8 → 净余 = 0.8 - 1.0×0.3 = 0.5（恰好在边界上）
    const ship = makeShip({ draft: 1.3, cargoWeight: 10 })
    expect(computeClearance(1.3, 8)).toBeCloseTo(WARNING_CLEARANCE_THRESHOLD, 10)
    expect(evaluateNavigationStatus(ship, env(8, 2))).toBe('normal')
    // 水位 7.9 → 净余 0.478 < 0.5 → 警告
    expect(evaluateNavigationStatus(ship, env(7.9, 2))).toBe('warning')
  })

  it('风速 6 级不触发停航，7 级触发（阈值边界）', () => {
    const ship = makeShip({ draft: 1, cargoWeight: 10 })
    expect(evaluateNavigationStatus(ship, env(8, DANGER_WIND_THRESHOLD - 1))).toBe('normal')
    expect(evaluateNavigationStatus(ship, env(8, DANGER_WIND_THRESHOLD))).toBe('danger')
  })

  it('净余不足优先于大风：warning 分支先于 danger 判定', () => {
    const ship = makeShip({ draft: 2.8, cargoWeight: 10 })
    // 水位 5 → 净余 0.34 < 0.5；同时风速 8 ≥ 7
    expect(evaluateNavigationStatus(ship, env(5, 8))).toBe('warning')
  })

  it('载重恰好在船型上限不超载，超过 0.01 即上调一级', () => {
    const atCap = shipOf('cargo', { draft: 1, cargoWeight: SHIP_TYPE_LIMITS.cargo.maxCargo })
    const overCap = shipOf('cargo', { draft: 1, cargoWeight: SHIP_TYPE_LIMITS.cargo.maxCargo + 0.01 })
    // 净余充足、无风：基准为 normal
    expect(evaluateNavigationStatus(atCap, env(8, 2))).toBe('normal')
    expect(evaluateNavigationStatus(overCap, env(8, 2))).toBe('warning')
  })

  it('超载叠加浅水警告时升级为危险停航', () => {
    const ship = shipOf('pleasure', {
      draft: 2.8,
      cargoWeight: SHIP_TYPE_LIMITS.pleasure.maxCargo + 1,
    })
    // 水位 5 → 净余 0.34 → warning；超载再上调一级 → danger
    expect(evaluateNavigationStatus(ship, env(5, 2))).toBe('danger')
  })

  it('四种船型的载重上限边界逐一验证', () => {
    const cases: Array<[ShipType, number]> = [
      ['cargo', 150],
      ['passenger', 60],
      ['fishing', 30],
      ['pleasure', 20],
    ]
    for (const [type, cap] of cases) {
      expect(getMaxCargo(type)).toBe(cap)
      const at = shipOf(type, { draft: 1, cargoWeight: cap })
      const over = shipOf(type, { draft: 1, cargoWeight: cap + 0.5 })
      expect(evaluateNavigationStatus(at, env(8, 2))).toBe('normal')
      expect(evaluateNavigationStatus(over, env(8, 2))).toBe('warning')
    }
  })

  it('吃水边界：同一艘船状态翻转的临界水位可精确复算', () => {
    // 净余 = 水位×0.1 - (吃水 + (5-水位)×0.1)×0.3 = 0.5 的解：水位 = 5 + 30×吃水/13
    const draft = 2
    const criticalLevel = 5 + (30 * draft) / 13 // ≈ 9.615
    const ship = makeShip({ draft, cargoWeight: 10 })
    expect(evaluateNavigationStatus(ship, env(criticalLevel, 2))).toBe('normal')
    expect(evaluateNavigationStatus(ship, env(criticalLevel - 0.01, 2))).toBe('warning')
  })

  it('环境调整后全船队按同一边界口径整体重算', () => {
    const fleet = [
      makeShip({ id: 'a', draft: 1.3, cargoWeight: 10 }), // 水位 8 净余恰 0.5 → normal
      makeShip({ id: 'b', draft: 1.31, cargoWeight: 10 }), // 净余略低于 0.5 → warning
      makeShip({ id: 'c', draft: 1, cargoWeight: 151 }), // 超载 → warning
    ]
    const state = newState({ ships: fleet, waterLevel: 8, windSpeed: 2 })
    expect(state.ships.map((s) => s.navigationStatus)).toEqual([
      'normal',
      'warning',
      'warning',
    ])
    expect(state.alertActive).toBe(true)

    // 水位升至 9：a/b 净余均超过 0.5 → normal；c 仍超载 → warning
    const raised = applyEnvironment(state, { waterLevel: 9 })
    expect(raised.ships.map((s) => s.navigationStatus)).toEqual([
      'normal',
      'normal',
      'warning',
    ])
  })
})
