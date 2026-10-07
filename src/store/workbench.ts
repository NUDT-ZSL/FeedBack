import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import type {
  CarvingStyle,
  Position,
  SealDocument,
  SealFont,
  SealSize,
  SealState,
  StampRecord,
} from '../types/index.ts';
import {
  applyStrokeDrag,
  canRedo,
  canUndo,
  commitStrokeDrag,
  createSealDocument,
  createStampRecord,
  pushHistory,
  redoSeal,
  setCharactersOnState,
  setFontOnState,
  setSizeOnState,
  setStyleOnState,
  undoSeal,
} from '../core/seal.ts';

export const STORAGE_KEY = 'seal-workbench-v1';

export interface WorkbenchData {
  seals: SealDocument[];
  selectedId: string | null;
  stamps: Record<string, StampRecord[]>;
  sealCounter: number;
}

export interface WorkbenchActions {
  addSeal(): string;
  deleteSeal(id: string): void;
  selectSeal(id: string): void;
  renameSeal(id: string, name: string): void;
  setCharacters(text: string): void;
  setFont(font: SealFont): void;
  setStyle(style: CarvingStyle): void;
  setSize(size: SealSize): void;
  dragStroke(strokeId: string, offset: Position): void;
  releaseStroke(strokeId: string): void;
  undo(): string | null;
  redo(): string | null;
  stampCurrent(): StampRecord | null;
  clearAll(): void;
}

export type WorkbenchStore = WorkbenchData & WorkbenchActions;

const emptyData = (): WorkbenchData => ({
  seals: [],
  selectedId: null,
  stamps: {},
  sealCounter: 0,
});

const findSeal = (data: WorkbenchData, id: string | null): SealDocument | undefined =>
  data.seals.find((seal) => seal.id === id);

const replaceSeal = (
  seals: SealDocument[],
  id: string,
  updater: (seal: SealDocument) => SealDocument,
): SealDocument[] => seals.map((seal) => (seal.id === id ? updater(seal) : seal));

const mutateSelected = (
  data: WorkbenchData,
  actionName: string,
  updateState: (state: SealState) => SealState,
): Partial<WorkbenchData> => {
  if (!data.selectedId || !findSeal(data, data.selectedId)) return {};
  return {
    seals: replaceSeal(data.seals, data.selectedId, (seal) =>
      pushHistory(seal, actionName, updateState(seal.state)),
    ),
  };
};

export interface CreateWorkbenchOptions {
  storage?: StateStorage;
  storageKey?: string;
  skipPersist?: boolean;
}

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const createWorkbenchStore = (options: CreateWorkbenchOptions = {}) => {
  const initializer = (set: (partial: Partial<WorkbenchStore>) => void, get: () => WorkbenchStore): WorkbenchData & WorkbenchActions => ({
    ...emptyData(),

    addSeal: () => {
      const data = get();
      const counter = data.sealCounter + 1;
      const seal = createSealDocument(`印章 ${counter}`);
      set({ seals: [...data.seals, seal], selectedId: seal.id, sealCounter: counter });
      return seal.id;
    },

    deleteSeal: (id) => {
      const data = get();
      const index = data.seals.findIndex((seal) => seal.id === id);
      if (index < 0) return;
      const seals = data.seals.filter((seal) => seal.id !== id);
      const stamps = { ...data.stamps };
      delete stamps[id];
      let selectedId = data.selectedId;
      if (selectedId === id) {
        const neighbor = seals[index] ?? seals[index - 1] ?? null;
        selectedId = neighbor ? neighbor.id : null;
      }
      set({ seals, stamps, selectedId });
    },

    selectSeal: (id) => {
      if (findSeal(get(), id)) set({ selectedId: id });
    },

    renameSeal: (id, name) => {
      const data = get();
      if (!findSeal(data, id)) return;
      set({ seals: replaceSeal(data.seals, id, (seal) => ({ ...seal, name })) });
    },

    setCharacters: (text) => {
      const characters = Array.from(text).filter((char) => char.trim().length > 0);
      set(
        mutateSelected(get(), '输入文字', (seal) => ({
          ...setCharactersOnState(seal, characters),
        })),
      );
    },

    setFont: (font) => {
      set(
        mutateSelected(get(), '切换字体', (seal) => ({
          ...setFontOnState(seal, font),
        })),
      );
    },

    setStyle: (style) => {
      set(
        mutateSelected(get(), '切换刀法', (seal) => ({
          ...setStyleOnState(seal, style),
        })),
      );
    },

    setSize: (size) => {
      set(
        mutateSelected(get(), '调整尺寸', (seal) => ({
          ...setSizeOnState(seal, size),
        })),
      );
    },

    dragStroke: (strokeId, offset) => {
      const data = get();
      if (!data.selectedId) return;
      set({
        seals: replaceSeal(data.seals, data.selectedId, (seal) => ({
          ...seal,
          state: { ...seal.state, strokes: applyStrokeDrag(seal.state.strokes, strokeId, offset) },
        })),
      });
    },

    releaseStroke: (strokeId) => {
      set(
        mutateSelected(get(), '微调笔画', (seal) => ({
          ...seal,
          strokes: commitStrokeDrag(seal.strokes, strokeId),
        })),
      );
    },

    undo: () => {
      const data = get();
      const seal = findSeal(data, data.selectedId);
      if (!seal || !canUndo(seal)) return null;
      const action = seal.history[seal.historyIndex].actionName;
      set({ seals: replaceSeal(data.seals, seal.id, undoSeal) });
      return action;
    },

    redo: () => {
      const data = get();
      const seal = findSeal(data, data.selectedId);
      if (!seal || !canRedo(seal)) return null;
      const action = seal.history[seal.historyIndex + 1].actionName;
      set({ seals: replaceSeal(data.seals, seal.id, redoSeal) });
      return action;
    },

    stampCurrent: () => {
      const data = get();
      const seal = findSeal(data, data.selectedId);
      if (!seal || seal.state.characters.length === 0) return null;
      const record = createStampRecord(seal.id, seal.state);
      set({ stamps: { ...data.stamps, [seal.id]: [...(data.stamps[seal.id] ?? []), record] } });
      return record;
    },

    clearAll: () => set(emptyData()),
  });

  if (options.skipPersist) {
    return createStore<WorkbenchStore>()(initializer);
  }

  return createStore<WorkbenchStore>()(
    persist(initializer, {
      name: options.storageKey ?? STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => options.storage ?? noopStorage),
      partialize: (state) => ({
        seals: state.seals,
        selectedId: state.selectedId,
        stamps: state.stamps,
        sealCounter: state.sealCounter,
      }),
    }),
  );
};

export type WorkbenchStoreApi = ReturnType<typeof createWorkbenchStore>;

export const getSelectedSeal = (state: WorkbenchStore): SealDocument | undefined =>
  state.seals.find((seal) => seal.id === state.selectedId);
