import { applyPreset } from '../PresetRules.ts';
import type { PresetRuleName } from '../PresetRules.ts';
import { makeEntry } from './colorNorm.ts';
import type { ColorEntry } from './colorNorm.ts';

export interface ActiveRule {
  name: PresetRuleName;
  count?: number;
}

export interface DerivedColor extends ColorEntry {
  sourceIndex: number | null;
}

export interface DerivedPalette {
  status: 'identity' | 'ok' | 'degraded';
  note?: string;
  colors: DerivedColor[];
}

export function derivePalette(colors: ColorEntry[], rule: ActiveRule | null): DerivedPalette {
  if (!rule) {
    return {
      status: 'identity',
      colors: colors.map((color, index) => ({ ...color, sourceIndex: index }))
    };
  }
  if (colors.length === 0) {
    return {
      status: 'degraded',
      note: `规则 ${rule.name} 需要至少 1 个源颜色，当前为 0，返回未变换色板`,
      colors: []
    };
  }
  const hexes = applyPreset(rule.name, colors.map((c) => c.hex), rule.count);
  if (hexes.length === 0) {
    return {
      status: 'degraded',
      note: `规则 ${rule.name} 未产生任何颜色，返回未变换色板`,
      colors: colors.map((color, index) => ({ ...color, sourceIndex: index }))
    };
  }
  return {
    status: 'ok',
    colors: hexes.map((hex, index) => ({
      ...makeEntry(hex, `derived:${colors[0].id}:${index}`),
      sourceIndex: 0
    }))
  };
}
