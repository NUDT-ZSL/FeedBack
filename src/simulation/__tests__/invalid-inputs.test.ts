import { describe, expect, it } from 'vitest'
import {
  applyEnvironment,
  getSimulationSnapshot,
  selectShip,
  stepSimulation,
} from '../engine'
import {
  WATER_LEVEL_MAX,
  WATER_LEVEL_MIN,
  WIND_SPEED_MAX,
  WIND_SPEED_MIN,
} from '../constants'
import { newState } from './helpers'

describe('可复现的异常输入：不静默跳过、不产生局部结论', () => {
  it('水位越界被钳制到允许范围并留痕', () => {
    const low = applyEnvironment(newState(), { waterLevel: -5 })
    expect(low.waterLevel).toBe(WATER_LEVEL_MIN)
    expect(low.violations).toHaveLength(1)
    expect(low.violations[0]).toMatchObject({ field: 'waterLevel', requested: -5, applied: WATER_LEVEL_MIN })

    const high = applyEnvironment(newState(), { waterLevel: 999 })
    expect(high.waterLevel).toBe(WATER_LEVEL_MAX)
    expect(high.violations[0].applied).toBe(WATER_LEVEL_MAX)
  })

  it('风速越界被钳制到允许范围并留痕', () => {
    const state = applyEnvironment(newState(), { windSpeed: 99 })
    expect(state.windSpeed).toBe(WIND_SPEED_MAX)
    expect(state.violations[0]).toMatchObject({ field: 'windSpeed', applied: WIND_SPEED_MAX })

    const negative = applyEnvironment(newState(), { windSpeed: -1 })
    expect(negative.windSpeed).toBe(WIND_SPEED_MIN)
  })

  it('非数值输入被拒绝并保持当前值', () => {
    const base = newState({ waterLevel: 6, windSpeed: 3 })
    const nanWater = applyEnvironment(base, { waterLevel: NaN })
    expect(nanWater.waterLevel).toBe(6)
    expect(nanWater.violations[0].reason).toContain('非有限数值')

    const infWind = applyEnvironment(base, { windSpeed: Infinity })
    expect(infWind.windSpeed).toBe(3)
    expect(infWind.violations).toHaveLength(1)
  })

  it('越界输入钳制后的结论与直接设定合法值完全一致（整体重算）', () => {
    const clamped = applyEnvironment(newState(), { waterLevel: -5, windSpeed: 99 })
    const direct = applyEnvironment(newState(), {
      waterLevel: WATER_LEVEL_MIN,
      windSpeed: WIND_SPEED_MAX,
    })
    // 推演结论完全一致；差异仅体现在违规留痕数量上
    const withoutViolations = (s: ReturnType<typeof getSimulationSnapshot>) => {
      const { violationCount, ...rest } = s
      return rest
    }
    expect(withoutViolations(getSimulationSnapshot(clamped))).toEqual(
      withoutViolations(getSimulationSnapshot(direct)),
    )
    expect(clamped.violations).toHaveLength(2)
    expect(direct.violations).toHaveLength(0)
  })

  it('非法推进步长被拒绝并留痕，船队不漂移', () => {
    const base = newState()
    for (const bad of [0, -0.016, NaN, Infinity]) {
      const state = stepSimulation(base, bad)
      expect(state.tick).toBe(base.tick)
      expect(state.ships.map((s) => s.progress)).toEqual(base.ships.map((s) => s.progress))
      expect(state.violations).toHaveLength(1)
      expect(state.violations[0].field).toBe('delta')
      // 不静默：状态仍整体重算，结论与基线一致
      expect(state.ships.map((s) => s.navigationStatus)).toEqual(
        base.ships.map((s) => s.navigationStatus),
      )
    }
  })

  it('选中不存在的船舶被拒绝并留痕，不影响其他结论', () => {
    const state = selectShip(newState(), 'not-a-ship')
    expect(state.selectedShipId).toBeNull()
    expect(state.violations).toHaveLength(1)
    expect(getSimulationSnapshot(state).ships).toEqual(getSimulationSnapshot(newState()).ships)
  })

  it('违规记录带时间步，可在回放日志中定位', () => {
    let state = newState()
    state = stepSimulation(state, 1 / 60)
    state = stepSimulation(state, 1 / 60)
    state = applyEnvironment(state, { waterLevel: 42 })
    expect(state.violations[0].tick).toBe(2)
  })
})
