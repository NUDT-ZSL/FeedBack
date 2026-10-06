import { create } from 'zustand';
import type { StoreState, DrawingPath, LightSource, ReferenceState } from '@/types';
import { COLORS, LIGHT_CONSTRAINTS } from '@/types';
import { clamp } from '@/utils/curveInterpolation';

const MAX_HISTORY = 10;
const EMPTY_LAYERS: DrawingPath[] = [];

const initialLightSource: LightSource = {
  x: 0,
  y: 0,
  z: 1.5,
  radius: 1,
};

const initialReference: ReferenceState = {
  isDragging: false,
  position: { x: 0, y: 0 },
  opacity: 0.7,
  isSnapped: false,
  isPlaced: false,
};

export const useStore = create<StoreState>((set) => ({
  lightSource: initialLightSource,
  selectedColor: COLORS.OCHER,
  history: [[]],
  historyIndex: 0,
  reference: initialReference,

  setLightSource: (source) =>
    set((state) => {
      const newSource = { ...state.lightSource, ...source };
      
      if (source.z !== undefined) {
        newSource.z = clamp(source.z, LIGHT_CONSTRAINTS.minZ, LIGHT_CONSTRAINTS.maxZ);
      }
      if (source.radius !== undefined) {
        newSource.radius = clamp(source.radius, LIGHT_CONSTRAINTS.minRadiusThree, LIGHT_CONSTRAINTS.maxRadiusThree);
      }
      
      return { lightSource: newSource };
    }),

  setSelectedColor: (color) =>
    set({ selectedColor: color }),

  addDrawingLayer: (layer) =>
    set((state) => {
      const currentLayers = state.history[state.historyIndex] ?? EMPTY_LAYERS;
      const nextLayers = [...currentLayers, layer];
      let nextHistory = state.history.slice(0, state.historyIndex + 1);
      nextHistory.push(nextLayers);

      if (nextHistory.length > MAX_HISTORY + 1) {
        nextHistory = nextHistory.slice(nextHistory.length - (MAX_HISTORY + 1));
      }

      return {
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
      };
    }),

  undoDrawing: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      return { historyIndex: state.historyIndex - 1 };
    }),

  redoDrawing: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      return { historyIndex: state.historyIndex + 1 };
    }),

  setReferencePosition: (pos) =>
    set((state) => ({
      reference: { ...state.reference, position: pos },
    })),

  setReferenceOpacity: (opacity) =>
    set((state) => ({
      reference: { ...state.reference, opacity: clamp(opacity, 0, 1) },
    })),

  setReferenceSnapped: (snapped) =>
    set((state) => ({
      reference: { ...state.reference, isSnapped: snapped },
    })),

  setReferenceDragging: (dragging) =>
    set((state) => ({
      reference: { ...state.reference, isDragging: dragging },
    })),

  setReferencePlaced: (placed) =>
    set((state) => ({
      reference: { ...state.reference, isPlaced: placed },
    })),
}));

export const useLightSource = () => useStore((state) => state.lightSource);
export const useSelectedColor = () => useStore((state) => state.selectedColor);
export const useDrawingLayers = () =>
  useStore((state) => state.history[state.historyIndex] ?? EMPTY_LAYERS);
export const useReference = () => useStore((state) => state.reference);
export const useCanUndo = () => useStore((state) => state.historyIndex > 0);
export const useCanRedo = () =>
  useStore((state) => state.historyIndex < state.history.length - 1);
