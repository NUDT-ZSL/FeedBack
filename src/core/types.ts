/**
 * 核心数据模型：参数配置（PaperRecipe）、渲染层（LayerId）、导出产物（ExportArtifact）。
 * 该模块只包含类型与常量，不依赖 DOM，可在浏览器与 Node 离线环境共用。
 */

export type LightMode = 'daylight' | 'candlelight';

export type GoldDensityPreset = 'sparse' | 'medium' | 'dense';
/** 洒金密度：三档预设，或直接给 0-200 的片数（会被夹取到边界内） */
export type GoldDensity = GoldDensityPreset | number;

export interface PaperSize {
  width: number;
  height: number;
}

export interface PatternConfig {
  id: string;
  type: string;
  /** 缩放，边界 [0.5, 3] */
  scale: number;
  /** 相对位置，百分比，边界 [0, 100] */
  position: { x: number; y: number };
  /** 旋转角度，归一化到 [0, 360) */
  rotation: number;
  /** 透明度，边界 [0.3, 0.6] */
  opacity: number;
}

export interface InscriptionConfig {
  text: string;
  fontSize: number;
  color: string;
  /** 相对位置，百分比，边界 [0, 100] */
  position: { x: number; y: number };
  align: 'left' | 'center' | 'right';
  vertical: boolean;
}

export interface GoldFoilConfig {
  density: GoldDensity;
  /**
   * 分布种子：同一份参数（含 seed）无论渲染多少次，洒金分布完全一致。
   * 需要重新随机时，由调用方显式更换 seed（例如 +1）。
   */
  seed: number;
}

/** 笺纸配方：全部可调参数的单一来源 */
export interface PaperRecipe {
  size: PaperSize;
  baseColor: string;
  /** 印花层叠顺序 = 数组顺序（索引小的先画，被压在下面） */
  patterns: PatternConfig[];
  goldFoil: GoldFoilConfig;
  inscription: InscriptionConfig;
}

/** 渲染分层：固定的层叠顺序（z 序），题字永远在最上层，遮挡关系稳定可预期 */
export const LAYER_IDS = ['base', 'patterns', 'goldFoil', 'inscription'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface GoldFoilParticle {
  x: number;
  y: number;
  size: number;
  rotation: number;
  points: { x: number; y: number }[];
}

export const BASE_COLORS: { name: string; hex: string }[] = [
  { name: '云白', hex: '#fefaf0' },
  { name: '鹅黄', hex: '#ffe4b5' },
  { name: '松花绿', hex: '#d4e9d6' },
  { name: '胭脂红', hex: '#f5d0c9' },
  { name: '石青', hex: '#c9d8e6' },
  { name: '藤紫', hex: '#e6d5e6' },
];

export const GOLD_DENSITY_COUNTS: Record<GoldDensityPreset, number> = {
  sparse: 20,
  medium: 50,
  dense: 100,
};

/** 洒金片数边界：允许 0（不洒金）到 200（超出自动夹取） */
export const GOLD_MAX_COUNT = 200;

export const DEFAULT_RECIPE: PaperRecipe = {
  size: { width: 450, height: 600 },
  baseColor: '#fefaf0',
  patterns: [],
  goldFoil: { density: 'medium', seed: 0 },
  inscription: {
    text: '',
    fontSize: 28,
    color: '#3e2723',
    position: { x: 85, y: 10 },
    align: 'right',
    vertical: true,
  },
};
