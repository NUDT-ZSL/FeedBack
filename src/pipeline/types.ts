import type { FractureType } from '../types';

export type AngleSource = 'manual' | 'random' | 'batch';

export interface JointAdjustment {
  sequence: number;
  jointId: string;
  angle: number;
  source: AngleSource;
}

export interface JointPlan {
  jointId: string;
  targetAngle: number;
  tolerance: number;
}

export interface ReductionPlan {
  fractureType: FractureType;
  joints: JointPlan[];
}

export interface JointEvaluation {
  jointId: string;
  currentAngle: number;
  targetAngle: number;
  tolerance: number;
  deviation: number;
  absDeviation: number;
  withinTolerance: boolean;
}

export interface ReductionReport {
  fractureType: FractureType;
  joints: JointEvaluation[];
  allWithinTolerance: boolean;
  maxAbsDeviation: number;
}

export enum FixationRejection {
  REDUCTION_NOT_PASSED = 'REDUCTION_NOT_PASSED',
  UNKNOWN_MATERIAL = 'UNKNOWN_MATERIAL',
  ALREADY_PLACED = 'ALREADY_PLACED',
  ORDER_VIOLATION = 'ORDER_VIOLATION',
  WRONG_POSITION = 'WRONG_POSITION'
}

export interface FixationAttempt {
  materialId: string;
  position: string;
  accepted: boolean;
  rejection: FixationRejection | null;
  reason: string;
  expectedNextMaterialId: string | null;
}

export interface FixationMaterialSpec {
  id: string;
  name: string;
  type: string;
  order: number;
  correctPosition: string;
}

export interface FixationStatus {
  materialId: string;
  order: number;
  placed: boolean;
  position: string;
}

export interface FixationState {
  specs: FixationMaterialSpec[];
  placedOrder: string[];
  positions: Record<string, string>;
  attempts: FixationAttempt[];
}
