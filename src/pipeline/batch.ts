import type { FractureType } from '../types';
import { TreatmentSession } from './session';
import type { SessionReport } from './session';
import type {
  AngleSource,
  FixationAttempt,
  FixationMaterialSpec,
  ReductionReport
} from './types';

export type BatchOperation =
  | {
      type: 'set_fracture';
      fractureType: FractureType;
      initialAngles?: Record<string, number>;
      initialAngleSource?: AngleSource;
    }
  | {
      type: 'adjust_angle';
      jointId: string;
      angle: number;
      source?: AngleSource;
    }
  | {
      type: 'place_material';
      materialId: string;
      position: string;
    };

export interface BatchScenario {
  name: string;
  jointIds: string[];
  materials: FixationMaterialSpec[];
  operations: BatchOperation[];
}

export interface BatchStepTrace {
  index: number;
  operation: BatchOperation;
  reduction: ReductionReport | null;
  fixationAttempt: FixationAttempt | null;
}

export interface ConsistencyCheck {
  incrementalMatchesFull: boolean;
  effectiveAnglesMatchLog: boolean;
}

export interface BatchResult {
  name: string;
  steps: BatchStepTrace[];
  consistency: ConsistencyCheck;
  finalReport: SessionReport;
}

const sameReduction = (
  a: ReductionReport | null,
  b: ReductionReport | null
): boolean => JSON.stringify(a) === JSON.stringify(b);

const sameAngles = (
  a: Record<string, number>,
  b: Record<string, number>
): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export const runBatchScenario = (scenario: BatchScenario): BatchResult => {
  const session = new TreatmentSession(scenario.jointIds, scenario.materials);
  const steps: BatchStepTrace[] = [];

  scenario.operations.forEach((operation, index) => {
    let fixationAttempt: FixationAttempt | null = null;

    switch (operation.type) {
      case 'set_fracture':
        session.setFracture(operation.fractureType, {
          initialAngles: operation.initialAngles,
          initialAngleSource: operation.initialAngleSource ?? 'batch'
        });
        break;
      case 'adjust_angle':
        session.adjustAngle(
          operation.jointId,
          operation.angle,
          operation.source ?? 'batch'
        );
        break;
      case 'place_material':
        fixationAttempt = session.attemptFixation(
          operation.materialId,
          operation.position
        );
        break;
    }

    steps.push({
      index,
      operation,
      reduction: session.getReductionReport(),
      fixationAttempt
    });
  });

  const incremental = session.getReductionReport();
  const full = session.fullRecompute();
  const exported = session.exportReport();

  return {
    name: scenario.name,
    steps,
    consistency: {
      incrementalMatchesFull: sameReduction(incremental, full),
      effectiveAnglesMatchLog: sameAngles(
        exported.effectiveAngles,
        session.effectiveAnglesFromLog()
      )
    },
    finalReport: exported
  };
};
