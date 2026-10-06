import { describe, expect, it } from 'vitest'
import { getSimulationSnapshot } from '../engine'
import { replaySimulation } from '../replay'
import { SimOp } from '../types'
import { newState } from './helpers'

// 一段覆盖全部操作类型的混合脚本：推进、环境调整（含越界）、选中/取消
const SCRIPT: SimOp[] = [
  { type: 'tick', delta: 1 / 60 },
  { type: 'tick', delta: 1 / 60 },
  { type: 'setWaterLevel', value: 3 },
  { type: 'tick', delta: 0.05 },
  { type: 'selectShip', id: 'ship1' },
  { type: 'setWindSpeed', value: 8 },
  { type: 'tick', delta: 1 / 60 },
  { type: 'setWaterLevel', value: 12 }, // 越界 → 钳到 10
  { type: 'toggleShip', id: 'ship1' }, // 取消选中
  { type: 'toggleShip', id: 'ship1' }, // 重新选中
  { type: 'setWindSpeed', value: -2 }, // 越界 → 钳到 0
  { type: 'tick', delta: 0.1 },
  { type: 'tick', delta: 0.1 },
  { type: 'selectShip', id: 'phantom' }, // 不存在 → 拒绝
  { type: 'setWaterLevel', value: 5 },
  { type: 'setWindSpeed', value: 2 },
  { type: 'tick', delta: 1 / 60 },
]

describe('离线批量回放的确定性与可比对性', () => {
  it('同一初始条件 + 同一操作序列 → 完全一致的最终状态', () => {
    const first = replaySimulation(newState(), SCRIPT)
    const second = replaySimulation(newState(), SCRIPT)
    expect(getSimulationSnapshot(first.state)).toEqual(getSimulationSnapshot(second.state))
    expect(first.entries).toEqual(second.entries)
  })

  it('回放日志逐步记录操作、状态演变与越界留痕', () => {
    const { entries } = replaySimulation(newState(), SCRIPT)
    expect(entries).toHaveLength(SCRIPT.length)

    // 水位调整步骤记录了数值变化
    const waterStep = entries[2]
    expect(waterStep.notes.join(' ')).toContain('水位 5 → 3')

    // 越界输入步骤记录了钳制依据
    const clampStep = entries[7]
    expect(clampStep.notes.join(' ')).toContain('输入越界[waterLevel]')
    expect(clampStep.snapshot.waterLevel).toBe(10)

    // 选中/取消步骤记录了选中态变化
    expect(entries[8].notes.join(' ')).toContain('选中 ship1 → 无')
    expect(entries[9].notes.join(' ')).toContain('选中 无 → ship1')

    // 不存在的船舶被拒绝并留痕
    expect(entries[13].notes.join(' ')).toContain('不存在')
    expect(entries[13].snapshot.selectedShipId).toBe('ship1')
  })

  it('最终快照包含每船位置/吃水/状态与告警结论，可序列化比对', () => {
    const { state } = replaySimulation(newState(), SCRIPT)
    const snapshot = getSimulationSnapshot(state)
    expect(() => JSON.stringify(snapshot)).not.toThrow()
    for (const ship of snapshot.ships) {
      expect(ship).toHaveProperty('positionX')
      expect(ship).toHaveProperty('effectiveDraft')
      expect(ship).toHaveProperty('clearance')
      expect(ship).toHaveProperty('navigationStatus')
    }
    expect(snapshot.violationCount).toBe(3)
  })

  it('黄金快照：口径调整前后可用此基准做差异比对', () => {
    const { state } = replaySimulation(newState(), SCRIPT)
    expect(getSimulationSnapshot(state)).toMatchSnapshot()
  })

  it('回放日志快照：每步依据可整体比对', () => {
    const { entries } = replaySimulation(newState(), SCRIPT)
    expect(entries.map((e) => e.notes)).toMatchSnapshot()
  })
})
