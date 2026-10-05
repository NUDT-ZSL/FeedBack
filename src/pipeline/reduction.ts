import { FractureType } from '../types';
import type {
  JointEvaluation,
  JointPlan,
  ReductionPlan,
  ReductionReport
} from './types';

export const REDUCTION_TOLERANCE_DEGREES = 5;

export const getFractureTargetAngles = (
  fractureType: FractureType
): Record<string, number> => {
  switch (fractureType) {
    case FractureType.RADIAL_DISTAL:
      return { upper_arm: 0, forearm: 15, palm: -10 };
    case FractureType.HUMERAL_SHAFT:
      return { upper_arm: -20, forearm: 5, palm: 0 };
    case FractureType.OLECRANON:
      return { upper_arm: 10, forearm: -15, palm: 5 };
    default:
      return { upper_arm: 0, forearm: 0, palm: 0 };
  }
};

export const deriveReductionPlan = (
  fractureType: FractureType,
  jointIds: string[],
  tolerance: number = REDUCTION_TOLERANCE_DEGREES
): ReductionPlan => {
  const targetAngles = getFractureTargetAngles(fractureType);
  return {
    fractureType,
    joints: jointIds.map(jointId => ({
      jointId,
      targetAngle: targetAngles[jointId] ?? 0,
      tolerance
    }))
  };
};

export const evaluateJoint = (
  currentAngle: number,
  plan: JointPlan
): JointEvaluation => {
  const deviation = currentAngle - plan.targetAngle;
  const absDeviation = Math.abs(deviation);
  return {
    jointId: plan.jointId,
    currentAngle,
    targetAngle: plan.targetAngle,
    tolerance: plan.tolerance,
    deviation,
    absDeviation,
    withinTolerance: absDeviation <= plan.tolerance
  };
};

export const summarizeReduction = (
  fractureType: FractureType,
  joints: JointEvaluation[]
): ReductionReport => ({
  fractureType,
  joints,
  allWithinTolerance: joints.every(joint => joint.withinTolerance),
  maxAbsDeviation: joints.reduce(
    (max, joint) => Math.max(max, joint.absDeviation),
    0
  )
});

export const evaluateReduction = (
  currentAngles: Record<string, number>,
  plan: ReductionPlan
): ReductionReport => {
  const joints = plan.joints.map(jointPlan =>
    evaluateJoint(currentAngles[jointPlan.jointId] ?? 0, jointPlan)
  );
  return summarizeReduction(plan.fractureType, joints);
};

export const reevaluateJoint = (
  report: ReductionReport,
  plan: ReductionPlan,
  jointId: string,
  newAngle: number
): ReductionReport => {
  const jointPlan = plan.joints.find(entry => entry.jointId === jointId);
  if (!jointPlan) return report;

  const joints = report.joints.map(evaluation =>
    evaluation.jointId === jointId
      ? evaluateJoint(newAngle, jointPlan)
      : evaluation
  );
  return summarizeReduction(report.fractureType, joints);
};
