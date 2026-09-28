import { create } from 'zustand';
import type { ComponentType, Connection, Page, UIComponent } from '../types';
import { COMPONENT_DEFAULTS } from '../types';
import { generateId, snapPosition } from '../utils';

export type ViewMode = 'edit' | 'preview';

interface HistoryState {
  pages: Page[];
  currentPageId: string;
}

interface AppState {
  pages: Page[];
  currentPageId: string;
  selectedComponentId: string | null;
  selectedConnectionId: string | null;
  viewMode: ViewMode;
  isCommentPanelOpen: boolean;
  undoStack: HistoryState[];
  redoStack: HistoryState[];
  draggingFromConnector: { componentId: string; x: number; y: number } | null;
  tempConnectorEnd: { x: number; y: number } | null;

  setViewMode: (mode: ViewMode) => void;
  toggleCommentPanel: (open?: boolean) => void;
  selectComponent: (id: string | null) => void;
  selectConnection: (id: string | null) => void;

  addPage: () => void;
  setCurrentPage: (id: string) => void;
  deletePage: (id: string) => void;

  addComponent: (type: ComponentType, position: { x: number; y: number }) => void;
  updateComponent: (id: string, updates: Partial<UIComponent>) => void;
  deleteComponent: (id: string) => void;
  duplicateComponent: (id: string) => void;

  addConnection: (fromId: string, toId: string) => void;
  deleteConnection: (id: string) => void;

  setDraggingFromConnector: (info: { componentId: string; x: number; y: number } | null) => void;
  setTempConnectorEnd: (pos: { x: number; y: number } | null) => void;

  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
}

const MAX_HISTORY = 50;

function createInitialPages(): Page[] {
  const pageId = generateId('page-');
  return [
    {
      id: pageId,
      name: 'Page 1',
      components: [],
      connections: [],
    },
  ];
}

export const useAppStore = create<AppState>((set, get) => ({
  pages: createInitialPages(),
  currentPageId: createInitialPages()[0].id,
  selectedComponentId: null,
  selectedConnectionId: null,
  viewMode: 'edit',
  isCommentPanelOpen: false,
  undoStack: [],
  redoStack: [],
  draggingFromConnector: null,
  tempConnectorEnd: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleCommentPanel: (open) =>
    set((state) => ({
      isCommentPanelOpen: open !== undefined ? open : !state.isCommentPanelOpen,
    })),

  selectComponent: (id) => {
    set({
      selectedComponentId: id,
      selectedConnectionId: null,
      isCommentPanelOpen: id !== null,
    });
  },
  selectConnection: (id) =>
    set({
      selectedConnectionId: id,
      selectedComponentId: null,
    }),

  addPage: () => {
    get().saveHistory();
    set((state) => {
      if (state.pages.length >= 10) return state;
      const newPage: Page = {
        id: generateId('page-'),
        name: `Page ${state.pages.length + 1}`,
        components: [],
        connections: [],
      };
      return {
        pages: [...state.pages, newPage],
        currentPageId: newPage.id,
        selectedComponentId: null,
      };
    });
  },

  setCurrentPage: (id) => {
    get().saveHistory();
    set({
      currentPageId: id,
      selectedComponentId: null,
    });
  },

  deletePage: (id) => {
    set((state) => {
      if (state.pages.length <= 1) return state;
      const idx = state.pages.findIndex((p) => p.id === id);
      const newPages = state.pages.filter((p) => p.id !== id);
      const newCurrent =
        state.currentPageId === id
          ? newPages[Math.max(0, idx - 1)].id
          : state.currentPageId;
      return {
        pages: newPages,
        currentPageId: newCurrent,
        selectedComponentId: null,
      };
    });
  },

  addComponent: (type, position) => {
    get().saveHistory();
    set((state) => {
      const defaults = COMPONENT_DEFAULTS[type];
      const snapped = snapPosition(position);
      const newComp: UIComponent = {
        id: generateId('comp-'),
        type,
        position: snapped,
        size: { ...defaults.size },
        text: defaults.text,
        backgroundColor: '#ffffff',
        icon: defaults.icon,
        pageId: state.currentPageId,
      };
      return {
        pages: state.pages.map((p) =>
          p.id === state.currentPageId
            ? { ...p, components: [...p.components, newComp] }
            : p
        ),
        selectedComponentId: newComp.id,
      };
    });
  },

  updateComponent: (id, updates) => {
    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === state.currentPageId
          ? {
              ...p,
              components: p.components.map((c) =>
                c.id === id ? { ...c, ...updates } : c
              ),
            }
          : p
      ),
    }));
  },

  deleteComponent: (id) => {
    get().saveHistory();
    set((state) => ({
      pages: state.pages.map((p) => {
        if (p.id !== state.currentPageId) return p;
        return {
          ...p,
          components: p.components.filter((c) => c.id !== id),
          connections: p.connections.filter(
            (conn) => conn.fromComponentId !== id && conn.toComponentId !== id
          ),
        };
      }),
      selectedComponentId: null,
    }));
  },

  duplicateComponent: (id) => {
    get().saveHistory();
    set((state) => {
      const page = state.pages.find((p) => p.id === state.currentPageId);
      const comp = page?.components.find((c) => c.id === id);
      if (!comp) return state;
      const newComp: UIComponent = {
        ...comp,
        id: generateId('comp-'),
        position: { x: comp.position.x + 40, y: comp.position.y + 40 },
      };
      return {
        pages: state.pages.map((p) =>
          p.id === state.currentPageId
            ? { ...p, components: [...p.components, newComp] }
            : p
        ),
        selectedComponentId: newComp.id,
      };
    });
  },

  addConnection: (fromId, toId) => {
    if (fromId === toId) return;
    get().saveHistory();
    set((state) => {
      const page = state.pages.find((p) => p.id === state.currentPageId);
      const exists = page?.connections.find(
        (c) => c.fromComponentId === fromId && c.toComponentId === toId
      );
      if (exists) return state;
      const fromComp = page?.components.find((c) => c.id === fromId);
      const toComp = page?.components.find((c) => c.id === toId);
      if (!fromComp || !toComp) return state;
      const newConn: Connection = {
        id: generateId('conn-'),
        fromComponentId: fromId,
        toComponentId: toId,
        fromPageId: state.currentPageId,
        toPageId: state.currentPageId,
      };
      return {
        pages: state.pages.map((p) =>
          p.id === state.currentPageId
            ? { ...p, connections: [...p.connections, newConn] }
            : p
        ),
      };
    });
  },

  deleteConnection: (id) => {
    get().saveHistory();
    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === state.currentPageId
          ? { ...p, connections: p.connections.filter((c) => c.id !== id) }
          : p
      ),
      selectedConnectionId: null,
    }));
  },

  setDraggingFromConnector: (info) => set({ draggingFromConnector: info }),
  setTempConnectorEnd: (pos) => set({ tempConnectorEnd: pos }),

  saveHistory: () => {
    const { pages, currentPageId, undoStack } = get();
    const snapshot: HistoryState = {
      pages: JSON.parse(JSON.stringify(pages)),
      currentPageId,
    };
    const newStack = [...undoStack, snapshot];
    if (newStack.length > MAX_HISTORY) newStack.shift();
    set({ undoStack: newStack, redoStack: [] });
  },

  undo: () => {
    const { undoStack, pages, currentPageId, redoStack } = get();
    if (undoStack.length === 0) return;
    const current: HistoryState = {
      pages: JSON.parse(JSON.stringify(pages)),
      currentPageId,
    };
    const prev = undoStack[undoStack.length - 1];
    set({
      pages: prev.pages,
      currentPageId: prev.currentPageId,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, current],
      selectedComponentId: null,
    });
  },

  redo: () => {
    const { redoStack, pages, currentPageId, undoStack } = get();
    if (redoStack.length === 0) return;
    const current: HistoryState = {
      pages: JSON.parse(JSON.stringify(pages)),
      currentPageId,
    };
    const next = redoStack[redoStack.length - 1];
    set({
      pages: next.pages,
      currentPageId: next.currentPageId,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, current],
      selectedComponentId: null,
    });
  },
}));

export function getCurrentPage(state: AppState): Page {
  return state.pages.find((p) => p.id === state.currentPageId) || state.pages[0];
}
