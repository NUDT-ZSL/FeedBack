import { create } from 'zustand';
import type { GamePhase, Score, TeaPattern, GalleryItem, MatchRecord, PersistedStateV1, StoredGalleryItem } from '@/types';
import {
  computeMatchStats,
  createMemoryStorage,
  emptyPersistedState,
  getDefaultStorage,
  loadPersistedState,
  nextRoundFromRecords,
  resolveGalleryConflict,
  resolveRecordConflict,
  savePersistedState,
  upsertGalleryItem,
  upsertMatchRecord,
  type StorageLike,
} from '@/lib/persistence';

interface GameState {
  currentRound: number;
  phase: GamePhase;

  waterAmount: number;
  whiskSpeed: number;
  whiskDuration: number;

  foamThickness: number;
  foamColor: number;
  foamDuration: number;
  foamAdhesion: number;

  userScore: Score;
  aiScore: Score;

  gallery: StoredGalleryItem[];
  records: MatchRecord[];
  currentPattern: TeaPattern | null;
  roundRecorded: boolean;

  startRound: () => void;
  setWaterAmount: (amount: number) => void;
  setWhiskData: (speed: number, duration: number) => void;
  calculateFoam: () => void;
  calculateUserScore: () => void;
  setAiScore: (score: Score) => void;
  setCurrentPattern: (pattern: TeaPattern | null) => void;
  saveToGallery: (item: Omit<GalleryItem, 'id' | 'createdAt'>) => void;
  recordRoundResult: () => void;
  adjudicateGallery: (conflictKey: string, keepId: string) => void;
  adjudicateRecord: (conflictKey: string, keepId: string) => void;
  matchStats: () => { wins: number; losses: number; draws: number; total: number };
  setPhase: (phase: GamePhase) => void;
  clearRound: () => void;
}

const initialScore: Score = { color: 0, duration: 0, adhesion: 0, total: 0 };

const storage: StorageLike = getDefaultStorage();
const restored: PersistedStateV1 =
  typeof window === 'undefined' ? emptyPersistedState() : loadPersistedState(storage);

function persist(get: () => GameState): void {
  const { gallery, records } = get();
  savePersistedState(storage, { version: 1, gallery, records });
}

export const useGameStore = create<GameState>((set, get) => ({
  currentRound: nextRoundFromRecords(restored.records),
  phase: 'idle',

  waterAmount: 0,
  whiskSpeed: 0,
  whiskDuration: 0,

  foamThickness: 0,
  foamColor: 0,
  foamDuration: 0,
  foamAdhesion: 0,

  userScore: { ...initialScore },
  aiScore: { ...initialScore },

  gallery: restored.gallery,
  records: restored.records,
  currentPattern: null,
  roundRecorded: false,

  startRound: () => {
    set({
      phase: 'pouring',
      waterAmount: 0,
      whiskSpeed: 0,
      whiskDuration: 0,
      foamThickness: 0,
      foamColor: 0,
      foamDuration: 0,
      foamAdhesion: 0,
      userScore: { ...initialScore },
      aiScore: { ...initialScore },
      currentPattern: null,
      roundRecorded: false,
    });
  },

  setWaterAmount: (amount) => set({ waterAmount: amount }),

  setWhiskData: (speed, duration) => set({ whiskSpeed: speed, whiskDuration: duration }),

  calculateFoam: () => {
    const { waterAmount, whiskSpeed, whiskDuration } = get();
    const idealWater = 60;
    const waterScore = Math.max(0, 100 - Math.abs(waterAmount - idealWater) / idealWater * 50);
    const speedScore = Math.min(100, whiskSpeed / 15 * 100);
    const durationScore = Math.min(100, whiskDuration / 3000 * 100);
    const foamThickness = speedScore * 0.4 + durationScore * 0.4 + waterScore * 0.2;
    const foamColor = speedScore * 0.5 + durationScore * 0.3 + waterScore * 0.2;
    const foamDuration = ((foamThickness * 0.6 + foamColor * 0.4) / 100) * 10;
    const foamAdhesion = foamThickness * 0.7 + speedScore * 0.3;

    set({ foamThickness, foamColor, foamDuration, foamAdhesion });
  },

  calculateUserScore: () => {
    const { foamColor, foamDuration, foamAdhesion } = get();
    const color = Math.round(foamColor);
    const duration = Math.round(Math.min(100, (foamDuration / 10) * 100));
    const adhesion = Math.round(foamAdhesion);
    const total = Math.round((color + duration + adhesion) / 3);

    set({
      userScore: { color, duration, adhesion, total },
      phase: 'ai_playing',
    });
  },

  setAiScore: (score) => {
    set({ aiScore: score, phase: 'scoring' });
    get().recordRoundResult();
  },

  setCurrentPattern: (pattern) => set({ currentPattern: pattern, phase: 'pattern_showing' }),

  saveToGallery: (item) => {
    const { currentRound, gallery, records } = get();
    const next = upsertGalleryItem(
      { version: 1, gallery, records },
      {
        round: currentRound,
        patternKey: item.pattern.type,
        item,
      },
    );
    set({ gallery: next.gallery });
    persist(get);
  },

  recordRoundResult: () => {
    const { currentRound, userScore, aiScore, gallery, records, roundRecorded } = get();
    if (roundRecorded) return;
    if (aiScore.total <= 0 && userScore.total <= 0) return;
    const next = upsertMatchRecord(
      { version: 1, gallery, records },
      { round: currentRound, userScore, aiScore },
    );
    set({ records: next.records, roundRecorded: true });
    persist(get);
  },

  adjudicateGallery: (conflictKey, keepId) => {
    const { gallery, records } = get();
    const next = resolveGalleryConflict({ version: 1, gallery, records }, conflictKey, keepId);
    set({ gallery: next.gallery });
    persist(get);
  },

  adjudicateRecord: (conflictKey, keepId) => {
    const { gallery, records } = get();
    const next = resolveRecordConflict({ version: 1, gallery, records }, conflictKey, keepId);
    set({ records: next.records });
    persist(get);
  },

  matchStats: () => computeMatchStats(get().records),

  setPhase: (phase) => set({ phase }),

  clearRound: () => {
    const { currentRound } = get();
    set({
      currentRound: currentRound + 1,
      phase: 'idle',
      roundRecorded: false,
    });
  },
}));

export { createMemoryStorage };
