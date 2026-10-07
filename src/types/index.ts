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
