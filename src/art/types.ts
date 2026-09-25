export type ShapeKind = 'circle' | 'triangle' | 'wave' | 'rectangle';
export type TextureKind = 'smooth' | 'grainy' | 'gradient';

export const ALL_SHAPES: readonly ShapeKind[] = ['circle', 'triangle', 'wave', 'rectangle'];
export const ALL_TEXTURES: readonly TextureKind[] = ['smooth', 'grainy', 'gradient'];

/** 一幅抽象画的完整参数集；渲染输出由它唯一决定。 */
export interface ArtConfig {
  prompt: string;
  themeName: string;
  colors: string[];
  shapes: ShapeKind[];
  texture: TextureKind;
  hueShift: number;
  complexity: number;
  strokeWidth: number;
  seed: number;
}

/** 画布环境：CSS 尺寸 + 设备像素比。 */
export interface CanvasSpec {
  width: number;
  height: number;
  dpr: number;
}

/** 单条绘制指令，坐标均为相对画布的分数，与具体像素解耦。 */
export interface DrawOp {
  layer: number;
  shape: ShapeKind;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  opacity: number;
  strokeWidth: number;
}

/** 确定性渲染计划：预览与导出都只能从它出发。 */
export interface RenderPlan {
  background: { from: string; to: string; angle: number };
  ops: DrawOp[];
  meta: {
    seed: number;
    paramsHash: string;
    canvas: CanvasSpec;
    pixelWidth: number;
    pixelHeight: number;
  };
}

export interface HistoryItem {
  id: string;
  prompt: string;
  config: ArtConfig;
  canvas: CanvasSpec;
  thumbnail: string;
  timestamp: number;
}
