import { create } from 'zustand';
import type { WorkshopState, WorkshopActions, MaterialType, PaperState } from './types';
import { calculateConcentration, calculateUniformity, calculateQualityScore, generateId, clamp } from './utils';

const HISTORY_KEY = 'paper-workshop-history';
const MAX_HISTORY = 10;

const initialPulpState = {
  concentration: 50,
  materials: {
    chuPi: 20,
    sangPi: 20,
    maXianWei: 10,
  },
};

const initialState: Omit<WorkshopState, keyof WorkshopActions> = {
  pulp: initialPulpState,
  currentPaper: null,
  history: [],
  isAnimating: false,
  currentStep: 0,
  isResetting: false,
  showScoreAnimation: false,
  finalScore: 0,
  ripples: [],
  showWaterStain: false,
  isScooping: false,
  scoopProgress: 0,
};

export const useWorkshopStore = create<WorkshopState & WorkshopActions>((set, get) => ({
  ...initialState,

  loadHistory: () => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const history = JSON.parse(saved);
        set({ history });
      }
    } catch {
      console.warn('Failed to load history');
    }
  },

  addMaterial: (type: MaterialType, amount: number) => {
    const { pulp, isAnimating, currentStep } = get();
    if (isAnimating || currentStep > 0) return;

    const newMaterials = { ...pulp.materials };
    newMaterials[type] = clamp(newMaterials[type] + amount, 0, 50);
    const newConcentration = calculateConcentration(newMaterials);

    set({
      pulp: {
        concentration: newConcentration,
        materials: newMaterials,
      },
    });
  },

  startScooping: () => {
    const { isAnimating, currentStep, pulp } = get();
    if (isAnimating || currentStep !== 0) return;

    const uniformity = calculateUniformity(pulp.concentration);
    const newPaper: PaperState = {
      id: generateId(),
      stage: 'scooping',
      uniformity,
      dryness: 0,
      pressLevel: 0,
      inspectionPoints: 0,
    };

    set({
      isAnimating: true,
      isScooping: true,
      scoopProgress: 0,
      currentPaper: newPaper,
    });
  },

  updateScoopProgress: (progress: number) => {
    set({ scoopProgress: progress });
  },

  finishScooping: () => {
    const { currentPaper } = get();
    if (!currentPaper) return;

    set({
      isAnimating: false,
      isScooping: false,
      scoopProgress: 0,
      currentStep: 1,
      currentPaper: {
        ...currentPaper,
        stage: 'wet',
      },
    });
  },

  startPressing: () => {
    const { isAnimating, currentStep, currentPaper } = get();
    if (isAnimating || currentStep !== 1 || !currentPaper) return;

    set({
      isAnimating: true,
      showWaterStain: true,
      currentPaper: {
        ...currentPaper,
        stage: 'pressing',
      },
    });
  },

  finishPressing: () => {
    const { currentPaper } = get();
    if (!currentPaper) return;

    const pressLevel = 70 + Math.random() * 25;

    setTimeout(() => {
      get().hideWaterStain();
    }, 2000);

    set({
      isAnimating: false,
      currentStep: 2,
      currentPaper: {
        ...currentPaper,
        stage: 'pressed',
        pressLevel,
        dryness: 30,
      },
    });
  },

  hideWaterStain: () => {
    set({ showWaterStain: false });
  },

  startDragging: () => {
    const { isAnimating, currentStep, currentPaper } = get();
    if (isAnimating || currentStep !== 2 || !currentPaper) return;

    set({
      currentPaper: {
        ...currentPaper,
        stage: 'dragging',
      },
    });
  },

  placeOnDryingWall: () => {
    const { currentPaper } = get();
    if (!currentPaper || currentPaper.stage !== 'dragging') return;

    set({
      isAnimating: true,
      currentPaper: {
        ...currentPaper,
        stage: 'drying',
      },
    });
  },

  updateDryness: (dryness: number) => {
    const { currentPaper } = get();
    if (!currentPaper) return;

    set({
      currentPaper: {
        ...currentPaper,
        dryness,
      },
    });
  },

  finishDrying: () => {
    const { currentPaper } = get();
    if (!currentPaper) return;

    set({
      isAnimating: false,
      currentStep: 3,
      currentPaper: {
        ...currentPaper,
        stage: 'dried',
        dryness: 100,
      },
    });
  },

  addInspectionPoint: (x: number, y: number) => {
    const { isAnimating, currentStep, currentPaper, ripples } = get();
    if (isAnimating || currentStep !== 3 || !currentPaper) return;
    if (currentPaper.inspectionPoints >= 10) return;

    const newRipple = { id: Date.now(), x, y };

    set({
      ripples: [...ripples, newRipple],
      currentPaper: {
        ...currentPaper,
        stage: 'inspecting',
        inspectionPoints: currentPaper.inspectionPoints + 1,
      },
    });

    setTimeout(() => {
      get().removeRipple(newRipple.id);
    }, 800);

    if (currentPaper.inspectionPoints + 1 >= 10) {
      setTimeout(() => {
        get().calculateQuality();
      }, 500);
    }
  },

  removeRipple: (id: number) => {
    set((state) => ({
      ripples: state.ripples.filter((r) => r.id !== id),
    }));
  },

  calculateQuality: () => {
    const { currentPaper, pulp, history } = get();
    if (!currentPaper) return;

    const result = calculateQualityScore(
      pulp.concentration,
      currentPaper.uniformity,
      currentPaper.dryness,
      currentPaper.pressLevel,
      currentPaper.inspectionPoints
    );

    const newRecord = {
      id: currentPaper.id,
      timestamp: Date.now(),
      materials: { ...pulp.materials },
      concentration: pulp.concentration,
      uniformity: currentPaper.uniformity,
      dryness: currentPaper.dryness,
      pressLevel: currentPaper.pressLevel,
      score: result.score,
      grade: result.grade,
    };

    const newHistory = [newRecord, ...history].slice(0, MAX_HISTORY);

    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch {
      console.warn('Failed to save history');
    }

    set({
      finalScore: result.score,
      showScoreAnimation: true,
      history: newHistory,
      currentStep: 4,
      currentPaper: {
        ...currentPaper,
        stage: 'done',
      },
    });
  },

  hideScoreAnimation: () => {
    set({ showScoreAnimation: false });
  },

  resetAll: () => {
    const { isAnimating } = get();
    if (isAnimating) return;

    set({
      isResetting: true,
    });

    setTimeout(() => {
      get().finishResetting();
    }, 1000);
  },

  finishResetting: () => {
    const { history } = get();

    set({
      ...initialState,
      history,
      pulp: { ...initialPulpState },
    });
  },
}));
