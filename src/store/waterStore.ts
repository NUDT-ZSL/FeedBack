import { create } from 'zustand'

interface WaterState {
  gateOpening: number
  slope: number
  curvature: number
  collisionCount: number
  isAutoDemo: boolean
  setGateOpening: (value: number) => void
  setSlope: (value: number) => void
  setCurvature: (value: number) => void
  incrementCollision: () => void
  reset: () => void
  startAutoDemo: () => void
  stopAutoDemo: () => void
  easeValue: (target: number, current: number, factor?: number) => number
}

export const useWaterStore = create<WaterState>((set) => ({
  gateOpening: 50,
  slope: 15,
  curvature: 45,
  collisionCount: 0,
  isAutoDemo: false,

  setGateOpening: (value: number) => set({ gateOpening: Math.max(0, Math.min(100, value)) }),
  setSlope: (value: number) => set({ slope: Math.max(0, Math.min(30, value)) }),
  setCurvature: (value: number) => set({ curvature: Math.max(0, Math.min(90, value)) }),

  incrementCollision: () => set(state => ({ collisionCount: state.collisionCount + 1 })),

  reset: () => set({
    gateOpening: 50,
    slope: 15,
    curvature: 45,
    collisionCount: 0,
    isAutoDemo: false
  }),

  startAutoDemo: () => set({ isAutoDemo: true }),
  stopAutoDemo: () => set({ isAutoDemo: false }),

  easeValue: (target: number, current: number, factor: number = 0.1) => {
    return current + (target - current) * factor
  }
}))

export const getWaterDepth = (gateOpening: number): number => {
  return 0.1 + (gateOpening / 100) * 0.3
}

export const getFlowSpeed = (gateOpening: number, slope: number): number => {
  const baseSpeed = 0.5
  const gateFactor = (gateOpening / 100) * 0.5
  const slopeFactor = (slope / 30) * 0.3
  return baseSpeed + gateFactor + slopeFactor
}

export const getSlopeSpeedMultiplier = (slope: number): number => {
  return Math.pow(1.2, Math.floor(slope / 10))
}
