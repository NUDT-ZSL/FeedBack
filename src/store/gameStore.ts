import { create } from 'zustand';
import type { PitchResult } from '../utils/gameLogic';
import { TOTAL_PITCHES } from '../utils/gameLogic';
import {
  assignGuestSeats,
  decideAllGuestReactions,
  idleReaction,
  REACTION_DURATION_MS,
} from '../utils/guestReactions';
import type { GuestReaction, GuestSeat } from '../utils/guestReactions';

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
  roundSeed: number;
  guests: GuestSeat[];
  guestReactions: Record<number, GuestReaction>;
  potEffect: 'idle' | 'hit' | 'ear';
  showSigh: boolean;

  recordPitch: (record: PitchRecord) => void;
  resetGame: () => void;
  setPotEffect: (effect: 'idle' | 'hit' | 'ear') => void;
  setShowSigh: (show: boolean) => void;
}

let reactionTimer: ReturnType<typeof setTimeout> | null = null;

function clearReactionTimer() {
  if (reactionTimer !== null) {
    clearTimeout(reactionTimer);
    reactionTimer = null;
  }
}

function allIdleReactions(guests: GuestSeat[]): Record<number, GuestReaction> {
  const reactions: Record<number, GuestReaction> = {};
  for (const guest of guests) {
    reactions[guest.id] = idleReaction();
  }
  return reactions;
}

function buildRound(seed: number) {
  const guests = assignGuestSeats(seed);
  return {
    roundSeed: seed,
    guests,
    guestReactions: allIdleReactions(guests),
  };
}

const initialSeed = 1 + Math.floor(Math.random() * 0xffffffff);

export const useGameStore = create<GameState>((set) => ({
  totalScore: 0,
  pitchesRemaining: TOTAL_PITCHES,
  pitchHistory: [],
  gameOver: false,
  ...buildRound(initialSeed),
  potEffect: 'idle',
  showSigh: false,

  recordPitch: (record) =>
    set((state) => {
      const newHistory = [...state.pitchHistory, record];
      const newRemaining = state.pitchesRemaining - 1;
      const newScore = state.totalScore + record.score;

      clearReactionTimer();
      const guestReactions = decideAllGuestReactions(state.guests, {
        result: record.result,
        totalScore: newScore,
        pitchesRemaining: newRemaining,
        pitchHistory: newHistory,
      });
      reactionTimer = setTimeout(() => {
        reactionTimer = null;
        set((current) => ({ guestReactions: allIdleReactions(current.guests) }));
      }, REACTION_DURATION_MS);

      return {
        totalScore: newScore,
        pitchesRemaining: newRemaining,
        pitchHistory: newHistory,
        gameOver: newRemaining <= 0,
        guestReactions,
      };
    }),

  resetGame: () =>
    set(() => {
      clearReactionTimer();
      const nextSeed = 1 + Math.floor(Math.random() * 0xffffffff);
      return {
        totalScore: 0,
        pitchesRemaining: TOTAL_PITCHES,
        pitchHistory: [],
        gameOver: false,
        potEffect: 'idle',
        showSigh: false,
        ...buildRound(nextSeed),
      };
    }),

  setPotEffect: (effect) => set({ potEffect: effect }),
  setShowSigh: (show) => set({ showSigh: show }),
}));
