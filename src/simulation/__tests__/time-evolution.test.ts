import { describe, expect, it } from 'vitest'
import {
  applyEnvironment,
  getShipSnapshot,
  getSimulationSnapshot,
  stepSimulation,
} from '../engine'
import { PROGRESS_RATE, RIVER_LENGTH } from '../constants'
import { FRAME, makeShip, newState, steps } from './helpers'

describe('水位与风随时间推进时的状态演变', () => {
  it('进度按 speed × 0.003 × delta × 60 确定性推进', () => {
    const ship = makeShip({ id: 's1', speed: 2, progress: 0.25 })
    let state = newState({ ships: [ship] })
    state = stepSimulation(state, FRAME)

    const expected = 0.25 + 2 * PROGRESS_RATE * FRAME * 60
    expect(state.ships[0].progress).toBeCloseTo(expected, 10)

    const snapshot = getShipSnapshot(state.ships[0], state)
    expect(snapshot.positionX).toBeCloseTo((expected - 0.5) * RIVER_LENGTH, 4)
  })

  it('连续推进 120 帧后位置完全确定且可复现', () => {
    const run = () => steps(newState(), 120)
    const a = getSimulationSnapshot(run())
    const b = getSimulationSnapshot(run())
    expect(a).toEqual(b)
    // 基准船队首船：0.1 + 1.2 × 0.003 × 120 = 0.532
    expect(a.ships[0].progress).toBeCloseTo(0.532, 6)
    expect(a.tick).toBe(120)
  })

  it('水位随时间下降时各船状态按口径同步演变', () => {
    // 轻吃水船：水位 5 时净余 0.35（warning），水位 8 时净余 0.71（normal）
    const light = makeShip({ id: 'light', draft: 1, cargoWeight: 10 })
    let state = newState({ ships: [light], waterLevel: 5 })
    expect(state.ships[0].navigationStatus).toBe('warning')
    expect(state.alertActive).toBe(true)

    // 模拟水位逐步上涨的过程：每一步都推进并整体重算
    for (const level of [6, 7, 8]) {
      state = applyEnvironment(state, { waterLevel: level })
      state = steps(state, 10)
    }
    expect(state.waterLevel).toBe(8)
    expect(state.ships[0].navigationStatus).toBe('normal')
    expect(state.alertActive).toBe(false)
    expect(state.tick).toBe(30)
  })

  it('风速升至 7 级时净余充足的船进入危险停航并触发演变链', () => {
    const light = makeShip({ id: 'light', draft: 1, cargoWeight: 10 })
    let state = newState({ ships: [light], waterLevel: 8, windSpeed: 2 })
    expect(state.ships[0].navigationStatus).toBe('normal')

    state = applyEnvironment(state, { windSpeed: 7 })
    state = steps(state, 5)
    expect(state.ships[0].navigationStatus).toBe('danger')
    // 告警口径：仅 warning 触发红旗，danger 不触发（与渲染帧原逻辑一致）
    expect(state.alertActive).toBe(false)
  })

  it('推进只依赖引擎状态，与渲染帧无关：相同 delta 序列结果一致', () => {
    const deltas = [FRAME, FRAME, 0.05, 0.02, FRAME]
    const run = () => {
      let state = newState()
      for (const delta of deltas) state = stepSimulation(state, delta)
      return getSimulationSnapshot(state)
    }
    expect(run()).toEqual(run())
  })
})
