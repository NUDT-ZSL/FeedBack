import { create } from 'zustand';
import type { StoreType } from './types';
import { generateStations, generateHorses } from './utils';
import {
  createSimContext,
  dispatchDocument as simDispatchDocument,
  restSoldier as simRestSoldier,
  updateSoldierRest as simUpdateSoldierRest,
  updateMovingHorses as simUpdateMovingHorses,
  checkTimeouts as simCheckTimeouts,
  type SimState,
} from './simulation';

const simContext = createSimContext();

const useStore = create<StoreType>((set, get) => {
  const applySim = (next: SimState) => {
    if (next !== get()) set(next);
  };

  return {
    stations: generateStations(),
    horses: generateHorses(),
    soldier: {
      id: 'soldier-1',
      stamina: 100,
      isResting: false,
    },
    movingHorses: [],
    particles: [],
    logs: [],
    selectedStation: null,
    selectedHorse: null,
    selectedDocument: null,
    alertMessage: null,
    documentCounter: 100,

    selectStation: (id: string | null) => {
      set({ selectedStation: id, selectedDocument: null });
    },

    selectHorse: (id: string | null) => {
      set({ selectedHorse: id });
    },

    selectDocument: (id: string | null) => {
      set({ selectedDocument: id });
    },

    dispatchDocument: () => {
      const state = get();
      const next = simDispatchDocument(
        state,
        simContext,
        state.selectedStation,
        state.selectedHorse,
        state.selectedDocument
      );
      if (next === state) return;
      set({ ...next, selectedHorse: null, selectedDocument: null });
    },

    restSoldier: () => {
      applySim(simRestSoldier(get(), simContext));
    },

    updateSoldierRest: (currentTime: number) => {
      applySim(simUpdateSoldierRest(get(), currentTime, simContext.config));
    },

    updateMovingHorses: (currentTime: number) => {
      applySim(simUpdateMovingHorses(get(), currentTime));
    },

    addParticle: (x: number, y: number, currentTime: number) => {
      const state = get();
      if (state.particles.length >= 10) {
        set({
          particles: [
            ...state.particles.slice(1),
            { id: `p-${Date.now()}-${Math.random()}`, x, y, createdAt: currentTime, duration: 800 },
          ],
        });
      } else {
        set({
          particles: [...state.particles, { id: `p-${Date.now()}-${Math.random()}`, x, y, createdAt: currentTime, duration: 800 }],
        });
      }
    },

    cleanupParticles: (currentTime: number) => {
      set(state => ({
        particles: state.particles.filter(p => currentTime - p.createdAt < p.duration),
      }));
    },

    checkTimeouts: (currentTime: number) => {
      applySim(simCheckTimeouts(get(), currentTime));
    },

    dismissAlert: () => {
      set({ alertMessage: null });
    },
  };
});

export default useStore;
