import { create } from 'zustand'
import * as TWEEN from '@tweenjs/tween.js'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SHICHEN = [
  { name: '子时', angle: 270, hours: '23:00-01:00' },
  { name: '丑时', angle: 300, hours: '01:00-03:00' },
  { name: '寅时', angle: 330, hours: '03:00-05:00' },
  { name: '卯时', angle: 0, hours: '05:00-07:00' },
  { name: '辰时', angle: 30, hours: '07:00-09:00' },
  { name: '巳时', angle: 60, hours: '09:00-11:00' },
  { name: '午时', angle: 90, hours: '11:00-13:00' },
  { name: '未时', angle: 120, hours: '13:00-15:00' },
  { name: '申时', angle: 150, hours: '15:00-17:00' },
  { name: '酉时', angle: 180, hours: '17:00-19:00' },
  { name: '戌时', angle: 210, hours: '19:00-21:00' },
  { name: '亥时', angle: 240, hours: '21:00-23:00' },
]

export const SEASONS: Record<Season, { name: string; sunHeight: number; sunAngle: number }> = {
  spring: { name: '春分', sunHeight: 45, sunAngle: 90 },
  summer: { name: '夏至', sunHeight: 70, sunAngle: 90 },
  autumn: { name: '秋分', sunHeight: 45, sunAngle: 90 },
  winter: { name: '冬至', sunHeight: 20, sunAngle: 90 },
}

interface SundialState {
  gnomonElevation: number
  gnomonRotation: number
  currentSeason: Season
  highlightedShichen: string
  shadowLength: number
  gnomonShadowLength: number
  setGnomonElevation: (angle: number) => void
  setGnomonRotation: (angle: number) => void
  setCurrentSeason: (season: Season) => void
  setHighlightedShichen: (shichen: string) => void
  setShadowLength: (length: number) => void
  setGnomonShadowLength: (length: number) => void
  resetView: () => void
  animateToSeason: (season: Season) => void
}

export const useSundialStore = create<SundialState>((set, get) => ({
  gnomonElevation: 45,
  gnomonRotation: 0,
  currentSeason: 'spring',
  highlightedShichen: '卯时',
  shadowLength: 0,
  gnomonShadowLength: 0,

  setGnomonElevation: (angle: number) => set({ gnomonElevation: angle }),
  setGnomonRotation: (angle: number) => set({ gnomonRotation: angle }),
  setCurrentSeason: (season: Season) => set({ currentSeason: season }),
  setHighlightedShichen: (shichen: string) => set({ highlightedShichen: shichen }),
  setShadowLength: (length: number) => set({ shadowLength: length }),
  setGnomonShadowLength: (length: number) => set({ gnomonShadowLength: length }),

  resetView: () => {
    const state = get()
    new TWEEN.Tween({ elevation: state.gnomonElevation, rotation: state.gnomonRotation })
      .to({ elevation: 45, rotation: 0 }, 500)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate((obj) => {
        set({ gnomonElevation: obj.elevation, gnomonRotation: obj.rotation })
      })
      .start()
  },

  animateToSeason: (season: Season) => {
    const targetHeight = SEASONS[season].sunHeight
    set({ currentSeason: season })
    
    new TWEEN.Tween({ elevation: get().gnomonElevation })
      .to({ elevation: targetHeight }, 500)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate((obj) => {
        set({ gnomonElevation: obj.elevation })
      })
      .start()
  },
}))
