import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export interface GlazeType {
  id: string
  name: string
  color: string
  viscosity: number
  tempRange: [number, number]
}

export interface GlazeStroke {
  id: string
  glazeId: string
  uvCoords: [number, number][]
  thickness: number
  timestamp: number
}

export interface TextureData {
  type: 'rabbit' | 'oil' | 'yohen' | 'none'
  intensity: number
  colorVariation: number[]
  spots: { x: number; y: number; size: number; color: string }[]
}

export interface TempPoint {
  time: number
  temp: number
}

export type FiringStage = 'idle' | 'heating' | 'cooling' | 'finished'

export interface PotState {
  position: 'table' | 'kiln' | 'display'
  hasGlaze: boolean
  hasFired: boolean
  currentTemp: number
  textureData: TextureData
}

export interface CameraState {
  azimuth: number
  elevation: number
  distance: number
  pan: [number, number]
}

export interface Store {
  camera: CameraState
  setCamera: (camera: Partial<CameraState>) => void
  
  glazes: GlazeType[]
  selectedGlaze: string | null
  selectGlaze: (id: string | null) => void
  
  glazeStrokes: GlazeStroke[]
  addGlazeStroke: (stroke: Omit<GlazeStroke, 'id' | 'timestamp'>) => void
  clearGlazeStrokes: () => void
  
  glazeThickness: number
  setGlazeThickness: (thickness: number) => void
  
  pot: PotState
  setPotPosition: (position: PotState['position']) => void
  setPotTemp: (temp: number) => void
  setTextureData: (data: Partial<TextureData>) => void
  markGlazed: () => void
  markFired: () => void
  resetPot: () => void
  
  kilnTargetTemp: number
  setKilnTargetTemp: (temp: number) => void
  firingStage: FiringStage
  startFiring: () => void
  stopFiring: () => void
  
  tempHistory: TempPoint[]
  addTempPoint: (point: TempPoint) => void
  clearTempHistory: () => void
  
  kilnDoorOpen: boolean
  setKilnDoorOpen: (open: boolean) => void
  
  showScroll: boolean
  setShowScroll: (show: boolean) => void
  scrollGenerating: boolean
  setScrollGenerating: (generating: boolean) => void
  
  isDraggingGlaze: boolean
  setIsDraggingGlaze: (dragging: boolean) => void
  dragPosition: { x: number; y: number } | null
  setDragPosition: (pos: { x: number; y: number } | null) => void
  
  useTongs: boolean
  setUseTongs: (use: boolean) => void
  
  fps: number
  setFps: (fps: number) => void
}

const defaultGlazes: GlazeType[] = [
  { id: '1', name: '天青釉', color: '#6ba7c4', viscosity: 0.6, tempRange: [1200, 1300] },
  { id: '2', name: '月白釉', color: '#e0e8e8', viscosity: 0.5, tempRange: [1150, 1250] },
  { id: '3', name: '梅子青釉', color: '#5d8a6b', viscosity: 0.7, tempRange: [1180, 1280] },
  { id: '4', name: '玫瑰紫釉', color: '#b56e7d', viscosity: 0.65, tempRange: [1220, 1300] },
  { id: '5', name: '铁锈花釉', color: '#8b4513', viscosity: 0.55, tempRange: [1250, 1320] },
]

const defaultPot: PotState = {
  position: 'table',
  hasGlaze: false,
  hasFired: false,
  currentTemp: 25,
  textureData: {
    type: 'none',
    intensity: 0,
    colorVariation: [0, 0, 0],
    spots: [],
  },
}

const defaultCamera: CameraState = {
  azimuth: 45,
  elevation: 30,
  distance: 8,
  pan: [0, 0],
}

export const useStore = create<Store>((set) => ({
  camera: defaultCamera,
  setCamera: (camera) => set((state) => ({ camera: { ...state.camera, ...camera } })),
  
  glazes: defaultGlazes,
  selectedGlaze: null,
  selectGlaze: (id) => set({ selectedGlaze: id }),
  
  glazeStrokes: [],
  addGlazeStroke: (stroke) =>
    set((state) => ({
      glazeStrokes: [...state.glazeStrokes, { ...stroke, id: uuidv4(), timestamp: Date.now() }],
    })),
  clearGlazeStrokes: () => set({ glazeStrokes: [] }),
  
  glazeThickness: 0.3,
  setGlazeThickness: (thickness) => set({ glazeThickness: Math.max(0.1, Math.min(0.5, thickness)) }),
  
  pot: defaultPot,
  setPotPosition: (position) => set((state) => ({ pot: { ...state.pot, position } })),
  setPotTemp: (temp) => set((state) => ({ pot: { ...state.pot, currentTemp: temp } })),
  setTextureData: (data) => set((state) => ({ pot: { ...state.pot, textureData: { ...state.pot.textureData, ...data } } })),
  markGlazed: () => set((state) => ({ pot: { ...state.pot, hasGlaze: true } })),
  markFired: () => set((state) => ({ pot: { ...state.pot, hasFired: true } })),
  resetPot: () => set({ pot: defaultPot, glazeStrokes: [] }),
  
  kilnTargetTemp: 1200,
  setKilnTargetTemp: (temp) => set({ kilnTargetTemp: Math.max(800, Math.min(1300, temp)) }),
  firingStage: 'idle',
  startFiring: () => {
    set({ firingStage: 'heating', kilnDoorOpen: false })
    set((state) => ({ pot: { ...state.pot, position: 'kiln' } }))
  },
  stopFiring: () => set({ firingStage: 'cooling' }),
  
  tempHistory: [],
  addTempPoint: (point) => set((state) => ({ tempHistory: [...state.tempHistory, point] })),
  clearTempHistory: () => set({ tempHistory: [] }),
  
  kilnDoorOpen: true,
  setKilnDoorOpen: (open) => set({ kilnDoorOpen: open }),
  
  showScroll: false,
  setShowScroll: (show) => set({ showScroll: show }),
  scrollGenerating: false,
  setScrollGenerating: (generating) => set({ scrollGenerating: generating }),
  
  isDraggingGlaze: false,
  setIsDraggingGlaze: (dragging) => set({ isDraggingGlaze: dragging }),
  dragPosition: null,
  setDragPosition: (pos) => set({ dragPosition: pos }),
  
  useTongs: false,
  setUseTongs: (use) => set({ useTongs: use }),
  
  fps: 60,
  setFps: (fps) => set({ fps }),
}))
