import { WoodType } from './types.ts';
import type { FontId } from './types.ts';

export interface FontEntry {
  id: FontId;
  label: string;
  cssFamily: string;
  remote: boolean;
  cached: boolean;
  minHardness: number;
  minSizeMm: number;
  allowedWoods: WoodType[] | null;
}

export const FONT_CATALOG: readonly FontEntry[] = [
  {
    id: 'zhuanshu',
    label: '小篆',
    cssFamily: "'Noto Serif SC', 'STSong', serif",
    remote: false,
    cached: true,
    minHardness: 0,
    minSizeMm: 0,
    allowedWoods: null,
  },
  {
    id: 'kaishu',
    label: '楷书',
    cssFamily: "'Kaiti SC', 'KaiTi', serif",
    remote: false,
    cached: true,
    minHardness: 0,
    minSizeMm: 0,
    allowedWoods: null,
  },
  {
    id: 'miao',
    label: '缪篆',
    cssFamily: "'Noto Serif SC', 'STSong', serif",
    remote: false,
    cached: true,
    minHardness: 55,
    minSizeMm: 12,
    allowedWoods: null,
  },
  {
    id: 'tiexian',
    label: '铁线篆',
    cssFamily: "'Noto Serif SC', 'STSong', serif",
    remote: false,
    cached: true,
    minHardness: 55,
    minSizeMm: 15,
    allowedWoods: [WoodType.Boxwood],
  },
  {
    id: 'mashan',
    label: '马善政体',
    cssFamily: "'Ma Shan Zheng', 'Kaiti SC', cursive",
    remote: true,
    cached: false,
    minHardness: 0,
    minSizeMm: 0,
    allowedWoods: null,
  },
];

export function getFontEntry(id: FontId): FontEntry {
  const entry = FONT_CATALOG.find((f) => f.id === id);
  if (!entry) throw new Error(`unknown font: ${id}`);
  return entry;
}
