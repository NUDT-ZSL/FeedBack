import { create } from 'zustand';
import type { Position, WorkshopState } from '../types/index.ts';
import {
  addSeal,
  canRedo,
  canUndo,
  createWorkshop,
  deserializeWorkshop,
  getActiveSeal,
  redo,
  removeSeal,
  selectSeal,
  serializeWorkshop,
  setStrokeOffset,
  undo,
  updateSeal,
  WORKSHOP_STORAGE_KEY,
} from '../utils/workshopCore.ts';
import type { SealPatch } from '../utils/workshopCore.ts';

export interface WorkshopStore extends WorkshopState {
  addSeal: () => void;
  removeSeal: (id: string) => void;
  selectSeal: (id: string) => void;
  updateActiveSeal: (patch: SealPatch) => void;
  setStrokeOffset: (charIndex: number, offset: Position) => void;
  undo: () => void;
  redo: () => void;
}

function loadInitialState(): WorkshopState {
  if (typeof localStorage === 'undefined') return createWorkshop();
  try {
    return deserializeWorkshop(localStorage.getItem(WORKSHOP_STORAGE_KEY));
  } catch {
    return createWorkshop();
  }
}

export const useWorkshopStore = create<WorkshopStore>((set, get) => ({
  ...loadInitialState(),
  addSeal: () => set((s) => addSeal(s)),
  removeSeal: (id) => set((s) => removeSeal(s, id)),
  selectSeal: (id) => set((s) => selectSeal(s, id)),
  updateActiveSeal: (patch) => {
    const { activeId } = get();
    if (!activeId) return;
    set((s) => updateSeal(s, activeId, patch));
  },
  setStrokeOffset: (charIndex, offset) => {
    const { activeId } = get();
    if (!activeId) return;
    set((s) => setStrokeOffset(s, activeId, charIndex, offset));
  },
  undo: () => set((s) => undo(s)),
  redo: () => set((s) => redo(s)),
}));

// 任何状态变化都整体持久化：印章数量、顺序、各自参数、笔画偏移与历史
useWorkshopStore.subscribe((state) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WORKSHOP_STORAGE_KEY, serializeWorkshop(state));
  } catch {
    // 存储不可用时静默降级，不影响使用
  }
});

export const workshopSelectors = {
  activeSeal: (s: WorkshopStore) => getActiveSeal(s),
  canUndo: (s: WorkshopStore) => canUndo(s),
  canRedo: (s: WorkshopStore) => canRedo(s),
};
