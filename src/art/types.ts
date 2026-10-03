export type ShapeKind = 'circle' | 'square' | 'triangle' | 'polygon' | 'mixed';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export const SHAPE_KINDS: ShapeKind[] = ['circle', 'square', 'triangle', 'polygon', 'mixed'];

// 生成参数：只影响该层形状序列，与合成无关
export interface LayerGenParams {
  shape: ShapeKind;
  count: number;
  minSize: number;
  maxSize: number;
  rotation: number; // 最大随机旋转角度（度）
  seed: number;
}

// 合成参数：只影响合成结果，绝不影响形状序列
export interface LayerCompositeParams {
  opacity: number; // 0 - 1
  blendMode: BlendMode;
  visible: boolean;
}

export interface ArtLayer extends LayerGenParams, LayerCompositeParams {
  id: string;
  name: string;
}

export interface Shape {
  kind: 'circle' | 'square' | 'triangle' | 'polygon';
  x: number; // 归一化坐标 0-1
  y: number;
  radius: number; // 归一化尺寸（相对画布短边）
  rotation: number; // 弧度
  hue: number;
  saturation: number;
  lightness: number;
  sides: number; // polygon 有效
}
