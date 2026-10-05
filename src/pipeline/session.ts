import type { FractureType } from '../types';
import {
  deriveReductionPlan,
  evaluateReduction,
  reevaluateJoint
} from './reduction';
import {
  attemptPlacement,
  createFixationState,
  expectedNextMaterial,
  getFixationStatuses,
  isFixationComplete
} from './fixation';
import type {
  AngleSource,
  FixationAttempt,
  FixationMaterialSpec,
  FixationState,
  FixationStatus,
  JointAdjustment,
  ReductionPlan,
  ReductionReport
} from './types';

export interface SessionReport {
  fractureType: FractureType | null;
  adjustments: JointAdjustment[];
  effectiveAngles: Record<string, number>;
  reduction: ReductionReport | null;
  fixation: {
    complete: boolean;
    placedOrder: string[];
    expectedNextMaterialId: string | null;
    statuses: FixationStatus[];
    attempts: FixationAttempt[];
  };
}

export interface SetFractureOptions {
  initialAngles?: Record<string, number>;
  initialAngleSource?: AngleSource;
  rng?: () => number;
}

const MISALIGNMENT_RANGE_DEGREES = 40;

export class TreatmentSession {
  private readonly jointIds: string[];
  private currentAngles: Record<string, number>;
  private plan: ReductionPlan | null = null;
  private report: ReductionReport | null = null;
  private adjustments: JointAdjustment[] = [];
  private adjustmentSequence = 0;
  private fixation: FixationState;

  constructor(jointIds: string[], materials: FixationMaterialSpec[]) {
    this.jointIds = [...jointIds];
    this.currentAngles = Object.fromEntries(jointIds.map(id => [id, 0]));
    this.fixation = createFixationState(materials);
  }

  setFracture(fractureType: FractureType, options: SetFractureOptions = {}): void {
    this.plan = deriveReductionPlan(fractureType, this.jointIds);
    const rng = options.rng ?? Math.random;
    const source = options.initialAngleSource ?? 'random';

    for (const jointPlan of this.plan.joints) {
      const angle =
        options.initialAngles?.[jointPlan.jointId] ??
        jointPlan.targetAngle + (rng() - 0.5) * MISALIGNMENT_RANGE_DEGREES;
      this.recordAdjustment(jointPlan.jointId, angle, source);
    }

    this.report = evaluateReduction(this.currentAngles, this.plan);
  }

  adjustAngle(jointId: string, angle: number, source: AngleSource = 'manual'): void {
    if (!this.plan || !this.report) {
      throw new Error('尚未设定骨折类型，无法调整关节角度');
    }
    if (!this.jointIds.includes(jointId)) {
      throw new Error(`未知关节：${jointId}`);
    }

    this.recordAdjustment(jointId, angle, source);
    this.report = reevaluateJoint(this.report, this.plan, jointId, angle);
  }

  getReductionReport(): ReductionReport | null {
    return this.report;
  }

  reductionPassed(): boolean {
    return this.report?.allWithinTolerance ?? false;
  }

  attemptFixation(materialId: string, position: string): FixationAttempt {
    const { state, attempt } = attemptPlacement(
      this.fixation,
      materialId,
      position,
      this.reductionPassed()
    );
    this.fixation = state;
    return attempt;
  }

  fullRecompute(): ReductionReport | null {
    if (!this.plan) return null;
    return evaluateReduction(this.currentAngles, this.plan);
  }

  effectiveAnglesFromLog(): Record<string, number> {
    const effective: Record<string, number> = {};
    for (const adjustment of this.adjustments) {
      effective[adjustment.jointId] = adjustment.angle;
    }
    return effective;
  }

  exportReport(): SessionReport {
    return {
      fractureType: this.plan?.fractureType ?? null,
      adjustments: this.adjustments.map(entry => ({ ...entry })),
      effectiveAngles: { ...this.currentAngles },
      reduction: this.report
        ? {
            ...this.report,
            joints: this.report.joints.map(joint => ({ ...joint }))
          }
        : null,
      fixation: {
        complete: isFixationComplete(this.fixation),
        placedOrder: [...this.fixation.placedOrder],
        expectedNextMaterialId: expectedNextMaterial(this.fixation)?.id ?? null,
        statuses: getFixationStatuses(this.fixation),
        attempts: this.fixation.attempts.map(attempt => ({ ...attempt }))
      }
    };
  }

  private recordAdjustment(
    jointId: string,
    angle: number,
    source: AngleSource
  ): void {
    this.adjustmentSequence += 1;
    this.adjustments.push({
      sequence: this.adjustmentSequence,
      jointId,
      angle,
      source
    });
    this.currentAngles[jointId] = angle;
  }
}
