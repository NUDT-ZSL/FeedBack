export type ProcessStage =
  | 'boiling_idle'
  | 'boiling_active'
  | 'beating_active'
  | 'scooping_active'
  | 'drying_active'
  | 'finished';

export interface PaperState {
  boilingProgress: number;
  fragmentationLevel: number;
  uniformity: number;
  dryness: number;
  watermark: string | null;
  poemText: string;
  textureSeed: number;
}

export interface GalleryItem {
  id: string;
  imageData: string;
  watermark: string;
  poemText: string;
  createdAt: number;
}

export type WatermarkType = '竹韵' | '云鹤' | '福寿' | '兰亭' | '山水' | '墨韵';

export interface Particle {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
  positions: { x: number; y: number; t: number }[];
}
