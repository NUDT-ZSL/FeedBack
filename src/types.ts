export type MaterialType = 'chuPi' | 'sangPi' | 'maXianWei';

export type PaperStage = 'pulp' | 'scooping' | 'wet' | 'pressing' | 'pressed' | 'dragging' | 'drying' | 'dried' | 'inspecting' | 'done';

export type QualityGrade = 'excellent' | 'good' | 'medium' | 'poor';

export interface PulpState {
  concentration: number;
  materials: Record<MaterialType, number>;
}

export interface PaperState {
  id: string;
  stage: PaperStage;
  uniformity: number;
  dryness: number;
  pressLevel: number;
  inspectionPoints: number;
  position?: { x: number; y: number };
}

export interface QualityResult {
  id: string;
  timestamp: number;
  materials: Record<MaterialType, number>;
  concentration: number;
  uniformity: number;
  dryness: number;
  pressLevel: number;
  score: number;
  grade: QualityGrade;
}

export interface Ripple {
  id: number;
  x: number;
  y: number;
}

export interface WorkshopState {
  pulp: PulpState;
  currentPaper: PaperState | null;
  history: QualityResult[];
  isAnimating: boolean;
  currentStep: number;
  isResetting: boolean;
  showScoreAnimation: boolean;
  finalScore: number;
  ripples: Ripple[];
  showWaterStain: boolean;
  isScooping: boolean;
  scoopProgress: number;
}

export interface WorkshopActions {
  addMaterial: (type: MaterialType, amount: number) => void;
  startScooping: () => void;
  updateScoopProgress: (progress: number) => void;
  finishScooping: () => void;
  startPressing: () => void;
  finishPressing: () => void;
  startDragging: () => void;
  placeOnDryingWall: () => void;
  updateDryness: (dryness: number) => void;
  finishDrying: () => void;
  addInspectionPoint: (x: number, y: number) => void;
  calculateQuality: () => void;
  resetAll: () => void;
  finishResetting: () => void;
  hideScoreAnimation: () => void;
  removeRipple: (id: number) => void;
  hideWaterStain: () => void;
  loadHistory: () => void;
}
