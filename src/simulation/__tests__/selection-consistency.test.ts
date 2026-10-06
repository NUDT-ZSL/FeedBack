import { describe, expect, it } from 'vitest'
import {
  applyEnvironment,
  getShipReport,
  getSimulationSnapshot,
  selectShip,
  stepSimulation,
  toggleShipSelection,
} from '../engine'
import { FRAME, makeShip, newState, steps } from './helpers'

describe('选中船舶与推演结论的联动一致性', () => {
  it('选中后环境变化，展示结论与推演结果同步更新', () => {
    const ship = makeShip({ id: 's1', draft: 1, cargoWeight: 10 })
    let state = newState({ ships: [ship], waterLevel: 8, windSpeed: 2 })
    state = selectShip(state, 's1')
    expect(state.selectedShipId).toBe('s1')

    const before = getShipReport(state, 's1')!
    expect(before.navigationStatus).toBe('normal')
    expect(before.statusLabel).toBe('正常通行')

    // 水位骤降 → 状态翻转，报告立即反映新结论
    state = applyEnvironment(state, { waterLevel: 5 })
    const after = getShipReport(state, 's1')!
    expect(after.navigationStatus).toBe('warning')
    expect(after.statusLabel).toBe('谨慎通过')
    expect(after.navigationStatus).toBe(state.ships[0].navigationStatus)
  })

  it('报告中的每项结论都附带可复核的判定依据', () => {
    const ship = makeShip({ id: 's1', draft: 2.8, cargoWeight: 10 })
    const state = selectShip(newState({ ships: [ship], waterLevel: 5 }), 's1')
    const report = getShipReport(state, 's1')!

    expect(report.basis.length).toBeGreaterThanOrEqual(3)
    expect(report.basis.join(' ')).toContain('有效吃水')
    expect(report.basis.join(' ')).toContain('净余水深')
    expect(report.basis.join(' ')).toContain('谨慎通过')
    // 依据中的数值与快照字段一致
    expect(report.basis.join(' ')).toContain(String(report.clearance))
  })

  it('超载船的报告包含载重上调依据', () => {
    const ship = makeShip({ id: 's1', type: 'pleasure', draft: 1, cargoWeight: 25 })
    const state = newState({ ships: [ship], waterLevel: 8 })
    const report = getShipReport(state, 's1')!
    expect(report.navigationStatus).toBe('warning')
    expect(report.basis.join(' ')).toContain('超过船型上限')
    expect(report.basis.join(' ')).toContain('风险上调一级')
  })

  it('重复选中/取消同一船舶是幂等的，不产生异常', () => {
    let state = newState()
    state = toggleShipSelection(state, 'ship1')
    expect(state.selectedShipId).toBe('ship1')
    state = toggleShipSelection(state, 'ship1')
    expect(state.selectedShipId).toBeNull()
    state = toggleShipSelection(state, 'ship1')
    state = toggleShipSelection(state, 'ship1')
    state = toggleShipSelection(state, 'ship1')
    expect(state.selectedShipId).toBe('ship1')
    expect(state.violations).toHaveLength(0)
  })

  it('选中不存在的船舶被拒绝并留痕，选中态不被污染', () => {
    let state = newState()
    state = selectShip(state, 'ship2')
    state = selectShip(state, 'ghost-ship')
    expect(state.selectedShipId).toBe('ship2')
    expect(state.violations).toHaveLength(1)
    expect(state.violations[0].field).toBe('shipId')
    expect(state.violations[0].reason).toContain('不存在')
    // 其余状态未被局部改动
    expect(getSimulationSnapshot(state).ships).toEqual(
      getSimulationSnapshot(selectShip(newState(), 'ship2')).ships,
    )
  })

  it('推进多帧后选中船的报告仍与全局快照一致', () => {
    let state = newState()
    state = selectShip(state, 'ship3')
    state = steps(state, 90, FRAME)
    const report = getShipReport(state, state.selectedShipId!)!
    const snapshot = getSimulationSnapshot(state)
    const fromSnapshot = snapshot.ships.find((s) => s.id === 'ship3')!
    expect(report.progress).toBe(fromSnapshot.progress)
    expect(report.positionX).toBe(fromSnapshot.positionX)
    expect(report.navigationStatus).toBe(fromSnapshot.navigationStatus)
    expect(report.effectiveDraft).toBe(fromSnapshot.effectiveDraft)
  })

  it('取消选中后再次选中他船，结论互不串扰', () => {
    let state = newState()
    state = selectShip(state, 'ship1')
    state = selectShip(state, null)
    state = selectShip(state, 'ship5')
    expect(state.selectedShipId).toBe('ship5')
    const report = getShipReport(state, 'ship5')!
    expect(report.id).toBe('ship5')
    expect(report.name).toBe('广济号')
  })
})
