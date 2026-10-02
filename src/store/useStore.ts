import { create } from 'zustand';
import type { StoreState, DrawingPath, LightSource, ReferenceState } from '@/types';
import { COLORS, LIGHT_CONSTRAINTS, clamp } from '@/utils/curveInterpolation';

const MAX_HISTORY = 10;

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

export const useStore = create<StoreState>((set, get) => ({
  lightSource: initialLightSource,
  selectedColor: COLORS.OCHER,
  drawingLayers: [],
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
      const newLayers = [...state.drawingLayers, layer];
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(newLayers);
      
      if (newHistory.length > MAX_HISTORY + 1) {
        newHistory.shift();
      }
      
      return {
        drawingLayers: newLayers,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }),

  updateDrawingLayer: (id, updates) =>
    set((state) => ({
      drawingLayers: state.drawingLayers.map((layer) =>
        layer.id === id ? { ...layer, ...updates } : layer
      ),
    })),

  undoDrawing: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      
      const newIndex = state.historyIndex - 1;
      return {
        drawingLayers: state.history[newIndex] || [],
        historyIndex: newIndex,
      };
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
export const useDrawingLayers = () => useStore((state) => state.drawingLayers);
export const useReference = () => useStore((state) => state.reference);
export const useCanUndo = () => useStore((state) => state.historyIndex > 0);
