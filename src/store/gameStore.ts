import { create } from 'zustand'
import { DEFAULT_SHIPS } from '../simulation/defaultFleet.ts'
import { DEFAULT_WATER_LEVEL, DEFAULT_WIND_SPEED } from '../simulation/constants.ts'
import type { ShipData } from '../simulation/types.ts'

export type { ShipData, ShipType, NavigationStatus } from '../simulation/types.ts'

interface GameState {
  waterLevel: number
  windSpeed: number
  selectedShipId: string | null
  ships: ShipData[]
  alertActive: boolean
  setWaterLevel: (level: number) => void
  setWindSpeed: (speed: number) => void
  setSelectedShipId: (id: string | null) => void
  updateShip: (id: string, data: Partial<ShipData>) => void
  setAlertActive: (active: boolean) => void
}

export const useGameStore = create<GameState>((set) => ({
  waterLevel: DEFAULT_WATER_LEVEL,
  windSpeed: DEFAULT_WIND_SPEED,
  selectedShipId: null,
  ships: DEFAULT_SHIPS.map((ship) => ({ ...ship })),
  alertActive: false,
  setWaterLevel: (level) => set({ waterLevel: level }),
  setWindSpeed: (speed) => set({ windSpeed: speed }),
  setSelectedShipId: (id) => set({ selectedShipId: id }),
  updateShip: (id, data) =>
    set((state) => ({
      ships: state.ships.map((ship) =>
        ship.id === id ? { ...ship, ...data } : ship
      ),
    })),
  setAlertActive: (active) => set({ alertActive: active }),
}))
