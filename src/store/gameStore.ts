import { create } from 'zustand';
import type { PitchResult } from '../utils/gameLogic';
import { TOTAL_PITCHES } from '../utils/gameLogic';

export interface PitchRecord {
  result: PitchResult;
  score: number;
  label: string;
}

interface GameState {
  totalScore: number;
  pitchesRemaining: number;
  pitchHistory: PitchRecord[];
  gameOver: boolean;
  npcReaction: 'idle' | 'cheer' | 'disappoint';
  potEffect: 'idle' | 'hit' | 'ear';
  showSigh: boolean;
  
  recordPitch: (record: PitchRecord) => void;
  resetGame: () => void;
  setNpcReaction: (reaction: 'idle' | 'cheer' | 'disappoint') => void;
  setPotEffect: (effect: 'idle' | 'hit' | 'ear') => void;
  setShowSigh: (show: boolean) => void;
}

export const useGameStore = create<GameState>((set) => ({
  totalScore: 0,
  pitchesRemaining: TOTAL_PITCHES,
  pitchHistory: [],
  gameOver: false,
  npcReaction: 'idle',
  potEffect: 'idle',
  showSigh: false,

  recordPitch: (record) =>
    set((state) => {
      const newHistory = [...state.pitchHistory, record];
      const newRemaining = state.pitchesRemaining - 1;
      const newScore = state.totalScore + record.score;
      return {
        totalScore: newScore,
        pitchesRemaining: newRemaining,
        pitchHistory: newHistory,
        gameOver: newRemaining <= 0,
      };
    }),

  resetGame: () =>
    set({
      totalScore: 0,
      pitchesRemaining: TOTAL_PITCHES,
      pitchHistory: [],
      gameOver: false,
      npcReaction: 'idle',
      potEffect: 'idle',
      showSigh: false,
    }),

  setNpcReaction: (reaction) => set({ npcReaction: reaction }),
  setPotEffect: (effect) => set({ potEffect: effect }),
  setShowSigh: (show) => set({ showSigh: show }),
}));
