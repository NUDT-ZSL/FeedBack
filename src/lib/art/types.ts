export type ShapeType = "circle" | "triangle" | "rect" | "star" | "ring";

export const SHAPE_TYPES: ShapeType[] = ["circle", "triangle", "rect", "star", "ring"];

export const BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/** 生成参数：变化会导致该层形状序列重新生成 */
export interface GenerationParams {
  seed: number;
  shapeType: ShapeType;
  count: number;
  /** 尺寸区间，相对画布短边的比例 (0, 1]；minSize > maxSize 时该层不产生形状 */
  minSize: number;
  maxSize: number;
  /** 最大旋转角度（度），每个形状在 [0, rotation] 内确定性取值 */
  rotation: number;
  /** 基础色相 0-360，形状颜色围绕它确定性派生 */
  baseHue: number;
}

/** 合成参数：只影响合成结果，绝不影响形状序列 */
export interface CompositeParams {
  visible: boolean;
  /** 0-1 */
  opacity: number;
  blendMode: BlendMode;
}

export interface Layer extends GenerationParams, CompositeParams {
  id: string;
  name: string;
}

/** 一个确定性生成的形状实例，坐标与尺寸均为相对画布短边的归一化值 */
export interface ShapeInstance {
  x: number;
  y: number;
  size: number;
  /** 弧度 */
  rotation: number;
  color: string;
}

export const DEFAULT_GENERATION: GenerationParams = {
  seed: 1,
  shapeType: "circle",
  count: 40,
  minSize: 0.02,
  maxSize: 0.18,
  rotation: 180,
  baseHue: 220,
};

export const DEFAULT_COMPOSITE: CompositeParams = {
  visible: true,
  opacity: 0.9,
  blendMode: "source-over",
};
