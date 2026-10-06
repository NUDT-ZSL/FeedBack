import { create } from 'zustand';
import type { PitchResult } from '../utils/gameLogic';
import { TOTAL_PITCHES } from '../utils/gameLogic';
import type {
  GuestReaction,
  GuestSeat,
} from '../utils/guestLogic';
import {
  assignGuestSeats,
  createIdleReaction,
  resolveRoundReactions,
} from '../utils/guestLogic';

export interface PitchRecord {
  result: PitchResult;
  score: number;
  label: string;
}

interface GameState {
  totalScore: number;
  pitchesRemaining: number;
  pitchHistory: PitchRecord[];
  consecutiveSuccesses: number;
  gameOver: boolean;
  gameSeed: number;
  guests: GuestSeat[];
  guestReactions: GuestReaction[];
  potEffect: 'idle' | 'hit' | 'ear';
  showSigh: boolean;

  settlePitch: (record: PitchRecord) => void;
  clearReactions: () => void;
  resetGame: (seed?: number) => void;
  setPotEffect: (effect: 'idle' | 'hit' | 'ear') => void;
  setShowSigh: (show: boolean) => void;
}

const initialSeed = Math.floor(Math.random() * 0xffffffff);

export const useGameStore = create<GameState>((set) => ({
  totalScore: 0,
  pitchesRemaining: TOTAL_PITCHES,
  pitchHistory: [],
  consecutiveSuccesses: 0,
  gameOver: false,
  gameSeed: initialSeed,
  guests: assignGuestSeats(initialSeed),
  guestReactions: Array.from({ length: 6 }, () => createIdleReaction()),
  potEffect: 'idle',
  showSigh: false,

  settlePitch: (record) =>
    set((state) => {
      const newHistory = [...state.pitchHistory, record];
      const newRemaining = state.pitchesRemaining - 1;
      const newScore = state.totalScore + record.score;
      const newStreak =
        record.result === 'miss' ? 0 : state.consecutiveSuccesses + 1;

      const guestReactions = resolveRoundReactions(state.guests, {
        result: record.result,
        consecutiveSuccesses: newStreak,
        totalScore: newScore,
        pitchesRemaining: newRemaining,
        maxPitches: TOTAL_PITCHES,
      });

      return {
        totalScore: newScore,
        pitchesRemaining: newRemaining,
        pitchHistory: newHistory,
        consecutiveSuccesses: newStreak,
        gameOver: newRemaining <= 0,
        guestReactions,
      };
    }),

  clearReactions: () =>
    set((state) => ({
      guestReactions: state.guestReactions.map(() => createIdleReaction()),
    })),

  resetGame: (seed) => {
    const nextSeed =
      seed !== undefined ? seed >>> 0 : Math.floor(Math.random() * 0xffffffff);
    set({
      totalScore: 0,
      pitchesRemaining: TOTAL_PITCHES,
      pitchHistory: [],
      consecutiveSuccesses: 0,
      gameOver: false,
      gameSeed: nextSeed,
      guests: assignGuestSeats(nextSeed),
      guestReactions: Array.from({ length: 6 }, () => createIdleReaction()),
      potEffect: 'idle',
      showSigh: false,
    });
  },

  setPotEffect: (effect) => set({ potEffect: effect }),
  setShowSigh: (show) => set({ showSigh: show }),
}));

export function getGameSeed(): number {
  return useGameStore.getState().gameSeed;
}

export function getGuests(): GuestSeat[] {
  return useGameStore.getState().guests;
}
