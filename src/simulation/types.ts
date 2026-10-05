import type { MaterialType, QualityGrade } from '../types';

export type Rng = () => number;

export type SimStage =
  | 'idle'
  | 'wet'
  | 'pressed'
  | 'drying'
  | 'dried'
  | 'inspecting'
  | 'done';

export type ViolationType =
  | 'MATERIAL_OUT_OF_RANGE'
  | 'CONCENTRATION_OUT_OF_RANGE'
  | 'PRESS_OUT_OF_RANGE'
  | 'INSPECT_BEFORE_DRIED'
  | 'INSPECTION_LIMIT_EXCEEDED'
  | 'INVALID_SEQUENCE'
  | 'NO_PAPER';

export interface SimViolation {
  type: ViolationType;
  message: string;
}

export interface SimPaper {
  stage: SimStage;
  uniformity: number;
  dryness: number;
  pressLevel: number;
  inspectionPoints: number;
}

export interface SimState {
  materials: Record<MaterialType, number>;
  concentration: number;
  paper: SimPaper | null;
  result: { score: number; grade: QualityGrade } | null;
}

export type SimOperation =
  | { type: 'addMaterial'; material: MaterialType; amount: number }
  | { type: 'scoop' }
  | { type: 'press'; force?: number }
  | { type: 'dry'; dryness: number }
  | { type: 'inspect' }
  | { type: 'finalize' }
  | { type: 'reset' };

export interface SimTraceEntry {
  op: SimOperation;
  applied: boolean;
  violations: SimViolation[];
  state: SimState;
}

export interface SimOutcome {
  trace: SimTraceEntry[];
  finalState: SimState;
}

export interface SimOptions {
  rng?: Rng;
}
