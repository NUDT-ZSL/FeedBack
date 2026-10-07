import { create } from 'zustand';
import type { Spice, Perfume, MortarItem, PerfumeIngredient } from '../types';

interface PerfumeStore {
  spices: Spice[];
  perfumes: Perfume[];
  mortarItems: MortarItem[];
  currentView: 'shop' | 'list';
  isBoxOpen: boolean;
  burningPerfume: Perfume | null;
  newlyCreated: Perfume | null;

  setSpices: (spices: Spice[]) => void;
  setPerfumes: (perfumes: Perfume[]) => void;
  addToMortar: (spice: Spice) => void;
  removeFromMortar: (spiceId: string) => void;
  updatePercentage: (spiceId: string, percentage: number) => void;
  clearMortar: () => void;
  setCurrentView: (view: 'shop' | 'list') => void;
  setIsBoxOpen: (open: boolean) => void;
  setBurningPerfume: (perfume: Perfume | null) => void;
  setNewlyCreated: (perfume: Perfume | null) => void;
  addPerfume: (perfume: Perfume) => void;
  removePerfume: (id: string) => void;
  normalizeMortarPercentages: () => PerfumeIngredient[];
}

export const usePerfumeStore = create<PerfumeStore>((set, get) => ({
  spices: [],
  perfumes: [],
  mortarItems: [],
  currentView: 'shop',
  isBoxOpen: false,
  burningPerfume: null,
  newlyCreated: null,

  setSpices: (spices) => set({ spices }),
  setPerfumes: (perfumes) => set({ perfumes }),

  addToMortar: (spice) => {
    const { mortarItems } = get();
    if (mortarItems.length >= 5) return;
    if (mortarItems.some((item) => item.spice.id === spice.id)) return;

    const count = mortarItems.length + 1;
    const basePercentage = Math.floor(100 / count);
    const remainder = 100 - basePercentage * count;

    const updatedItems = mortarItems.map((item, idx) => ({
      ...item,
      percentage: basePercentage + (idx === 0 ? remainder : 0),
    }));

    updatedItems.push({
      spice,
      percentage: basePercentage,
    });

    set({ mortarItems: updatedItems });
  },

  removeFromMortar: (spiceId) => {
    const { mortarItems } = get();
    const remaining = mortarItems.filter((item) => item.spice.id !== spiceId);

    if (remaining.length > 0) {
      const count = remaining.length;
      const basePercentage = Math.floor(100 / count);
      const remainder = 100 - basePercentage * count;

      remaining.forEach((item, idx) => {
        item.percentage = basePercentage + (idx === 0 ? remainder : 0);
      });
    }

    set({ mortarItems: remaining });
  },

  updatePercentage: (spiceId, percentage) => {
    const { mortarItems } = get();
    const index = mortarItems.findIndex((item) => item.spice.id === spiceId);
    if (index === -1) return;

    const newItems = [...mortarItems];
    newItems[index] = { ...newItems[index], percentage };

    const totalOthers = newItems
      .filter((_, i) => i !== index)
      .reduce((sum, item) => sum + item.percentage, 0);

    if (totalOthers > 0) {
      const targetTotal = 100 - percentage;
      const scale = targetTotal / totalOthers;

      newItems.forEach((item, i) => {
        if (i !== index) {
          item.percentage = Math.round(item.percentage * scale);
        }
      });
    }

    const finalTotal = newItems.reduce((sum, item) => sum + item.percentage, 0);
    if (finalTotal !== 100 && newItems.length > 0) {
      const lastIndex = newItems.length - 1;
      if (lastIndex !== index) {
        newItems[lastIndex].percentage += 100 - finalTotal;
      } else {
        newItems[0].percentage += 100 - finalTotal;
      }
    }

    set({ mortarItems: newItems });
  },

  clearMortar: () => set({ mortarItems: [] }),

  setCurrentView: (view) => set({ currentView: view }),
  setIsBoxOpen: (open) => set({ isBoxOpen: open }),
  setBurningPerfume: (perfume) => set({ burningPerfume: perfume }),
  setNewlyCreated: (perfume) => set({ newlyCreated: perfume }),

  addPerfume: (perfume) =>
    set((state) => ({ perfumes: [perfume, ...state.perfumes] })),

  removePerfume: (id) =>
    set((state) => ({
      perfumes: state.perfumes.filter((p) => p.id !== id),
    })),

  normalizeMortarPercentages: () => {
    const { mortarItems } = get();
    return mortarItems.map((item) => ({
      spiceId: item.spice.id,
      percentage: item.percentage,
    }));
  },
}));
