import { create } from 'zustand'
import {
  applyEnvironment,
  createSimulation,
  initialShips,
  selectShip,
  SimulationState,
  stepSimulation,
  toggleShipSelection,
} from '../simulation'

export type { ShipData, ShipType } from '../simulation'
import type { ShipData } from '../simulation'

interface GameState extends SimulationState {
  setWaterLevel: (level: number) => void
  setWindSpeed: (speed: number) => void
  setSelectedShipId: (id: string | null) => void
  toggleShipSelection: (id: string) => void
  updateShip: (id: string, data: Partial<ShipData>) => void
  setAlertActive: (active: boolean) => void
  advance: (delta: number) => void
}

const pickSim = (state: GameState): SimulationState => ({
  tick: state.tick,
  waterLevel: state.waterLevel,
  windSpeed: state.windSpeed,
  ships: state.ships,
  selectedShipId: state.selectedShipId,
  alertActive: state.alertActive,
  violations: state.violations,
})

// 渲染层只读写这份 store；所有推演口径都在 simulation 引擎中，
// 任何状态变化都以引擎的整体重算收尾，保证局部展示与全局推演一致。
export const useGameStore = create<GameState>((set) => ({
  ...createSimulation({ ships: initialShips }),
  setWaterLevel: (level) => set((state) => applyEnvironment(pickSim(state), { waterLevel: level })),
  setWindSpeed: (speed) => set((state) => applyEnvironment(pickSim(state), { windSpeed: speed })),
  setSelectedShipId: (id) => set((state) => selectShip(pickSim(state), id)),
  toggleShipSelection: (id) => set((state) => toggleShipSelection(pickSim(state), id)),
  updateShip: (id, data) =>
    set((state) => ({
      ships: state.ships.map((ship) =>
        ship.id === id ? { ...ship, ...data } : ship
      ),
    })),
  setAlertActive: (active) => set({ alertActive: active }),
  advance: (delta) => set((state) => stepSimulation(pickSim(state), delta)),
}))
