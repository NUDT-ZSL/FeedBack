import { describe, it, expect } from 'vitest'
import {
  CUP_COUNT,
  INITIAL_SPACING,
  createInitialSimState,
  stepSimulation,
  type SimEnv,
  type SimState
} from './cupSimulation'
import { useWaterStore } from '../store/waterStore'

const TOTAL_LENGTH = 12
const DT = 1 / 60

const envOf = (gateOpening: number, slope = 15, curvature = 45): SimEnv => ({
  gateOpening,
  slope,
  curvature,
  totalLength: TOTAL_LENGTH
})

const stateWithDistances = (distances: number[]): SimState => ({
  cups: distances.map(distance => ({
    distance,
    velocity: 0,
    stuck: false,
    justCollided: false
  })),
  contacts: [],
  totalCollisions: 0
})

const runSteps = (initial: SimState, envs: SimEnv[]): SimState => {
  let state = initial
  for (const env of envs) {
    state = stepSimulation(state, env, DT).state
  }
  return state
}

const triangleWave = (t: number) => (t < 0.5 ? t * 2 : (1 - t) * 2)

const autoDemoEnvs = (frames: number): SimEnv[] => {
  const cycleDuration = 8000
  const frameMs = 1000 / 60
  return Array.from({ length: frames }, (_, i) => {
    const phase = ((i * frameMs) % cycleDuration) / cycleDuration
    const value = triangleWave(phase) * 100
    return envOf(value, value * 0.3, value * 0.9)
  })
}

describe('初始分布', () => {
  it('六只杯等间距分布，速度、卡住标记与接触记录全部归零', () => {
    const state = createInitialSimState()
    expect(state.cups).toHaveLength(CUP_COUNT)
    state.cups.forEach((cup, i) => {
      expect(cup.distance).toBeCloseTo(i * INITIAL_SPACING)
      expect(cup.velocity).toBe(0)
      expect(cup.stuck).toBe(false)
    })
    expect(state.contacts).toEqual([])
    expect(state.totalCollisions).toBe(0)
  })
})

describe('同帧多杯碰撞', () => {
  it('同一帧内多个杯对各自只计一次碰撞', () => {
    const result = stepSimulation(
      stateWithDistances([1.0, 1.05, 1.1, 3, 4, 5]),
      envOf(50),
      DT
    )
    expect(result.collisions).toBe(2)
    expect(result.state.totalCollisions).toBe(2)
    expect(result.collidedCupIds.sort()).toEqual([0, 1, 1, 2])
  })

  it('持续贴近的杯对不会重复计数，分离后才能再次触发', () => {
    let state = stateWithDistances([1.0, 1.05, 3, 4, 5, 6])
    state = stepSimulation(state, envOf(50), DT).state
    expect(state.totalCollisions).toBe(1)

    for (let i = 0; i < 30; i++) {
      state = stepSimulation(state, envOf(50), DT).state
    }
    expect(state.totalCollisions).toBe(1)

    state.cups[0].distance = 1.0
    state.cups[1].distance = 1.5
    state = stepSimulation(state, envOf(50), DT).state
    expect(state.contacts).toEqual([])

    state.cups[1].distance = 1.04
    state = stepSimulation(state, envOf(50), DT).state
    expect(state.totalCollisions).toBe(2)
  })

  it('每帧上报的碰撞事件数累加后等于状态中的总碰撞数', () => {
    let state = stateWithDistances([1.0, 1.05, 1.1, 1.5, 1.56, 5])
    let reported = 0
    for (let i = 0; i < 120; i++) {
      const result = stepSimulation(state, envOf(50), DT)
      reported += result.collisions
      state = result.state
    }
    expect(state.totalCollisions).toBe(reported)
  })
})

describe('停转阈值滞回', () => {
  it('开度在卡住与恢复阈值之间抖动时，卡住标记不抖动', () => {
    let state = createInitialSimState()

    state = runSteps(state, Array(30).fill(envOf(5)))
    expect(state.cups.every(cup => cup.stuck)).toBe(true)

    const jitterBelowRelease = Array.from({ length: 60 }, (_, i) =>
      envOf(i % 2 === 0 ? 10 : 13)
    )
    state = runSteps(state, jitterBelowRelease)
    expect(state.cups.every(cup => cup.stuck)).toBe(true)

    state = runSteps(state, Array(30).fill(envOf(20)))
    expect(state.cups.every(cup => !cup.stuck)).toBe(true)

    const jitterAboveStuck = Array.from({ length: 60 }, (_, i) =>
      envOf(i % 2 === 0 ? 10 : 13)
    )
    state = runSteps(state, jitterAboveStuck)
    expect(state.cups.every(cup => !cup.stuck)).toBe(true)

    state = runSteps(state, Array(30).fill(envOf(5)))
    expect(state.cups.every(cup => cup.stuck)).toBe(true)
  })
})

describe('重置与自动演示切换', () => {
  it('重置后所有杯体回到同一初始分布', () => {
    const played = runSteps(createInitialSimState(), autoDemoEnvs(600))
    expect(played).not.toEqual(createInitialSimState())

    const reset = createInitialSimState()
    expect(reset).toEqual(createInitialSimState())
    expect(reset.cups.map(c => c.distance)).toEqual(
      Array.from({ length: CUP_COUNT }, (_, i) => i * INITIAL_SPACING)
    )
  })

  it('自动演示的输入序列重放结果完全确定', () => {
    const envs = autoDemoEnvs(1200)
    const first = runSteps(createInitialSimState(), envs)
    const second = runSteps(createInitialSimState(), envs)
    expect(second).toEqual(first)
  })

  it('store 的重置与停止自动演示提供统一收敛点', () => {
    const store = useWaterStore.getState()
    store.addCollisions(7)
    expect(useWaterStore.getState().collisionCount).toBe(7)

    const tokenBefore = useWaterStore.getState().simResetToken
    useWaterStore.getState().reset()
    expect(useWaterStore.getState().collisionCount).toBe(0)
    expect(useWaterStore.getState().simResetToken).toBe(tokenBefore + 1)
    expect(useWaterStore.getState().isAutoDemo).toBe(false)

    useWaterStore.getState().startAutoDemo()
    useWaterStore.getState().addCollisions(3)
    const tokenAfterReset = useWaterStore.getState().simResetToken
    useWaterStore.getState().stopAutoDemo()
    expect(useWaterStore.getState().isAutoDemo).toBe(false)
    expect(useWaterStore.getState().collisionCount).toBe(0)
    expect(useWaterStore.getState().simResetToken).toBe(tokenAfterReset + 1)
  })
})
