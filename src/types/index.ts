export type SealFont = 'xiaozhuan' | 'miaozhuan' | 'jiudiezhuan';

export type SealSize = '1cun' | '1.5cun' | '2cun';

export type CarvingStyle = 'yinke' | 'yangke';

export interface Position {
  x: number;
  y: number;
}

export interface StrokeData {
  id: string;
  char: string;
  position: Position;
  originalPosition: Position;
  path: string;
  bounds: { width: number; height: number };
  tempOffset: Position;
  springVelocity: Position;
}

/** 一方印章可编辑参数的快照，也是撤销/重做的最小单位 */
export interface SealSnapshot {
  text: string;
  font: SealFont;
  size: SealSize;
  style: CarvingStyle;
  /** 按字序记录的笔画偏移，单位：印面像素 */
  strokeOffsets: Record<number, Position>;
}

/** 一方完整印章：参数 + 独立历史 */
export interface SealDocument extends SealSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  history: {
    past: SealSnapshot[];
    future: SealSnapshot[];
  };
}

export interface WorkshopState {
  seals: SealDocument[];
  activeId: string | null;
}

export interface SealState {
  font: SealFont;
  size: SealSize;
  style: CarvingStyle;
  characters: string[];
  strokes: StrokeData[];
}

export interface StampItem {
  id: string;
  imageData: string;
  characters: string[];
  font: SealFont;
  style: CarvingStyle;
  createdAt: number;
}

export interface HistoryItem {
  state: SealState;
  actionName: string;
}

export interface SealSizeConfig {
  value: SealSize;
  label: string;
  canvasSize: number;
}

export interface FontConfig {
  value: SealFont;
  label: string;
}

export const SEAL_SIZES: SealSizeConfig[] = [
  { value: '1cun', label: '1寸', canvasSize: 200 },
  { value: '1.5cun', label: '1.5寸', canvasSize: 300 },
  { value: '2cun', label: '2寸', canvasSize: 400 },
];

export const FONTS: FontConfig[] = [
  { value: 'xiaozhuan', label: '小篆' },
  { value: 'miaozhuan', label: '缪篆' },
  { value: 'jiudiezhuan', label: '九叠篆' },
];

export const SEAL_POSITIONS: Position[] = [
  { x: 0.75, y: 0.25 },
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 },
];

export const MAX_CHARS = 4;
export const DEFAULT_TEXT = '';
