import { describe, expect, it } from 'vitest'
import { useGameStore } from '../../store/gameStore'
import {
  applyEnvironment,
  createSimulation,
  getShipReport,
  getSimulationSnapshot,
  initialShips,
  selectShip,
  stepSimulation,
} from '../../simulation'

const simOf = () => {
  const s = useGameStore.getState()
  return {
    tick: s.tick,
    waterLevel: s.waterLevel,
    windSpeed: s.windSpeed,
    ships: s.ships,
    selectedShipId: s.selectedShipId,
    alertActive: s.alertActive,
    violations: s.violations,
  }
}

describe('渲染层 store 与推演引擎的一致性', () => {
  it('store 初始状态等价于引擎默认推演状态', () => {
    const expected = createSimulation({ ships: initialShips })
    expect(getSimulationSnapshot(simOf())).toEqual(getSimulationSnapshot(expected))
  })

  it('store 的每次操作都与引擎逐步操作结果一致', () => {
    let engine = createSimulation({ ships: initialShips })
    const store = useGameStore.getState()

    store.setWaterLevel(3.5)
    engine = applyEnvironment(engine, { waterLevel: 3.5 })
    expect(getSimulationSnapshot(simOf())).toEqual(getSimulationSnapshot(engine))

    store.setWindSpeed(8)
    engine = applyEnvironment(engine, { windSpeed: 8 })
    expect(getSimulationSnapshot(simOf())).toEqual(getSimulationSnapshot(engine))

    store.advance(1 / 60)
    engine = stepSimulation(engine, 1 / 60)
    expect(getSimulationSnapshot(simOf())).toEqual(getSimulationSnapshot(engine))

    store.toggleShipSelection('ship2')
    engine = selectShip(engine, 'ship2')
    expect(simOf().selectedShipId).toBe(engine.selectedShipId)

    // 越界输入同样经引擎钳制并留痕
    store.setWaterLevel(-20)
    engine = applyEnvironment(engine, { waterLevel: -20 })
    expect(getSimulationSnapshot(simOf())).toEqual(getSimulationSnapshot(engine))
    expect(simOf().violations).toHaveLength(1)
  })

  it('选中船的报告可直接从 store 状态生成并与推演一致', () => {
    const store = useGameStore.getState()
    store.setSelectedShipId('ship1')
    store.setWindSpeed(8)
    const report = getShipReport(simOf(), 'ship1')!
    const ship = simOf().ships.find((s) => s.id === 'ship1')!
    expect(report.navigationStatus).toBe(ship.navigationStatus)
    expect(report.basis.length).toBeGreaterThan(0)
  })
})
