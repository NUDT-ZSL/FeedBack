import { create } from 'zustand'
import * as TWEEN from '@tweenjs/tween.js'
import {
  Season,
  SEASONS,
  INITIAL_ELEVATION,
  INITIAL_ROTATION,
  INITIAL_SEASON,
  deriveShadow,
  deriveTableShadowLength,
} from '../lib/sundial'

export type { Season } from '../lib/sundial'
export { SHICHEN, SEASONS } from '../lib/sundial'

interface DerivedSlice {
  highlightedShichen: string
  shadowLength: number
  gnomonShadowLength: number
  shadowTipX: number
  shadowTipZ: number
  shadowBearing: number
  shadowWithinDial: boolean
}

interface SundialState extends DerivedSlice {
  gnomonElevation: number
  gnomonRotation: number
  currentSeason: Season
  setGnomonElevation: (angle: number) => void
  setGnomonRotation: (angle: number) => void
  animateToSeason: (season: Season) => void
  resetView: () => void
}

function derivedSlice(elevation: number, rotation: number, season: Season): DerivedSlice {
  const derived = deriveShadow(elevation, rotation, season)
  return {
    highlightedShichen: derived.highlightedShichen,
    gnomonShadowLength: derived.length,
    shadowTipX: derived.tipX,
    shadowTipZ: derived.tipZ,
    shadowBearing: derived.bearing,
    shadowWithinDial: derived.withinDial,
    shadowLength: deriveTableShadowLength(season),
  }
}

let poseTween: TWEEN.Tween<{ elevation: number; rotation: number }> | null = null

function stopPoseTween() {
  if (poseTween) {
    poseTween.stop()
    poseTween = null
  }
}

export const useSundialStore = create<SundialState>((set, get) => {
  const applyPose = (elevation: number, rotation: number) => {
    set({
      gnomonElevation: elevation,
      gnomonRotation: rotation,
      ...derivedSlice(elevation, rotation, get().currentSeason),
    })
  }

  const tweenPoseTo = (target: { elevation?: number; rotation?: number }, duration = 500) => {
    stopPoseTween()
    const from = { elevation: get().gnomonElevation, rotation: get().gnomonRotation }
    const to = {
      elevation: target.elevation ?? from.elevation,
      rotation: target.rotation ?? from.rotation,
    }
    poseTween = new TWEEN.Tween(from)
      .to(to, duration)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate((value) => {
        applyPose(value.elevation, value.rotation)
      })
      .onComplete(() => {
        poseTween = null
      })
      .start()
  }

  return {
    gnomonElevation: INITIAL_ELEVATION,
    gnomonRotation: INITIAL_ROTATION,
    currentSeason: INITIAL_SEASON,
    ...derivedSlice(INITIAL_ELEVATION, INITIAL_ROTATION, INITIAL_SEASON),

    setGnomonElevation: (angle: number) => {
      stopPoseTween()
      applyPose(angle, get().gnomonRotation)
    },

    setGnomonRotation: (angle: number) => {
      stopPoseTween()
      applyPose(get().gnomonElevation, angle)
    },

    animateToSeason: (season: Season) => {
      stopPoseTween()
      set({ currentSeason: season })
      applyPose(get().gnomonElevation, get().gnomonRotation)
      tweenPoseTo({ elevation: SEASONS[season].sunHeight })
    },

    resetView: () => {
      stopPoseTween()
      set({ currentSeason: INITIAL_SEASON })
      applyPose(get().gnomonElevation, get().gnomonRotation)
      tweenPoseTo({ elevation: INITIAL_ELEVATION, rotation: INITIAL_ROTATION })
    },
  }
})
