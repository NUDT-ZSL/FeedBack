import { create } from 'zustand'
import * as TWEEN from '@tweenjs/tween.js'
import {
  Season,
  SEASONS,
  SHICHEN,
  deriveSundial,
} from '../lib/sundialMath'

export { SHICHEN, SEASONS }
export type { Season }

const INITIAL_ELEVATION = 45
const INITIAL_ROTATION = 0
const INITIAL_SEASON: Season = 'spring'
const TWEEN_DURATION = 500

interface SundialState {
  gnomonElevation: number
  gnomonRotation: number
  currentSeason: Season
  highlightedShichen: string
  shadowLength: number
  gnomonShadowLength: number
  shadowBeyondDial: boolean
  setGnomonElevation: (angle: number) => void
  setGnomonRotation: (angle: number) => void
  animateToSeason: (season: Season) => void
  resetView: () => void
}

// 姿态补间按通道管理：手动输入只取消对应通道的补间，以最后一次用户输入为准。
type PoseChannel = 'elevation' | 'rotation'
const activeTweens: { channel: PoseChannel; tween: TWEEN.Tween<object> }[] = []

function stopTweens(channel?: PoseChannel) {
  const stopping = activeTweens.filter((e) => !channel || e.channel === channel)
  stopping.forEach((e) => e.tween.stop())
  const stopped = new Set(stopping.map((e) => e.tween))
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    if (stopped.has(activeTweens[i].tween)) activeTweens.splice(i, 1)
  }
}

function registerTween(channel: PoseChannel, tween: TWEEN.Tween<object>) {
  activeTweens.push({ channel, tween })
  tween.onComplete(() => {
    const i = activeTweens.findIndex((e) => e.tween === tween)
    if (i >= 0) activeTweens.splice(i, 1)
  })
}

export const useSundialStore = create<SundialState>((set, get) => {
  // 单条推演链路：任何输入变化都在同一次 set 中同步更新姿态、影长与时辰高亮。
  const commit = (patch: {
    gnomonElevation?: number
    gnomonRotation?: number
    currentSeason?: Season
  }) => {
    const s = get()
    const gnomonElevation = patch.gnomonElevation ?? s.gnomonElevation
    const gnomonRotation = patch.gnomonRotation ?? s.gnomonRotation
    const currentSeason = patch.currentSeason ?? s.currentSeason
    const derived = deriveSundial(gnomonElevation, gnomonRotation, currentSeason)
    set({ gnomonElevation, gnomonRotation, currentSeason, ...derived })
  }

  const initialDerived = deriveSundial(INITIAL_ELEVATION, INITIAL_ROTATION, INITIAL_SEASON)

  return {
    gnomonElevation: INITIAL_ELEVATION,
    gnomonRotation: INITIAL_ROTATION,
    currentSeason: INITIAL_SEASON,
    ...initialDerived,

    setGnomonElevation: (angle: number) => {
      stopTweens('elevation')
      commit({ gnomonElevation: angle })
    },

    setGnomonRotation: (angle: number) => {
      stopTweens('rotation')
      commit({ gnomonRotation: angle })
    },

    animateToSeason: (season: Season) => {
      stopTweens('elevation')
      commit({ currentSeason: season })
      const obj = { elevation: get().gnomonElevation }
      const tween = new TWEEN.Tween(obj)
        .to({ elevation: SEASONS[season].sunHeight }, TWEEN_DURATION)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(() => commit({ gnomonElevation: obj.elevation }))
      registerTween('elevation', tween)
      tween.start()
    },

    resetView: () => {
      stopTweens()
      commit({ currentSeason: INITIAL_SEASON })
      const obj = {
        elevation: get().gnomonElevation,
        rotation: get().gnomonRotation,
      }
      const tween = new TWEEN.Tween(obj)
        .to({ elevation: INITIAL_ELEVATION, rotation: INITIAL_ROTATION }, TWEEN_DURATION)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(() =>
          commit({ gnomonElevation: obj.elevation, gnomonRotation: obj.rotation })
        )
      registerTween('elevation', tween)
      registerTween('rotation', tween)
      tween.start()
    },
  }
})
