import { describe, expect, it } from 'vitest'
import { applyEnvironment, getSimulationSnapshot } from '../engine'
import { newState, steps } from './helpers'

describe('同一时刻连续多组水位/风调整：最终状态只与最后生效值一致', () => {
  it('连续覆盖写后状态等价于直接设定最终值', () => {
    const burst = newState()
    const direct = newState()

    const bursted = applyEnvironment(
      applyEnvironment(
        applyEnvironment(
          applyEnvironment(burst, { waterLevel: 3, windSpeed: 8 }),
          { waterLevel: 6.5 },
        ),
        { windSpeed: 1 },
      ),
      { waterLevel: 7.5, windSpeed: 1 },
    )
    const directSet = applyEnvironment(direct, { waterLevel: 7.5, windSpeed: 1 })

    expect(getSimulationSnapshot(bursted)).toEqual(getSimulationSnapshot(directSet))
    expect(bursted.ships.map((s) => s.navigationStatus)).toEqual(
      directSet.ships.map((s) => s.navigationStatus),
    )
    expect(bursted.alertActive).toBe(directSet.alertActive)
  })

  it('连续调整与直接设定在推进若干帧后仍然一致', () => {
    const a = applyEnvironment(
      applyEnvironment(newState(), { waterLevel: 1 }),
      { waterLevel: 9 },
    )
    const b = applyEnvironment(newState(), { waterLevel: 9 })

    expect(getSimulationSnapshot(steps(a, 60))).toEqual(getSimulationSnapshot(steps(b, 60)))
  })

  it('被钳制的中间值不会留下残留：最终值在范围内时以最终值为准', () => {
    const state = applyEnvironment(
      applyEnvironment(newState(), { waterLevel: -100 }), // 中间态被钳到 0
      { waterLevel: 4 },
    )
    expect(state.waterLevel).toBe(4)
    expect(state.violations).toHaveLength(1)
    // 推演结论等价于从未经过中间态（违规只留痕，不影响最终结论）
    const { violationCount: _a, ...conclusion } = getSimulationSnapshot(state)
    const { violationCount: _b, ...directConclusion } = getSimulationSnapshot(
      applyEnvironment(newState(), { waterLevel: 4 }),
    )
    expect(conclusion).toEqual(directConclusion)
  })

  it('同时给出水位与风速时二者互不干扰', () => {
    const state = applyEnvironment(newState(), { waterLevel: 2, windSpeed: 6 })
    expect(state.waterLevel).toBe(2)
    expect(state.windSpeed).toBe(6)
  })
})
