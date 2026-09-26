import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { calculateContrastRatio } from '../utils/contrastCalculator';

export interface ColorItem {
  id: string;
  hex: string;
  name?: string;
  position: { x: number; y: number };
}

export interface HistoryRecord {
  id: string;
  timestamp: number;
  colors: ColorItem[];
  contrastScore: number;
  status: 'pass' | 'fail';
  selectedColorId: string | null;
  colorBlindMode: ColorBlindMode;
}

export type ColorBlindMode = 'none' | 'achromatopsia' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface AppState {
  colors: ColorItem[];
  selectedColorId: string | null;
  history: HistoryRecord[];
  colorBlindMode: ColorBlindMode;
  timestampLog: number[];
}

type Action =
  | { type: 'ADD_COLOR'; payload: ColorItem }
  | { type: 'REMOVE_COLOR'; payload: string }
  | { type: 'UPDATE_COLOR_POSITION'; payload: { id: string; x: number; y: number } }
  | { type: 'UPDATE_COLOR_HEX'; payload: { id: string; hex: string } }
  | { type: 'SELECT_COLOR'; payload: string | null }
  | { type: 'SET_COLOR_BLIND_MODE'; payload: ColorBlindMode }
  | { type: 'ADD_HISTORY'; payload: HistoryRecord }
  | { type: 'RESTORE_HISTORY'; payload: HistoryRecord }
  | { type: 'ADD_TIMESTAMP'; payload: number }
  | { type: 'REPLACE_COLORS'; payload: ColorItem[] };

const initialColors: ColorItem[] = [
  { id: 'c1', hex: '#1976D2', position: { x: 60, y: 240 } },
  { id: 'c2', hex: '#FFC107', position: { x: 160, y: 300 } },
  { id: 'c3', hex: '#FFFFFF', position: { x: 110, y: 380 } },
];

const initialState: AppState = {
  colors: initialColors,
  selectedColorId: null,
  history: [],
  colorBlindMode: 'none',
  timestampLog: [],
};

function generateId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_COLOR':
      return {
        ...state,
        colors: [...state.colors, action.payload].slice(-5),
      };
    case 'REMOVE_COLOR':
      return {
        ...state,
        colors: state.colors.filter((c) => c.id !== action.payload),
        selectedColorId: state.selectedColorId === action.payload ? null : state.selectedColorId,
      };
    case 'UPDATE_COLOR_POSITION':
      return {
        ...state,
        colors: state.colors.map((c) =>
          c.id === action.payload.id
            ? { ...c, position: { x: action.payload.x, y: action.payload.y } }
            : c
        ),
      };
    case 'UPDATE_COLOR_HEX':
      return {
        ...state,
        colors: state.colors.map((c) =>
          c.id === action.payload.id ? { ...c, hex: action.payload.hex } : c
        ),
      };
    case 'SELECT_COLOR':
      return { ...state, selectedColorId: action.payload };
    case 'SET_COLOR_BLIND_MODE':
      return {
        ...state,
        colorBlindMode: action.payload,
      };
    case 'ADD_HISTORY':
      return {
        ...state,
        history: [action.payload, ...state.history].slice(0, 20),
      };
    case 'RESTORE_HISTORY':
      return {
        ...state,
        colors: action.payload.colors,
        selectedColorId: action.payload.selectedColorId,
        colorBlindMode: action.payload.colorBlindMode,
      };
    case 'ADD_TIMESTAMP':
      return {
        ...state,
        timestampLog: [...state.timestampLog, action.payload].slice(-10),
      };
    case 'REPLACE_COLORS':
      return { ...state, colors: action.payload };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  addColor: (hex: string) => void;
  removeColor: (id: string) => void;
  updateColorPosition: (id: string, x: number, y: number) => void;
  updateColorHex: (id: string, hex: string) => void;
  selectColor: (id: string | null) => void;
  setColorBlindMode: (mode: ColorBlindMode) => void;
  addHistory: (selectedIndex: number) => void;
  restoreHistory: (id: string) => void;
  handleCollisions: (movedId: string) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const NODE_RADIUS = 24;

export const AppContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastHistoryTime = useRef<number>(0);

  const addColor = useCallback((hex: string) => {
    const newColor: ColorItem = {
      id: generateId(),
      hex,
      position: {
        x: 60 + Math.random() * 140,
        y: 200 + Math.random() * 200,
      },
    };
    dispatch({ type: 'ADD_COLOR', payload: newColor });
  }, []);

  const removeColor = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_COLOR', payload: id });
  }, []);

  const updateColorPosition = useCallback((id: string, x: number, y: number) => {
    dispatch({ type: 'UPDATE_COLOR_POSITION', payload: { id, x, y } });
  }, []);

  const updateColorHex = useCallback((id: string, hex: string) => {
    dispatch({ type: 'UPDATE_COLOR_HEX', payload: { id, hex } });
  }, []);

  const selectColor = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_COLOR', payload: id });
  }, []);

  const setColorBlindMode = useCallback((mode: ColorBlindMode) => {
    dispatch({ type: 'SET_COLOR_BLIND_MODE', payload: mode });
    dispatch({ type: 'ADD_TIMESTAMP', payload: Date.now() });
  }, []);

  const calculateAverageContrast = useCallback((colors: ColorItem[]): number => {
    if (colors.length < 2) return 0;
    let total = 0;
    let count = 0;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        total += calculateContrastRatio(colors[i].hex, colors[j].hex);
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }, []);

  const addHistory = useCallback(
    (selectedIndex: number) => {
      const now = Date.now();
      if (now - lastHistoryTime.current < 1000) return;
      lastHistoryTime.current = now;

      const avgContrast = calculateAverageContrast(state.colors);
      const record: HistoryRecord = {
        id: generateId(),
        timestamp: now,
        colors: JSON.parse(JSON.stringify(state.colors)),
        contrastScore: Math.round(avgContrast * 100) / 100,
        status: avgContrast >= 4.5 ? 'pass' : 'fail',
        selectedColorId: state.selectedColorId,
        colorBlindMode: state.colorBlindMode,
      };
      dispatch({ type: 'ADD_HISTORY', payload: record });
    },
    [state.colors, state.selectedColorId, state.colorBlindMode, calculateAverageContrast]
  );

  const restoreHistory = useCallback((id: string) => {
    const record = state.history.find((h) => h.id === id);
    if (record) {
      dispatch({ type: 'RESTORE_HISTORY', payload: record });
    }
  }, [state.history]);

  const handleCollisions = useCallback(
    (movedId: string) => {
      const colors = state.colors;
      const moved = colors.find((c) => c.id === movedId);
      if (!moved) return;

      const updated = colors.map((c) => ({ ...c, position: { ...c.position } }));
      const movedIdx = updated.findIndex((c) => c.id === movedId);

      for (let i = 0; i < updated.length; i++) {
        if (i === movedIdx) continue;
        const other = updated[i];
        const dx = moved.position.x - other.position.x;
        const dy = moved.position.y - other.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = NODE_RADIUS * 2 + 8;

        if (distance < minDist && distance > 0) {
          const overlap = (minDist - distance) / 2;
          const nx = dx / distance;
          const ny = dy / distance;
          const damping = 0.8;
          updated[movedIdx].position.x += overlap * nx * damping;
          updated[movedIdx].position.y += overlap * ny * damping;
          updated[i].position.x -= overlap * nx * damping;
          updated[i].position.y -= overlap * ny * damping;
        }
      }
      dispatch({ type: 'REPLACE_COLORS', payload: updated });
    },
    [state.colors]
  );

  useEffect(() => {
    const interval = setInterval(() => {
      if (state.colors.length >= 2) {
        addHistory(0);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [state.colors, addHistory]);

  const value: AppContextValue = {
    state,
    addColor,
    removeColor,
    updateColorPosition,
    updateColorHex,
    selectColor,
    setColorBlindMode,
    addHistory,
    restoreHistory,
    handleCollisions,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContextProvider');
  }
  return context;
}
