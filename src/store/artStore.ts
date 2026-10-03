import { create } from 'zustand';
import { generateShapes } from '@/art/generate';
import { randomSeed } from '@/art/prng';
import type { ArtLayer, BlendMode, Shape, ShapeKind } from '@/art/types';

let layerCounter = 0;
function nextLayerId(): string {
  layerCounter += 1;
  return `layer-${Date.now().toString(36)}-${layerCounter}`;
}

function defaultLayer(index: number): ArtLayer {
  return {
    id: nextLayerId(),
    name: `图层 ${index}`,
    shape: 'mixed',
    count: 24,
    minSize: 0.02,
    maxSize: 0.12,
    rotation: 180,
    seed: randomSeed(),
    opacity: 0.9,
    blendMode: 'source-over',
    visible: true,
  };
}

// 形状缓存：key 只包含生成参数，合成参数变化时直接命中缓存，
// 从机制上保证合成操作不可能改变形状序列。
const shapeCache = new Map<string, Shape[]>();
const MAX_CACHE_ENTRIES = 64;

function genKey(layer: ArtLayer): string {
  return [
    layer.id,
    layer.shape,
    layer.count,
    layer.minSize,
    layer.maxSize,
    layer.rotation,
    layer.seed,
  ].join('|');
}

export function getLayerShapes(layer: ArtLayer): Shape[] {
  const key = genKey(layer);
  const cached = shapeCache.get(key);
  if (cached) return cached;
  const shapes = generateShapes(layer);
  if (shapeCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = shapeCache.keys().next().value;
    if (oldest !== undefined) shapeCache.delete(oldest);
  }
  shapeCache.set(key, shapes);
  return shapes;
}

export interface ArtState {
  layers: ArtLayer[];
  selectedId: string | null;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  toggleVisible: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<ArtLayer, 'id'>>) => void;
  rerollSeed: (id: string) => void;
}

export const useArtStore = create<ArtState>((set) => ({
  layers: [],
  selectedId: null,

  addLayer: () =>
    set((state) => {
      const layer = defaultLayer(state.layers.length + 1);
      return { layers: [...state.layers, layer], selectedId: layer.id };
    }),

  removeLayer: (id) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index === -1) return state;
      const layers = state.layers.filter((l) => l.id !== id);
      let selectedId = state.selectedId;
      if (selectedId === id) {
        // 选中态落到相邻层：优先后一个，否则前一个，都没有则为空
        const neighbor = layers[index] ?? layers[index - 1] ?? null;
        selectedId = neighbor ? neighbor.id : null;
      }
      return { layers, selectedId };
    }),

  selectLayer: (id) =>
    set((state) => (state.layers.some((l) => l.id === id) ? { selectedId: id } : state)),

  moveLayer: (id, dir) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      const target = index + dir;
      if (index === -1 || target < 0 || target >= state.layers.length) return state;
      const layers = [...state.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { layers };
    }),

  toggleVisible: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  rerollSeed: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, seed: randomSeed() } : l)),
    })),
}));

export type { ArtLayer, BlendMode, Shape, ShapeKind };
