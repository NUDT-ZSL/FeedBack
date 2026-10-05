import { generateId } from '../utils/colorUtils.ts';
import { PRESET_RULE_NAMES } from '../PresetRules.ts';
import type { PresetRuleName } from '../PresetRules.ts';
import {
  makeEntry,
  normalizeHex,
  normalizePercent,
  normalizeRgb,
  round4,
  withLightness,
  withSaturation
} from './colorNorm.ts';
import type { ColorEntry } from './colorNorm.ts';
import { derivePalette } from './presetEngine.ts';
import type { ActiveRule, DerivedPalette } from './presetEngine.ts';

export type { ColorEntry } from './colorNorm.ts';
export type { ActiveRule, DerivedColor, DerivedPalette } from './presetEngine.ts';

export type EntryPoint =
  | 'hex-input'
  | 'rgb-input'
  | 'color-picker'
  | 'lightness-slider'
  | 'saturation-slider'
  | 'add-color'
  | 'delete-color'
  | 'drag-reorder'
  | 'preset-rule'
  | 'project';

export interface PaletteState {
  colors: ColorEntry[];
  rule: ActiveRule | null;
}

export interface Transition {
  seq: number;
  entry: EntryPoint;
  kind: string;
  accepted: boolean;
  noop: boolean;
  reason?: string;
  state: PaletteState;
  derived: DerivedPalette;
}

export interface ProjectFileV2 {
  version: 2;
  name?: string;
  savedAt: string;
  colors: ColorEntry[];
  rule: ActiveRule | null;
}

export interface PaletteStoreOptions {
  idGenerator?: () => string;
  initial?: PaletteState;
}

export interface PaletteStore {
  getState(): PaletteState;
  getDerived(): DerivedPalette;
  getTransitions(): Transition[];
  addColor(raw: unknown, entry?: EntryPoint): Transition;
  setHex(id: string, raw: unknown, entry?: EntryPoint): Transition;
  setRgb(id: string, r: unknown, g: unknown, b: unknown, entry?: EntryPoint): Transition;
  setLightness(id: string, value: unknown, entry?: EntryPoint): Transition;
  setSaturation(id: string, value: unknown, entry?: EntryPoint): Transition;
  removeColor(id: string, entry?: EntryPoint): Transition;
  reorder(fromIndex: number, toIndex: number, entry?: EntryPoint): Transition;
  applyPreset(name: unknown, count?: unknown, entry?: EntryPoint): Transition;
  clearPreset(entry?: EntryPoint): Transition;
  serialize(name?: string): string;
  load(payload: unknown, entry?: EntryPoint): Transition;
}

function cloneState(state: PaletteState): PaletteState {
  return structuredClone(state);
}

function sameState(a: PaletteState, b: PaletteState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isValidHsl(h: unknown, s: unknown, l: unknown): boolean {
  const inRange = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  return inRange(h, 0, 360) && inRange(s, 0, 100) && inRange(l, 0, 100);
}

export function createPaletteStore(options: PaletteStoreOptions = {}): PaletteStore {
  const nextId = options.idGenerator ?? generateId;
  let state: PaletteState = options.initial
    ? cloneState(options.initial)
    : { colors: [], rule: null };
  const transitions: Transition[] = [];

  function commit(
    entry: EntryPoint,
    kind: string,
    next: PaletteState | null,
    reason?: string
  ): Transition {
    const accepted = next !== null;
    const effective = next ?? state;
    const noop = accepted && sameState(state, effective);
    if (accepted) {
      state = effective;
    }
    const transition: Transition = {
      seq: transitions.length + 1,
      entry,
      kind,
      accepted,
      noop,
      ...(reason ? { reason } : {}),
      state: cloneState(state),
      derived: derivePalette(state.colors, state.rule)
    };
    transitions.push(transition);
    return transition;
  }

  function reject(entry: EntryPoint, kind: string, reason: string): Transition {
    return commit(entry, kind, null, reason);
  }

  function normalizeColorInput(raw: unknown): { ok: true; hex: string } | { ok: false; error: string } {
    if (typeof raw === 'object' && raw !== null && 'r' in raw && 'g' in raw && 'b' in raw) {
      const { r, g, b } = raw as { r: unknown; g: unknown; b: unknown };
      const res = normalizeRgb(r, g, b);
      return res.ok ? { ok: true, hex: res.value } : { ok: false, error: res.error };
    }
    const res = normalizeHex(raw);
    return res.ok ? { ok: true, hex: res.value } : { ok: false, error: res.error };
  }

  function updateColor(
    id: string,
    entry: EntryPoint,
    kind: string,
    updater: (color: ColorEntry) => ColorEntry | null | { error: string }
  ): Transition {
    const index = state.colors.findIndex((c) => c.id === id);
    if (index === -1) {
      return reject(entry, kind, `未找到颜色 id: ${id}`);
    }
    const updated = updater(state.colors[index]);
    if (updated === null) {
      return commit(entry, kind, state);
    }
    if (typeof updated === 'object' && 'error' in updated) {
      return reject(entry, kind, updated.error);
    }
    const colors = state.colors.slice();
    colors[index] = updated;
    return commit(entry, kind, { ...state, colors });
  }

  function parseProject(payload: unknown): PaletteState | { error: string } {
    let data: unknown = payload;
    if (typeof payload === 'string') {
      try {
        data = JSON.parse(payload);
      } catch {
        return { error: '项目数据不是合法 JSON' };
      }
    }
    const warnings: string[] = [];
    let rawColors: unknown[] | null = null;
    let rule: ActiveRule | null = null;
    let structured = false;

    if (Array.isArray(data)) {
      rawColors = data;
    } else if (typeof data === 'object' && data !== null && Array.isArray((data as { colors?: unknown }).colors)) {
      const obj = data as { colors: unknown[]; rule?: unknown };
      rawColors = obj.colors;
      structured = obj.colors.length > 0 && typeof obj.colors[0] === 'object';
      if (obj.rule && typeof obj.rule === 'object' && PRESET_RULE_NAMES.includes((obj.rule as ActiveRule).name)) {
        const r = obj.rule as ActiveRule;
        rule = { name: r.name, ...(typeof r.count === 'number' ? { count: r.count } : {}) };
      }
    } else {
      return { error: '项目数据格式无法识别（既不是颜色数组也不是项目对象）' };
    }

    const colors: ColorEntry[] = [];
    for (const item of rawColors) {
      if (typeof item === 'string') {
        const hex = normalizeHex(item);
        if (!hex.ok) {
          warnings.push(`跳过非法颜色 "${item}"`);
          continue;
        }
        colors.push(makeEntry(hex.value, nextId()));
      } else if (typeof item === 'object' && item !== null) {
        const raw = item as Partial<ColorEntry>;
        const hex = normalizeHex(raw.hex);
        if (!hex.ok) {
          warnings.push(`跳过非法颜色条目 ${JSON.stringify(raw.hex)}`);
          continue;
        }
        const id = typeof raw.id === 'string' && raw.id ? raw.id : nextId();
        if (isValidHsl(raw.h, raw.s, raw.l)) {
          colors.push({
            id,
            hex: hex.value,
            h: round4(raw.h as number),
            s: round4(raw.s as number),
            l: round4(raw.l as number)
          });
        } else {
          colors.push(makeEntry(hex.value, id));
        }
      } else {
        warnings.push(`跳过无法识别的条目 ${JSON.stringify(item)}`);
      }
    }
    void structured;
    void warnings;
    return { colors, rule };
  }

  return {
    getState: () => cloneState(state),
    getDerived: () => derivePalette(state.colors, state.rule),
    getTransitions: () => transitions.slice(),

    addColor(raw: unknown, entry: EntryPoint = 'add-color'): Transition {
      const parsed = normalizeColorInput(raw);
      if (!parsed.ok) return reject(entry, 'add', parsed.error);
      if (state.colors.some((c) => c.hex === parsed.hex)) {
        return commit(entry, 'add', state, `颜色 ${parsed.hex} 已存在，未重复追加`);
      }
      return commit(entry, 'add', {
        ...state,
        colors: [...state.colors, makeEntry(parsed.hex, nextId())]
      });
    },

    setHex(id: string, raw: unknown, entry: EntryPoint = 'hex-input'): Transition {
      const parsed = normalizeHex(raw);
      if (!parsed.ok) return reject(entry, 'set-hex', parsed.error);
      return updateColor(id, entry, 'set-hex', (color) => makeEntry(parsed.value, color.id));
    },

    setRgb(id: string, r: unknown, g: unknown, b: unknown, entry: EntryPoint = 'rgb-input'): Transition {
      const parsed = normalizeRgb(r, g, b);
      if (!parsed.ok) return reject(entry, 'set-rgb', parsed.error);
      return updateColor(id, entry, 'set-rgb', (color) => makeEntry(parsed.value, color.id));
    },

    setLightness(id: string, value: unknown, entry: EntryPoint = 'lightness-slider'): Transition {
      const parsed = normalizePercent(value, '亮度');
      if (!parsed.ok) return reject(entry, 'set-lightness', parsed.error);
      return updateColor(id, entry, 'set-lightness', (color) => withLightness(color, parsed.value));
    },

    setSaturation(id: string, value: unknown, entry: EntryPoint = 'saturation-slider'): Transition {
      const parsed = normalizePercent(value, '饱和度');
      if (!parsed.ok) return reject(entry, 'set-saturation', parsed.error);
      return updateColor(id, entry, 'set-saturation', (color) => withSaturation(color, parsed.value));
    },

    removeColor(id: string, entry: EntryPoint = 'delete-color'): Transition {
      const index = state.colors.findIndex((c) => c.id === id);
      if (index === -1) {
        return reject(entry, 'remove', `未找到颜色 id: ${id}`);
      }
      const colors = state.colors.slice();
      colors.splice(index, 1);
      return commit(entry, 'remove', { ...state, colors });
    },

    reorder(fromIndex: number, toIndex: number, entry: EntryPoint = 'drag-reorder'): Transition {
      const len = state.colors.length;
      const valid =
        Number.isInteger(fromIndex) && Number.isInteger(toIndex) &&
        fromIndex >= 0 && fromIndex < len && toIndex >= 0 && toIndex < len;
      if (!valid) {
        return reject(entry, 'reorder', `拖动索引越界: ${fromIndex} -> ${toIndex}（当前 ${len} 个颜色）`);
      }
      const colors = state.colors.slice();
      const [moved] = colors.splice(fromIndex, 1);
      colors.splice(toIndex, 0, moved);
      return commit(entry, 'reorder', { ...state, colors });
    },

    applyPreset(name: unknown, count?: unknown, entry: EntryPoint = 'preset-rule'): Transition {
      if (!PRESET_RULE_NAMES.includes(name as PresetRuleName)) {
        return reject(entry, 'apply-preset', `未知预设规则: ${String(name)}`);
      }
      if (state.colors.length === 0) {
        return reject(entry, 'apply-preset', `规则 ${String(name)} 需要至少 1 个源颜色，当前色板为空`);
      }
      let ruleCount: number | undefined;
      if (count !== undefined) {
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
          return reject(entry, 'apply-preset', `规则数量非法: ${String(count)}（需为 >=1 的整数）`);
        }
        ruleCount = count;
      }
      const rule: ActiveRule = { name: name as PresetRuleName, ...(ruleCount !== undefined ? { count: ruleCount } : {}) };
      return commit(entry, 'apply-preset', { ...state, rule });
    },

    clearPreset(entry: EntryPoint = 'preset-rule'): Transition {
      return commit(entry, 'clear-preset', { ...state, rule: null });
    },

    serialize(name?: string): string {
      const file: ProjectFileV2 = {
        version: 2,
        ...(name ? { name } : {}),
        savedAt: new Date().toISOString(),
        colors: cloneState(state).colors,
        rule: state.rule ? { ...state.rule } : null
      };
      return JSON.stringify(file, null, 2);
    },

    load(payload: unknown, entry: EntryPoint = 'project'): Transition {
      const parsed = parseProject(payload);
      if ('error' in parsed) {
        return reject(entry, 'load', parsed.error);
      }
      return commit(entry, 'load', parsed);
    }
  };
}
