import { describe, expect, it } from 'vitest'
import {
  applyEnvironment,
  getShipSnapshot,
  getSimulationSnapshot,
  stepSimulation,
} from '../engine'
import {
  PROGRESS_RATE,
  PROGRESS_WRAP_HIGH,
  PROGRESS_WRAP_LOW,
} from '../constants'
import { FRAME, makeShip, newState, steps } from './helpers'

describe('船舶越界与回到初始进度时的重置', () => {
  it('进度超过 1.1 精确回绕到 -0.1（而非漂移到中间值）', () => {
    const ship = makeShip({ progress: PROGRESS_WRAP_HIGH, speed: 2 })
    let state = newState({ ships: [ship] })
    state = stepSimulation(state, FRAME)
    expect(state.ships[0].progress).toBe(PROGRESS_WRAP_LOW)
  })

  it('进度恰好等于 1.1 不回绕，超出任意一个步长才回绕', () => {
    const step = 1 * PROGRESS_RATE * FRAME * 60
    const shipAt = makeShip({ progress: PROGRESS_WRAP_HIGH - step, speed: 1 })
    let state = newState({ ships: [shipAt] })
    state = stepSimulation(state, FRAME)
    expect(state.ships[0].progress).toBe(PROGRESS_WRAP_HIGH)

    // 再多哪怕极小一点，下一步就越过 1.1 触发回绕
    const shipOver = makeShip({ progress: PROGRESS_WRAP_HIGH - step + 1e-9, speed: 1 })
    state = newState({ ships: [shipOver] })
    state = stepSimulation(state, FRAME)
    expect(state.ships[0].progress).toBe(PROGRESS_WRAP_LOW)
  })

  it('回绕后状态按当前环境整体重算，不沿用旧判定', () => {
    // 低水位下所有船 warning；回绕后仍是 warning（不会因为回绕丢失判定）
    const ship = makeShip({ progress: PROGRESS_WRAP_HIGH, speed: 10 })
    let state = newState({ ships: [ship], waterLevel: 5 })
    expect(state.ships[0].navigationStatus).toBe('warning')
    state = stepSimulation(state, FRAME) // 触发回绕
    expect(state.ships[0].progress).toBe(PROGRESS_WRAP_LOW)
    expect(state.ships[0].navigationStatus).toBe('warning')

    // 回绕后环境变好，下一帧结论立即随整体重算切换
    state = applyEnvironment(state, { waterLevel: 10 })
    state = stepSimulation(state, FRAME)
    expect(state.ships[0].navigationStatus).toBe('normal')
  })

  it('快照/展示中的进度与位置被钳制到 [0, 1]，但内部推演继续推进', () => {
    const ship = makeShip({ progress: -0.05, speed: 0 })
    const state = newState({ ships: [ship] })
    const snapshot = getShipSnapshot(state.ships[0], state)
    expect(snapshot.progress).toBe(0)
    expect(snapshot.positionX).toBe(-40)
  })

  it('默认船队多帧推进不产生 NaN 或越界进度', () => {
    const state = steps(newState(), 600)
    const snapshot = getSimulationSnapshot(state)
    for (const ship of snapshot.ships) {
      expect(Number.isFinite(ship.progress)).toBe(true)
      expect(ship.progress).toBeGreaterThanOrEqual(0)
      expect(ship.progress).toBeLessThanOrEqual(1)
      expect(Number.isFinite(ship.positionX)).toBe(true)
    }
  })
})
