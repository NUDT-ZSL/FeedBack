import type {
  AngleAdjustment,
  AngleSource,
  JointAssessment,
  JointState,
  ReductionAssessment,
  ReductionState
} from './types.ts';

/** 计算单个关节的偏差评估 */
export function assessJoint(joint: JointState): JointAssessment {
  const deviation = joint.currentAngle - joint.targetAngle;
  const absDeviation = Math.abs(deviation);
  return {
    jointId: joint.id,
    currentAngle: joint.currentAngle,
    targetAngle: joint.targetAngle,
    deviation,
    absDeviation,
    tolerance: joint.tolerance,
    withinTolerance: absDeviation <= joint.tolerance
  };
}

function summarize(joints: JointAssessment[]): ReductionAssessment {
  return {
    joints,
    allWithinTolerance: joints.every(j => j.withinTolerance),
    maxAbsDeviation: joints.reduce((max, j) => Math.max(max, j.absDeviation), 0)
  };
}

/** 全量重算：对所有关节重新评估并汇总整体复位结论 */
export function assessReduction(joints: JointState[]): ReductionAssessment {
  return summarize(joints.map(assessJoint));
}

/** 创建复位阶段初始状态 */
export function createReductionState(
  joints: Array<{ id: string; name: string }>,
  targetAngles: Record<string, number>,
  tolerance: number
): ReductionState {
  const jointStates: JointState[] = joints.map(j => ({
    id: j.id,
    name: j.name,
    currentAngle: 0,
    targetAngle: targetAngles[j.id] ?? 0,
    tolerance
  }));
  return {
    joints: jointStates,
    adjustments: [],
    assessment: assessReduction(jointStates)
  };
}

/**
 * 增量重算：应用一次角度调整，只重算受影响关节的评估项，
 * 并基于其余关节的既有评估重新汇总整体结论。
 * 同一关节多次调整时以最后一次为准，历史记录全部保留。
 */
export function applyAngleAdjustment(
  state: ReductionState,
  jointId: string,
  angle: number,
  source: AngleSource
): ReductionState {
  const jointIndex = state.joints.findIndex(j => j.id === jointId);
  if (jointIndex === -1) return state;

  const joints = state.joints.map((joint, i) =>
    i === jointIndex ? { ...joint, currentAngle: angle } : joint
  );

  const reassessed = assessJoint(joints[jointIndex]);
  const assessments = state.assessment.joints.map(a =>
    a.jointId === jointId ? reassessed : a
  );

  const adjustment: AngleAdjustment = {
    jointId,
    angle,
    source,
    sequence: state.adjustments.length + 1
  };

  return {
    joints,
    adjustments: [...state.adjustments, adjustment],
    assessment: summarize(assessments)
  };
}

/** 批量导入角度：每个关节记为一条 source='import' 的调整 */
export function importAngles(
  state: ReductionState,
  angles: Record<string, number>
): ReductionState {
  let next = state;
  for (const [jointId, angle] of Object.entries(angles)) {
    next = applyAngleAdjustment(next, jointId, angle, 'import');
  }
  return next;
}

/**
 * 一致性校验：以当前生效角度做全量重算，
 * 与增量维护的评估结论逐项对比，返回不一致项。
 */
export function verifyConsistency(state: ReductionState): {
  consistent: boolean;
  mismatches: string[];
} {
  const full = assessReduction(state.joints);
  const mismatches: string[] = [];

  for (const joint of full.joints) {
    const incremental = state.assessment.joints.find(a => a.jointId === joint.jointId);
    if (!incremental) {
      mismatches.push(`${joint.jointId}: 增量结果缺失`);
      continue;
    }
    if (
      incremental.deviation !== joint.deviation ||
      incremental.withinTolerance !== joint.withinTolerance ||
      incremental.tolerance !== joint.tolerance
    ) {
      mismatches.push(
        `${joint.jointId}: 增量(dev=${incremental.deviation}, ok=${incremental.withinTolerance}) != 全量(dev=${joint.deviation}, ok=${joint.withinTolerance})`
      );
    }
  }

  if (full.allWithinTolerance !== state.assessment.allWithinTolerance) {
    mismatches.push(
      `整体结论不一致: 增量=${state.assessment.allWithinTolerance}, 全量=${full.allWithinTolerance}`
    );
  }
  if (full.maxAbsDeviation !== state.assessment.maxAbsDeviation) {
    mismatches.push(
      `最大偏差不一致: 增量=${state.assessment.maxAbsDeviation}, 全量=${full.maxAbsDeviation}`
    );
  }

  return { consistent: mismatches.length === 0, mismatches };
}
