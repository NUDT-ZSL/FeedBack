/**
 * 核心类型与常量定义。
 *
 * 边界划分（本文件只描述"参数配置"，不引用任何渲染/导出实现）：
 *   PaperRecipe（参数配置） → LayerOutput（分层渲染结果） → ExportArtifact（导出产物）
 */

export type LightMode = 'daylight' | 'candlelight';

/** 笺纸尺寸预设（单位 px，导出时按比例缩放入匣） */
export interface PaperSizePreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const PAPER_SIZES: readonly PaperSizePreset[] = [
  { id: 'standard', name: '标准笺', width: 300, height: 400 },
  { id: 'square', name: '斗方', width: 400, height: 400 },
  { id: 'banner', name: '横幅', width: 500, height: 300 },
  { id: 'scroll', name: '长卷', width: 240, height: 600 },
];

/** 宣纸底色预设 */
export interface PaperColorPreset {
  id: string;
  name: string;
  hex: string;
}

export const PAPER_COLORS: readonly PaperColorPreset[] = [
  { id: 'yunbai', name: '云白', hex: '#fefaf0' },
  { id: 'ehuang', name: '鹅黄', hex: '#ffe4b5' },
  { id: 'songhua', name: '松花绿', hex: '#d4e9d6' },
  { id: 'yanzhi', name: '胭脂红', hex: '#f5d0c9' },
  { id: 'shiqing', name: '石青', hex: '#c9d8e6' },
  { id: 'tengzi', name: '藤紫', hex: '#e6d5e6' },
];

/** 8 种古风印花纹样 */
export type PatternType =
  | 'plum'
  | 'orchid'
  | 'bamboo'
  | 'chrysanthemum'
  | 'cloud'
  | 'wave'
  | 'fret'
  | 'ice';

export const PATTERN_TYPES: readonly { id: PatternType; name: string }[] = [
  { id: 'plum', name: '梅花' },
  { id: 'orchid', name: '兰草' },
  { id: 'bamboo', name: '竹子' },
  { id: 'chrysanthemum', name: '菊花' },
  { id: 'cloud', name: '祥云' },
  { id: 'wave', name: '水纹' },
  { id: 'fret', name: '回纹' },
  { id: 'ice', name: '冰裂纹' },
];

/** 单层纹样配置：层叠顺序由 order 决定（大者在上），同 order 按 id 稳定排序 */
export interface PatternLayerConfig {
  id: string;
  type: PatternType;
  order: number;
  scale: number; // 0.5 - 3
  position: { x: number; y: number }; // 相对位置 0 - 100
  rotation: number; // 角度，5 度步长
  opacity: number; // 0.3 - 0.6
}

/** 洒金密度：0 - 100，对应金箔片数量 */
export interface GoldFoilConfig {
  density: number;
}

export const GOLD_DENSITY_PRESETS: readonly { id: 'sparse' | 'medium' | 'dense'; name: string; value: number }[] = [
  { id: 'sparse', name: '稀疏', value: 20 },
  { id: 'medium', name: '适中', value: 50 },
  { id: 'dense', name: '密集', value: 100 },
];

/** 题字排版配置（独立于纹样、底色层） */
export interface InscriptionConfig {
  text: string;
  layout: 'vertical' | 'horizontal';
  position: { x: number; y: number }; // 0 - 100，题字块锚点
  fontSize: number; // 10 - 48
  color: string;
}

/** 笺纸完整配方：五类参数各自独立 */
export interface PaperRecipe {
  sizeId: string;
  baseColorId: string;
  patterns: PatternLayerConfig[];
  goldFoil: GoldFoilConfig;
  inscription: InscriptionConfig;
}

/** 参数合法边界（越界统一收敛到边界，保证渲染/导出不空白、不错位） */
export const LIMITS = {
  patternScale: { min: 0.5, max: 3 },
  patternOpacity: { min: 0.3, max: 0.6 },
  position: { min: 0, max: 100 },
  rotationStep: 5,
  goldDensity: { min: 0, max: 100 },
  fontSize: { min: 10, max: 48 },
  patternFootprint: 100,
} as const;

/** 固定层叠关系（自下而上）：底色 → 纹样 → 洒金 → 题字 */
export const LAYER_Z_ORDER = ['base', 'patterns', 'goldFoil', 'inscription'] as const;

export type LayerKind = 'base' | 'pattern' | 'goldFoil' | 'inscription';

/** 光源罩染色：预览用同色 DOM 罩层（0.8s 过渡），导出作为同一数值的 rect 指令合入 */
export const LIGHT_TINTS: Record<LightMode, string> = {
  daylight: 'rgba(255, 252, 240, 0.10)',
  candlelight: 'rgba(255, 168, 64, 0.22)',
};

export const LIGHT_NAMES: Record<LightMode, string> = {
  daylight: '日光',
  candlelight: '烛光',
};
