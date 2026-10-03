import { create } from "zustand";
import {
  DEFAULT_COMPOSITE,
  DEFAULT_GENERATION,
  type Layer,
} from "@/lib/art/types";

let layerCounter = 0;
let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `layer-${Date.now().toString(36)}-${idCounter}`;
}

function makeLayer(partial: Partial<Layer> = {}): Layer {
  layerCounter += 1;
  return {
    ...DEFAULT_GENERATION,
    ...DEFAULT_COMPOSITE,
    seed: Math.floor(Math.random() * 1_000_000),
    id: nextId(),
    name: `图层 ${layerCounter}`,
    ...partial,
  };
}

interface ArtState {
  layers: Layer[];
  selectedId: string | null;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  moveLayer: (id: string, direction: -1 | 1) => void;
  selectLayer: (id: string) => void;
  randomizeSeed: (id: string) => void;
}

export const useArtStore = create<ArtState>((set) => ({
  layers: [makeLayer({ seed: 20241001, name: "图层 1" })],
  selectedId: null,

  addLayer: () =>
    set((state) => {
      const layer = makeLayer();
      return { layers: [...state.layers, layer], selectedId: layer.id };
    }),

  removeLayer: (id) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index === -1) return state;
      const layers = state.layers.filter((l) => l.id !== id);
      let selectedId = state.selectedId;
      if (selectedId === id) {
        // 选中态落到相邻层：优先同位置（原下一层），否则前一层
        const neighbor = layers[Math.min(index, layers.length - 1)];
        selectedId = neighbor ? neighbor.id : null;
      }
      return { layers, selectedId };
    }),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  moveLayer: (id, direction) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= state.layers.length) return state;
      const layers = [...state.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { layers };
    }),

  selectLayer: (id) =>
    set((state) =>
      state.layers.some((l) => l.id === id) ? { selectedId: id } : state,
    ),

  randomizeSeed: (id) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, seed: Math.floor(Math.random() * 1_000_000) } : l,
      ),
    })),
}));

/** 初始化选中第一层 */
useArtStore.setState((state) => ({
  selectedId: state.selectedId ?? state.layers[0]?.id ?? null,
}));
