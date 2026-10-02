import { create } from 'zustand'

export type ShipType = 'cargo' | 'passenger' | 'fishing' | 'pleasure'

export interface ShipData {
  id: string
  name: string
  type: ShipType
  color: string
  cargo: string
  cargoWeight: number
  draft: number
  speed: number
  progress: number
  navigationStatus: 'normal' | 'warning' | 'danger'
}

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

const initialShips: ShipData[] = [
  { id: 'ship1', name: '太平号', type: 'cargo', color: '#c4a35a', cargo: '江南稻米', cargoWeight: 120, draft: 2.8, speed: 1.2, progress: 0.1, navigationStatus: 'normal' },
  { id: 'ship2', name: '春风号', type: 'passenger', color: '#e07b3a', cargo: '商旅旅客', cargoWeight: 45, draft: 1.8, speed: 1.8, progress: 0.3, navigationStatus: 'normal' },
  { id: 'ship3', name: '渔家乐', type: 'fishing', color: '#6b8e6b', cargo: '鲜活水产', cargoWeight: 25, draft: 1.2, speed: 2.2, progress: 0.5, navigationStatus: 'normal' },
  { id: 'ship4', name: '锦绣舫', type: 'pleasure', color: '#c41e3a', cargo: '文人雅集', cargoWeight: 15, draft: 1.5, speed: 0.8, progress: 0.7, navigationStatus: 'normal' },
  { id: 'ship5', name: '广济号', type: 'cargo', color: '#b8956b', cargo: '青瓷瓷器', cargoWeight: 95, draft: 2.5, speed: 1.0, progress: 0.2, navigationStatus: 'normal' },
  { id: 'ship6', name: '顺安号', type: 'passenger', color: '#d6612e', cargo: '赴京学子', cargoWeight: 38, draft: 1.6, speed: 1.5, progress: 0.85, navigationStatus: 'normal' },
]

export const useGameStore = create<GameState>((set) => ({
  waterLevel: 5,
  windSpeed: 2,
  selectedShipId: null,
  ships: initialShips,
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
