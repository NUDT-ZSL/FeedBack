import { createSimulation, stepSimulation } from '../engine'
import { initialShips } from '../initialShips'
import { ShipData, ShipType, SimulationState } from '../types'

let seq = 0

export function makeShip(overrides: Partial<ShipData> = {}): ShipData {
  seq += 1
  return {
    id: `test-ship-${seq}`,
    name: `测试船${seq}`,
    type: 'cargo',
    color: '#000000',
    cargo: '测试货',
    cargoWeight: 100,
    draft: 2,
    speed: 1,
    progress: 0,
    navigationStatus: 'normal',
    ...overrides,
  }
}

export function makeFleet(): ShipData[] {
  return initialShips.map((ship) => ({ ...ship }))
}

export function newState(
  overrides: { ships?: ShipData[]; waterLevel?: number; windSpeed?: number } = {},
): SimulationState {
  return createSimulation({
    ships: overrides.ships ?? makeFleet(),
    waterLevel: overrides.waterLevel,
    windSpeed: overrides.windSpeed,
  })
}

export const FRAME = 1 / 60

export function steps(state: SimulationState, count: number, delta = FRAME): SimulationState {
  let next = state
  for (let i = 0; i < count; i += 1) {
    next = stepSimulation(next, delta)
  }
  return next
}

export function shipOf(type: ShipType, overrides: Partial<ShipData> = {}): ShipData {
  return makeShip({ type, ...overrides })
}
