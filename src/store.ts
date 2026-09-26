import { create } from 'zustand';

export type SemanticTag = 'primary' | 'secondary' | 'accent' | 'background' | 'text';

export interface Swatch {
  id: string;
  tag: SemanticTag;
  name: string;
  color: string;
  x: number;
  y: number;
}

export type ComponentBindingKey =
  | 'card-header'
  | 'card-button'
  | 'button-bg'
  | 'gradient-start'
  | 'gradient-end'
  | 'text-primary'
  | 'surface-bg';

export interface SemanticBindings {
  'card-header': SemanticTag;
  'card-button': SemanticTag;
  'button-bg': SemanticTag;
  'gradient-start': SemanticTag;
  'gradient-end': SemanticTag;
  'text-primary': SemanticTag;
  'surface-bg': SemanticTag;
}

export interface PaletteExport {
  swatches: Swatch[];
  bindings: SemanticBindings;
  version: string;
}

export interface PresetSwatch {
  tag: SemanticTag;
  name: string;
  color: string;
}

export const PRESET_SWATCHES: PresetSwatch[] = [
  { tag: 'primary', name: '主色', color: '#3B82F6' },
  { tag: 'secondary', name: '辅色', color: '#10B981' },
  { tag: 'accent', name: '强调色', color: '#F59E0B' },
  { tag: 'background', name: '背景色', color: '#F8FAFC' },
  { tag: 'text', name: '文字色', color: '#1E293B' }
];

const DEFAULT_BINDINGS: SemanticBindings = {
  'card-header': 'primary',
  'card-button': 'secondary',
  'button-bg': 'primary',
  'gradient-start': 'primary',
  'gradient-end': 'secondary',
  'text-primary': 'text',
  'surface-bg': 'background'
};

const MAX_SWATCHES = 12;

const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

interface PaletteState {
  swatches: Swatch[];
  bindings: SemanticBindings;
  toast: { message: string; visible: boolean } | null;
  addSwatch: (tag: SemanticTag, x: number, y: number) => boolean;
  updateSwatch: (id: string, color: string) => void;
  removeSwatch: (id: string) => void;
  setSemanticBinding: (componentKey: ComponentBindingKey, tag: SemanticTag) => void;
  exportPalette: () => string;
  importPalette: (json: string) => boolean;
  showToast: (message: string) => void;
  hideToast: () => void;
  getColorByTag: (tag: SemanticTag) => string;
}

const DEFAULT_COLORS: Record<SemanticTag, string> = {
  primary: '#3B82F6',
  secondary: '#10B981',
  accent: '#F59E0B',
  background: '#F8FAFC',
  text: '#1E293B'
};

export const usePaletteStore = create<PaletteState>((set, get) => ({
  swatches: [],
  bindings: { ...DEFAULT_BINDINGS },
  toast: null,

  addSwatch: (tag, x, y) => {
    const state = get();
    if (state.swatches.length >= MAX_SWATCHES) {
      get().showToast('最多只能添加12个色块');
      return false;
    }
    const preset = PRESET_SWATCHES.find(p => p.tag === tag);
    const existing = state.swatches.find(s => s.tag === tag);
    const color = existing ? existing.color : (preset?.color || DEFAULT_COLORS[tag]);
    const name = preset?.name || tag;
    const newSwatch: Swatch = {
      id: generateId(),
      tag,
      name,
      color,
      x,
      y
    };
    set({ swatches: [...state.swatches, newSwatch] });
    return true;
  },

  updateSwatch: (id, color) => {
    set(state => ({
      swatches: state.swatches.map(s =>
        s.id === id ? { ...s, color } : s
      )
    }));
  },

  removeSwatch: (id) => {
    set(state => ({
      swatches: state.swatches.filter(s => s.id !== id)
    }));
  },

  setSemanticBinding: (componentKey, tag) => {
    set(state => ({
      bindings: { ...state.bindings, [componentKey]: tag }
    }));
  },

  exportPalette: () => {
    const state = get();
    const data: PaletteExport = {
      swatches: state.swatches,
      bindings: state.bindings,
      version: '1.0.0'
    };
    return JSON.stringify(data, null, 2);
  },

  importPalette: (json) => {
    try {
      const data = JSON.parse(json) as PaletteExport;
      if (!data.swatches || !data.bindings) {
        get().showToast('JSON格式无效');
        return false;
      }
      set({
        swatches: data.swatches.slice(0, MAX_SWATCHES).map(s => ({
          ...s,
          id: generateId()
        })),
        bindings: { ...DEFAULT_BINDINGS, ...data.bindings }
      });
      get().showToast('色板导入成功');
      return true;
    } catch {
      get().showToast('JSON解析失败');
      return false;
    }
  },

  showToast: (message) => {
    set({ toast: { message, visible: true } });
    setTimeout(() => {
      get().hideToast();
    }, 2000);
  },

  hideToast: () => {
    set({ toast: null });
  },

  getColorByTag: (tag) => {
    const state = get();
    const swatch = state.swatches.find(s => s.tag === tag);
    return swatch?.color || DEFAULT_COLORS[tag];
  }
}));
