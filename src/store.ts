import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  CloisonneProcess,
  CopperWire,
  EnamelColor,
  Sandpaper,
  VesselState,
  SelectedMaterial,
  FiligreeWire,
  EnamelFill
} from './types';

function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max((num >> 16) - amt, 0);
  const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
  const B = Math.max((num & 0x0000FF) - amt, 0);
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

const initialCopperWires: CopperWire[] = [
  { id: uuidv4(), diameter: 0.3, color: '#b8860b', spoolPosition: [-3.5, 1.2, -1] },
  { id: uuidv4(), diameter: 0.5, color: '#b8860b', spoolPosition: [-3.5, 1.2, 0] },
  { id: uuidv4(), diameter: 0.8, color: '#b8860b', spoolPosition: [-3.5, 1.2, 1] },
];

const initialEnamelColors: EnamelColor[] = [
  { id: uuidv4(), name: '天青', color: '#4da6ff', wetColor: darkenColor('#4da6ff', 15), position: [3.5, 1.8, -1.5] },
  { id: uuidv4(), name: '松绿', color: '#2e8b57', wetColor: darkenColor('#2e8b57', 15), position: [3.5, 1.8, -1] },
  { id: uuidv4(), name: '胭脂', color: '#dc143c', wetColor: darkenColor('#dc143c', 15), position: [3.5, 1.8, -0.5] },
  { id: uuidv4(), name: '鹅黄', color: '#ffd700', wetColor: darkenColor('#ffd700', 15), position: [3.5, 1.8, 0] },
  { id: uuidv4(), name: '月白', color: '#f0f8ff', wetColor: darkenColor('#f0f8ff', 15), position: [3.5, 1.8, 0.5] },
  { id: uuidv4(), name: '绛紫', color: '#8b008b', wetColor: darkenColor('#8b008b', 15), position: [3.5, 1.8, 1] },
  { id: uuidv4(), name: '石青', color: '#1e90ff', wetColor: darkenColor('#1e90ff', 15), position: [3.5, 1.4, -1.5] },
  { id: uuidv4(), name: '翡翠', color: '#50c878', wetColor: darkenColor('#50c878', 15), position: [3.5, 1.4, -1] },
  { id: uuidv4(), name: '朱砂', color: '#e34234', wetColor: darkenColor('#e34234', 15), position: [3.5, 1.4, -0.5] },
  { id: uuidv4(), name: '牙白', color: '#fffdd0', wetColor: darkenColor('#fffdd0', 15), position: [3.5, 1.4, 0] },
  { id: uuidv4(), name: '藏蓝', color: '#191970', wetColor: darkenColor('#191970', 15), position: [3.5, 1.4, 0.5] },
  { id: uuidv4(), name: '琥珀', color: '#ffbf00', wetColor: darkenColor('#ffbf00', 15), position: [3.5, 1.4, 1] },
];

const initialSandpapers: Sandpaper[] = [
  { id: uuidv4(), grit: 'coarse', color: '#a0a0a0', position: [3.5, 0.8, -0.5] },
  { id: uuidv4(), grit: 'medium', color: '#c0c0c0', position: [3.5, 0.8, 0] },
  { id: uuidv4(), grit: 'fine', color: '#e0e0e0', position: [3.5, 0.8, 0.5] },
];

const initialVesselState: VesselState = {
  baseColor: '#b87333',
  filigreeWires: [],
  enamelFills: [],
  polishProgress: 0,
  isFired: false,
  gildingProgress: 0,
  mirrorReflection: 0,
};

const initialSelectedMaterial: SelectedMaterial = {
  wireId: null,
  enamelId: null,
  sandpaperId: null,
  goldPaste: false,
};

interface AppState {
  currentProcess: CloisonneProcess;
  copperWires: CopperWire[];
  enamelColors: EnamelColor[];
  sandpapers: Sandpaper[];
  vesselState: VesselState;
  selectedMaterial: SelectedMaterial;
  isFurnaceActive: boolean;
  furnaceProgress: number;
  isDrawingWire: boolean;
  currentDrawingPoints: [number, number, number][];

  setCurrentProcess: (process: CloisonneProcess) => void;
  selectWire: (id: string | null) => void;
  selectEnamel: (id: string | null) => void;
  selectSandpaper: (id: string | null) => void;
  selectGoldPaste: (selected: boolean) => void;
  startDrawingWire: () => void;
  addDrawingPoint: (point: [number, number, number]) => void;
  confirmCurrentWire: () => void;
  cancelCurrentWire: () => void;
  addEnamelFill: (regionId: string, colorId: string) => void;
  updateEnamelFillProgress: (regionId: string, progress: number) => void;
  setEnamelDry: (regionId: string) => void;
  startFiring: () => void;
  updateFurnaceProgress: (progress: number) => void;
  finishFiring: () => void;
  addPolishProgress: (amount: number) => void;
  addGildingProgress: (amount: number) => void;
  highlightWire: (wireId: string) => void;
  unhighlightAllWires: () => void;
  resetAll: () => void;
  generateEnamelRegions: () => string[];
  getEnamelColorById: (id: string) => EnamelColor | undefined;
  getWireById: (id: string) => CopperWire | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentProcess: CloisonneProcess.FILIGREE,
  copperWires: initialCopperWires,
  enamelColors: initialEnamelColors,
  sandpapers: initialSandpapers,
  vesselState: initialVesselState,
  selectedMaterial: initialSelectedMaterial,
  isFurnaceActive: false,
  furnaceProgress: 0,
  isDrawingWire: false,
  currentDrawingPoints: [],

  setCurrentProcess: (process) => set({ currentProcess: process }),

  selectWire: (id) => set((state) => ({
    selectedMaterial: { ...state.selectedMaterial, wireId: id }
  })),

  selectEnamel: (id) => set((state) => ({
    selectedMaterial: { ...state.selectedMaterial, enamelId: id }
  })),

  selectSandpaper: (id) => set((state) => ({
    selectedMaterial: { ...state.selectedMaterial, sandpaperId: id }
  })),

  selectGoldPaste: (selected) => set((state) => ({
    selectedMaterial: { ...state.selectedMaterial, goldPaste: selected }
  })),

  startDrawingWire: () => set({
    isDrawingWire: true,
    currentDrawingPoints: []
  }),

  addDrawingPoint: (point) => set((state) => ({
    currentDrawingPoints: [...state.currentDrawingPoints, point]
  })),

  confirmCurrentWire: () => set((state) => {
    if (state.currentDrawingPoints.length < 2 || !state.selectedMaterial.wireId) {
      return {};
    }
    const newWire: FiligreeWire = {
      id: uuidv4(),
      wireId: state.selectedMaterial.wireId,
      points: state.currentDrawingPoints,
      confirmed: true,
      highlighted: true,
    };
    return {
      vesselState: {
        ...state.vesselState,
        filigreeWires: [...state.vesselState.filigreeWires, newWire],
      },
      isDrawingWire: false,
      currentDrawingPoints: [],
    };
  }),

  cancelCurrentWire: () => set({
    isDrawingWire: false,
    currentDrawingPoints: [],
  }),

  addEnamelFill: (regionId, colorId) => set((state) => {
    const existingFill = state.vesselState.enamelFills.find(f => f.regionId === regionId);
    if (existingFill) {
      return {
        vesselState: {
          ...state.vesselState,
          enamelFills: state.vesselState.enamelFills.map(f =>
            f.regionId === regionId ? { ...f, colorId, fillProgress: 0, isWet: true } : f
          ),
        },
      };
    }
    const newFill: EnamelFill = {
      regionId,
      colorId,
      fillProgress: 0,
      isWet: true,
    };
    return {
      vesselState: {
        ...state.vesselState,
        enamelFills: [...state.vesselState.enamelFills, newFill],
      },
    };
  }),

  updateEnamelFillProgress: (regionId, progress) => set((state) => ({
    vesselState: {
      ...state.vesselState,
      enamelFills: state.vesselState.enamelFills.map(f =>
        f.regionId === regionId ? { ...f, fillProgress: Math.min(progress, 1) } : f
      ),
    },
  })),

  setEnamelDry: (regionId) => set((state) => ({
    vesselState: {
      ...state.vesselState,
      enamelFills: state.vesselState.enamelFills.map(f =>
        f.regionId === regionId ? { ...f, isWet: false } : f
      ),
    },
  })),

  startFiring: () => set({
    isFurnaceActive: true,
    furnaceProgress: 0,
    currentProcess: CloisonneProcess.FIRING,
  }),

  updateFurnaceProgress: (progress) => set({ furnaceProgress: progress }),

  finishFiring: () => set((state) => ({
    isFurnaceActive: false,
    furnaceProgress: 0,
    vesselState: {
      ...state.vesselState,
      isFired: true,
      enamelFills: state.vesselState.enamelFills.map(f => ({ ...f, isWet: false })),
    },
    currentProcess: CloisonneProcess.POLISHING,
  })),

  addPolishProgress: (amount) => set((state) => {
    const newProgress = Math.min(state.vesselState.polishProgress + amount, 100);
    const newReflection = newProgress / 100;
    return {
      vesselState: {
        ...state.vesselState,
        polishProgress: newProgress,
        mirrorReflection: newReflection,
      },
    };
  }),

  addGildingProgress: (amount) => set((state) => ({
    vesselState: {
      ...state.vesselState,
      gildingProgress: Math.min(state.vesselState.gildingProgress + amount, 100),
    },
  })),

  highlightWire: (wireId) => set((state) => ({
    vesselState: {
      ...state.vesselState,
      filigreeWires: state.vesselState.filigreeWires.map(w =>
        w.id === wireId ? { ...w, highlighted: true } : w
      ),
    },
  })),

  unhighlightAllWires: () => set((state) => ({
    vesselState: {
      ...state.vesselState,
      filigreeWires: state.vesselState.filigreeWires.map(w => ({ ...w, highlighted: false })),
    },
  })),

  resetAll: () => set({
    currentProcess: CloisonneProcess.FILIGREE,
    vesselState: initialVesselState,
    selectedMaterial: initialSelectedMaterial,
    isFurnaceActive: false,
    furnaceProgress: 0,
    isDrawingWire: false,
    currentDrawingPoints: [],
  }),

  generateEnamelRegions: () => {
    const wires = get().vesselState.filigreeWires;
    const regions: string[] = [];
    for (let i = 0; i < Math.max(wires.length, 4); i++) {
      regions.push(`region-${i}`);
    }
    if (regions.length < 4) {
      for (let i = regions.length; i < 4; i++) {
        regions.push(`region-${i}`);
      }
    }
    return regions;
  },

  getEnamelColorById: (id) => get().enamelColors.find(c => c.id === id),
  getWireById: (id) => get().copperWires.find(w => w.id === id),
}));
