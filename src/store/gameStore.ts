import { create } from 'zustand';
import type { GamePhase, Score, TeaPattern, GalleryItem, RoundRecord } from '@/types';
import {
  appendRoundRecord,
  getDefaultStorage,
  loadGallery,
  loadRoundRecords,
  resolveRoundConflict,
  saveGallery,
  saveRoundRecords,
  upsertGalleryItem,
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
  
  gallery: GalleryItem[];
  currentPattern: TeaPattern | null;
  roundRecords: RoundRecord[];
  
  startRound: () => void;
  setWaterAmount: (amount: number) => void;
  setWhiskData: (speed: number, duration: number) => void;
  calculateFoam: () => void;
  calculateUserScore: () => void;
  setAiScore: (score: Score) => void;
  setCurrentPattern: (pattern: TeaPattern | null) => void;
  saveToGallery: (item: Omit<GalleryItem, 'id' | 'createdAt'>) => void;
  resolveConflict: (round: number, keepId: string) => void;
  setPhase: (phase: GamePhase) => void;
  clearRound: () => void;
}

const initialScore: Score = { color: 0, duration: 0, adhesion: 0, total: 0 };

export const useGameStore = create<GameState>((set, get) => ({
  currentRound: 1,
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
  
  gallery: loadGallery(),
  currentPattern: null,
  roundRecords: loadRoundRecords(),
  
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
    const foamThickness = (speedScore * 0.4 + durationScore * 0.4 + waterScore * 0.2);
    const foamColor = (speedScore * 0.5 + durationScore * 0.3 + waterScore * 0.2);
    const foamDuration = (foamThickness * 0.6 + foamColor * 0.4) / 100 * 10;
    const foamAdhesion = (foamThickness * 0.7 + speedScore * 0.3);
    
    set({
      foamThickness,
      foamColor,
      foamDuration,
      foamAdhesion,
    });
  },
  
  calculateUserScore: () => {
    const { foamColor, foamDuration, foamAdhesion } = get();
    const color = Math.round(foamColor);
    const duration = Math.round(Math.min(100, foamDuration / 10 * 100));
    const adhesion = Math.round(foamAdhesion);
    const total = Math.round((color + duration + adhesion) / 3);
    
    set({
      userScore: { color, duration, adhesion, total: Math.round(total) },
      phase: 'ai_playing',
    });
  },
  
  setAiScore: (score) => {
    const { currentRound, userScore, roundRecords } = get();
    const record: RoundRecord = {
      id: crypto.randomUUID(),
      round: currentRound,
      userScore: { ...userScore },
      aiScore: { ...score },
      updatedAt: Date.now(),
    };
    const updatedRecords = appendRoundRecord(roundRecords, record);
    saveRoundRecords(updatedRecords, getDefaultStorage());
    set({ aiScore: score, phase: 'scoring', roundRecords: updatedRecords });
  },
  
  setCurrentPattern: (pattern) => set({ currentPattern: pattern, phase: 'pattern_showing' }),
  
  saveToGallery: (item) => {
    const { gallery } = get();
    const newItem: GalleryItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const updatedGallery = upsertGalleryItem(gallery, newItem);
    saveGallery(updatedGallery, getDefaultStorage());
    set({ gallery: updatedGallery });
  },

  resolveConflict: (round, keepId) => {
    const { roundRecords } = get();
    const updatedRecords = resolveRoundConflict(roundRecords, round, keepId);
    saveRoundRecords(updatedRecords, getDefaultStorage());
    set({ roundRecords: updatedRecords });
  },
  
  setPhase: (phase) => set({ phase }),
  
  clearRound: () => {
    const { currentRound } = get();
    set({
      currentRound: currentRound + 1,
      phase: 'idle',
    });
  },
}));
