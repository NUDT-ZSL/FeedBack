import { create } from 'zustand'
import type { Work } from '../data/mockData'

interface PlayerState {
  currentWork: Work | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  setCurrentWork: (work: Work | null) => void
  togglePlay: () => void
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentWork: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  setCurrentWork: (work) => set({ currentWork: work, currentTime: 0, isPlaying: true }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
}))
