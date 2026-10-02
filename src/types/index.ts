export type GritType = 120 | 400 | 1200;

export type LightPosition = 'front' | 'left45' | 'right90';

export interface Scratch {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
}

export interface GrindingState {
  grindingProgress: number;
  uniformity: number;
  reflectivity: number;
  patternClarity: number;
  scratchCount: number;
  scratches: Scratch[];
  currentGrit: GritType | null;
  isPolishing: boolean;
  lightAngle: number;
  lightPosition: LightPosition;
  isDamaged: boolean;
  polishProgress: number;

  startGrinding: (grit: GritType) => void;
  updateGrinding: (force: number, direction: number) => void;
  stopGrinding: () => void;
  startPolishing: () => void;
  updatePolishing: (force: number) => void;
  stopPolishing: () => void;
  setLightPosition: (position: LightPosition) => void;
  addScratch: (scratch: Omit<Scratch, 'id'>) => void;
  fixScratch: () => void;
  reset: () => void;
}

export const PATTERN_CLARITY_LEVELS: Array<{ min: number; max: number; description: string }> = [
  { min: 0, max: 20, description: '镜面粗糙，无明显纹饰' },
  { min: 21, max: 40, description: '纹路依稀可辨' },
  { min: 41, max: 60, description: '缠枝轮廓初现' },
  { min: 61, max: 80, description: '葡萄颗颗分明' },
  { min: 81, max: 95, description: '纹饰清晰如绘' },
  { min: 96, max: 100, description: '光可鉴人，纹饰生动' },
];

export const GRIT_COEFFICIENTS: Record<GritType, number> = {
  120: 1.5,
  400: 1.0,
  1200: 0.6,
};

export const GRIT_COLORS: Record<GritType, string> = {
  120: '#5a5a5a',
  400: '#8a8a8a',
  1200: '#d4d4d4',
};

export const LIGHT_ANGLES: Record<LightPosition, number> = {
  front: 0,
  left45: 45,
  right90: 90,
};

export const SCRATCH_THRESHOLD = 5;
export const MAX_REFLECTIVITY = 95;
export const MIN_REFLECTIVITY = 20;
