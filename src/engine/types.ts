import type { FractureType } from '../types.ts';

/** 关节角度数据来源 */
export type AngleSource = 'manual' | 'random' | 'import';

/** 一次关节角度调整记录（同一关节多次调整时全部保留，以最后一条为准） */
export interface AngleAdjustment {
  jointId: string;
  angle: number;
  source: AngleSource;
  /** 全局递增序号，标识调整先后顺序 */
  sequence: number;
}

/** 单个关节的复位评估结果 */
export interface JointAssessment {
  jointId: string;
  currentAngle: number;
  targetAngle: number;
  /** 有符号偏差：currentAngle - targetAngle */
  deviation: number;
  absDeviation: number;
  tolerance: number;
  withinTolerance: boolean;
}

/** 整体复位结论 */
export interface ReductionAssessment {
  joints: JointAssessment[];
  allWithinTolerance: boolean;
  maxAbsDeviation: number;
}

/** 复位阶段的关节状态（currentAngle 为最后一次调整的生效值） */
export interface JointState {
  id: string;
  name: string;
  currentAngle: number;
  targetAngle: number;
  tolerance: number;
}

/** 复位阶段完整状态：生效角度 + 全部调整记录 + 当前评估结论 */
export interface ReductionState {
  joints: JointState[];
  adjustments: AngleAdjustment[];
  assessment: ReductionAssessment;
}

/** 固定材料工艺规范（顺序与期望位置的唯一事实来源） */
export interface FixationMaterialSpec {
  id: string;
  name: string;
  order: number;
  correctPosition: string;
}

/** 固定材料放置拒绝原因 */
export type PlacementRejectionReason =
  | 'REDUCTION_NOT_ACHIEVED'
  | 'UNKNOWN_MATERIAL'
  | 'ALREADY_PLACED'
  | 'OUT_OF_ORDER'
  | 'WRONG_POSITION';

export interface PlacementRejection {
  reason: PlacementRejectionReason;
  message: string;
  /** OUT_OF_ORDER 时期望放置的材料 */
  expectedMaterialId?: string;
  expectedMaterialName?: string;
}

/** 一次放置尝试的结果（接受或带原因的拒绝） */
export interface PlacementResult {
  accepted: boolean;
  materialId: string;
  position: string;
  rejection?: PlacementRejection;
}

/** 已成功放置的材料记录 */
export interface PlacedMaterial {
  materialId: string;
  position: string;
  /** 实际放置顺序（从 1 开始） */
  sequence: number;
}

/** 固定阶段状态 */
export interface FixationState {
  reductionAchieved: boolean;
  placed: PlacedMaterial[];
  /** 全部放置尝试（含被拒绝的），用于离线追溯 */
  attempts: PlacementResult[];
}

/** 处理链路阶段 */
export type PipelinePhase =
  | 'DIAGNOSIS'
  | 'REDUCTION'
  | 'FIXATION'
  | 'REHABILITATION';

/** 批量入口支持的操作 */
export type PipelineOperation =
  | { type: 'setFracture'; fractureType: FractureType; randomizeAngles?: boolean }
  | { type: 'adjustAngle'; jointId: string; angle: number; source?: AngleSource }
  | { type: 'importAngles'; angles: Record<string, number> }
  | { type: 'randomizeAngles' }
  | { type: 'placeMaterial'; materialId: string; position: string };

/** 批量执行中单条操作的执行记录 */
export interface OperationRecord {
  index: number;
  operation: PipelineOperation;
  phase: PipelinePhase;
  reductionAchieved: boolean;
  placement?: PlacementResult;
}

/** 离线导出报告 */
export interface PipelineReport {
  fractureType: FractureType | null;
  tolerance: number;
  phase: PipelinePhase;
  reductionAchieved: boolean;
  joints: JointAssessment[];
  adjustments: AngleAdjustment[];
  placedMaterials: PlacedMaterial[];
  placementAttempts: PlacementResult[];
  rejections: Array<PlacementRejection & { materialId: string }>;
  operations: OperationRecord[];
  consistencyCheck: { consistent: boolean; mismatches: string[] };
}
