export interface Point {
  x: number;
  y: number;
}

export interface LightSource {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface DrawingPath {
  id: string;
  type: 'stroke' | 'fill';
  path: string;
  color: string;
  timestamp: number;
  cx?: number;
  cy?: number;
  r?: number;
  progress?: number;
}

export interface ReferenceState {
  isDragging: boolean;
  position: { x: number; y: number };
  opacity: number;
  isSnapped: boolean;
  isPlaced: boolean;
}

export interface StoreState {
  lightSource: LightSource;
  selectedColor: string;
  drawingLayers: DrawingPath[];
  history: DrawingPath[][];
  historyIndex: number;
  reference: ReferenceState;
  setLightSource: (source: Partial<LightSource>) => void;
  setSelectedColor: (color: string) => void;
  addDrawingLayer: (layer: DrawingPath) => void;
  updateDrawingLayer: (id: string, updates: Partial<DrawingPath>) => void;
  undoDrawing: () => void;
  setReferencePosition: (pos: { x: number; y: number }) => void;
  setReferenceOpacity: (opacity: number) => void;
  setReferenceSnapped: (snapped: boolean) => void;
  setReferenceDragging: (dragging: boolean) => void;
  setReferencePlaced: (placed: boolean) => void;
}

export const COLORS = {
  STONE_BLUE: '#4a7db5',
  STONE_GREEN: '#4a9b5a',
  CINNABAR: '#c0392b',
  GAMBOGE: '#e8c76a',
  OCHER: '#8b5e3c',
  LAMP_GLOW: '#f5c542',
  SILK_BG: '#d9c9b9',
  DAMAGED: '#b0a090',
  CAVE_BG: '#1a1a1a',
  GROUND: '#3a2a1a',
  INK: '#3a3a3a',
} as const;

export const MURAL_DIMENSIONS = {
  width: 6,
  height: 4,
  damagedAreaRatio: 0.4,
} as const;

export const LIGHT_CONSTRAINTS = {
  minZ: 0.5,
  maxZ: 3,
  minRadiusPx: 50,
  maxRadiusPx: 200,
  minRadiusThree: 0.5,
  maxRadiusThree: 2,
} as const;
