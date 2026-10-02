import { create } from 'zustand';
import {
  GrindingState,
  GritType,
  LightPosition,
  GRIT_COEFFICIENTS,
  SCRATCH_THRESHOLD,
  MAX_REFLECTIVITY,
  MIN_REFLECTIVITY,
  Scratch,
} from '@/types';

let scratchIdCounter = 0;

export const useGrindingStore = create<GrindingState>((set, get) => ({
  grindingProgress: 0,
  uniformity: 0,
  reflectivity: MIN_REFLECTIVITY,
  patternClarity: 0,
  scratchCount: 0,
  scratches: [],
  currentGrit: null,
  isPolishing: false,
  lightAngle: 0,
  lightPosition: 'front',
  isDamaged: false,
  polishProgress: 0,

  startGrinding: (grit: GritType) => {
    set({ currentGrit: grit, isPolishing: false });
  },

  updateGrinding: (force: number, direction: number) => {
    const state = get();
    if (!state.currentGrit) return;

    const coefficient = GRIT_COEFFICIENTS[state.currentGrit];
    const efficiency = force * coefficient * 0.1;

    const newProgress = Math.min(100, state.grindingProgress + efficiency);
    const newUniformity = Math.min(100, state.uniformity + efficiency * 0.5);
    const newPatternClarity = Math.min(100, state.patternClarity + efficiency * 0.8);
    const newReflectivity = Math.min(
      MAX_REFLECTIVITY,
      MIN_REFLECTIVITY + newProgress * 0.5 + state.polishProgress * 0.25
    );

    const directionVariance = Math.abs(direction - state.uniformity * 3.6) / 360;
    const uniformityPenalty = directionVariance * 0.3;
    const finalUniformity = Math.max(0, newUniformity - uniformityPenalty);

    set({
      grindingProgress: newProgress,
      uniformity: finalUniformity,
      patternClarity: newPatternClarity,
      reflectivity: newReflectivity,
    });
  },

  stopGrinding: () => {
    set({ currentGrit: null });
  },

  startPolishing: () => {
    set({ isPolishing: true, currentGrit: null });
  },

  updatePolishing: (force: number) => {
    const state = get();
    if (!state.isPolishing) return;

    const efficiency = force * 0.08;
    const newPolishProgress = Math.min(100, state.polishProgress + efficiency);
    const newReflectivity = Math.min(
      MAX_REFLECTIVITY,
      MIN_REFLECTIVITY + state.grindingProgress * 0.5 + newPolishProgress * 0.25
    );
    const newPatternClarity = Math.min(100, state.patternClarity + efficiency * 0.3);

    if (state.scratchCount > 0 && state.currentGrit === 1200) {
      const fixChance = 0.1 * efficiency;
      if (Math.random() < fixChance) {
        get().fixScratch();
      }
    }

    set({
      polishProgress: newPolishProgress,
      reflectivity: newReflectivity,
      patternClarity: newPatternClarity,
    });
  },

  stopPolishing: () => {
    set({ isPolishing: false });
  },

  setLightPosition: (position: LightPosition) => {
    const angles: Record<LightPosition, number> = {
      front: 0,
      left45: 45,
      right90: 90,
    };
    set({ lightPosition: position, lightAngle: angles[position] });
  },

  addScratch: (scratch: Omit<Scratch, 'id'>) => {
    const newScratch: Scratch = { ...scratch, id: scratchIdCounter++ };
    const newScratches = [...get().scratches, newScratch];
    const newCount = newScratches.length;
    const isDamaged = newCount >= SCRATCH_THRESHOLD;
    set({ scratches: newScratches, scratchCount: newCount, isDamaged });
  },

  fixScratch: () => {
    const state = get();
    if (state.scratches.length === 0) return;

    const newScratches = [...state.scratches];
    const toFix = newScratches.findIndex((s) => s.opacity > 0.3);
    if (toFix >= 0) {
      newScratches[toFix] = {
        ...newScratches[toFix],
        opacity: Math.max(0, newScratches[toFix].opacity - 0.2),
      };
    } else {
      newScratches.shift();
    }

    const filtered = newScratches.filter((s) => s.opacity > 0.1);
    set({
      scratches: filtered,
      scratchCount: filtered.length,
      isDamaged: filtered.length >= SCRATCH_THRESHOLD,
    });
  },

  reset: () => {
    set({
      grindingProgress: 0,
      uniformity: 0,
      reflectivity: MIN_REFLECTIVITY,
      patternClarity: 0,
      scratchCount: 0,
      scratches: [],
      currentGrit: null,
      isPolishing: false,
      lightAngle: 0,
      lightPosition: 'front',
      isDamaged: false,
      polishProgress: 0,
    });
    scratchIdCounter = 0;
  },
}));
