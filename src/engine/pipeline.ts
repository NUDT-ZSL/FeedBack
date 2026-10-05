import type { FractureType } from '../types.ts';
import {
  FIXATION_PROTOCOL,
  generateMisalignedAngle,
  getFractureProtocol
} from './protocol.ts';
import {
  applyAngleAdjustment,
  assessReduction,
  createReductionState,
  importAngles,
  verifyConsistency
} from './reduction.ts';
import { createFixationState, isFixationComplete, placeMaterial } from './fixation.ts';
import type {
  AngleSource,
  FixationMaterialSpec,
  OperationRecord,
  PipelineOperation,
  PipelinePhase,
  PipelineReport,
  ReductionState
} from './types.ts';

export interface PipelineConfig {
  joints: Array<{ id: string; name: string }>;
  materials?: FixationMaterialSpec[];
  /** 可注入随机源，离线推演可复现 */
  rng?: () => number;
}

/**
 * 可离线推演的处理链路：骨折类型 -> 目标角度/允许偏差 -> 复位评估
 * -> 固定顺序校验。所有状态转移均为纯函数式演进，全程保留追溯记录。
 */
export class TreatmentPipeline {
  private readonly joints: Array<{ id: string; name: string }>;
  private readonly materials: FixationMaterialSpec[];
  private readonly rng: () => number;

  fractureType: FractureType | null = null;
  tolerance = 0;
  phase: PipelinePhase = 'DIAGNOSIS';
  reduction: ReductionState | null = null;
  fixation = createFixationState(false);

  constructor(config: PipelineConfig) {
    this.joints = config.joints;
    this.materials = config.materials ?? FIXATION_PROTOCOL;
    this.rng = config.rng ?? Math.random;
  }

  /** 由骨折类型推导各关节目标角度与允许偏差，重置复位/固定状态 */
  setFracture(fractureType: FractureType, randomizeAngles = false): void {
    const protocol = getFractureProtocol(fractureType);
    let reduction = createReductionState(this.joints, protocol.targetAngles, protocol.tolerance);

    if (randomizeAngles) {
      for (const joint of reduction.joints) {
        const randomAngle = generateMisalignedAngle(joint.targetAngle, this.rng);
        reduction = applyAngleAdjustment(reduction, joint.id, randomAngle, 'random');
      }
    }

    this.fractureType = fractureType;
    this.tolerance = protocol.tolerance;
    this.reduction = reduction;
    this.fixation = createFixationState(reduction.assessment.allWithinTolerance);
    this.phase = reduction.assessment.allWithinTolerance ? 'FIXATION' : 'REDUCTION';
  }

  private assertReduction(): ReductionState {
    if (!this.reduction) throw new Error('尚未确定骨折类型，无法处理关节角度');
    return this.reduction;
  }

  /** 记录一次关节角度调整（手动 / 随机），仅增量重算受影响关节与整体结论 */
  adjustAngle(jointId: string, angle: number, source: AngleSource = 'manual'): void {
    this.reduction = applyAngleAdjustment(this.assertReduction(), jointId, angle, source);
    this.syncPhase();
  }

  /** 批量导入关节角度（来源标记为 import） */
  importAngles(angles: Record<string, number>): void {
    this.reduction = importAngles(this.assertReduction(), angles);
    this.syncPhase();
  }

  /** 随机初始化所有关节角度（来源标记为 random） */
  randomizeAngles(): void {
    const reduction = this.assertReduction();
    let next = reduction;
    for (const joint of reduction.joints) {
      next = applyAngleAdjustment(
        next,
        joint.id,
        generateMisalignedAngle(joint.targetAngle, this.rng),
        'random'
      );
    }
    this.reduction = next;
    this.syncPhase();
  }

  get reductionAchieved(): boolean {
    return this.reduction?.assessment.allWithinTolerance ?? false;
  }

  private syncPhase(): void {
    if (!this.reduction) return;
    const achieved = this.reduction.assessment.allWithinTolerance;
    this.fixation = { ...this.fixation, reductionAchieved: achieved };
    if (!achieved) {
      this.phase = 'REDUCTION';
    } else if (isFixationComplete(this.fixation, this.materials)) {
      this.phase = 'REHABILITATION';
    } else {
      this.phase = 'FIXATION';
    }
  }

  /** 按既定顺序放置固定材料；顺序/位置/阶段不对均返回带原因的拒绝结果 */
  placeMaterial(materialId: string, position: string) {
    if (!this.reduction) {
      throw new Error('尚未确定骨折类型，无法进入固定阶段');
    }
    const outcome = placeMaterial(this.fixation, this.materials, materialId, position);
    this.fixation = outcome.state;
    if (outcome.result.accepted && isFixationComplete(this.fixation, this.materials)) {
      this.phase = 'REHABILITATION';
    }
    return outcome.result;
  }

  /** 全量重算（与增量重算结果一致性比对用） */
  fullReassessment() {
    return assessReduction(this.assertReduction().joints);
  }

  /** 统一批量入口：按顺序执行一组构造好的操作 */
  runBatch(operations: PipelineOperation[]): OperationRecord[] {
    const records: OperationRecord[] = [];
    operations.forEach((operation, index) => {
      let placement;
      switch (operation.type) {
        case 'setFracture':
          this.setFracture(operation.fractureType, operation.randomizeAngles);
          break;
        case 'adjustAngle':
          this.adjustAngle(operation.jointId, operation.angle, operation.source);
          break;
        case 'importAngles':
          this.importAngles(operation.angles);
          break;
        case 'randomizeAngles':
          this.randomizeAngles();
          break;
        case 'placeMaterial':
          placement = this.placeMaterial(operation.materialId, operation.position);
          break;
      }
      records.push({
        index,
        operation,
        phase: this.phase,
        reductionAchieved: this.reductionAchieved,
        placement
      });
    });
    return records;
  }

  /** 导出离线核对报告：各关节偏差、复位结论、放置顺序与拒绝原因 */
  exportReport(): PipelineReport {
    const reduction = this.assertReduction();
    const consistencyCheck = verifyConsistency(reduction);
    return {
      fractureType: this.fractureType,
      tolerance: this.tolerance,
      phase: this.phase,
      reductionAchieved: reduction.assessment.allWithinTolerance,
      joints: reduction.assessment.joints,
      adjustments: reduction.adjustments,
      placedMaterials: this.fixation.placed,
      placementAttempts: this.fixation.attempts,
      rejections: this.fixation.attempts
        .filter(a => !a.accepted)
        .map(a => ({ materialId: a.materialId, ...a.rejection! })),
      operations: [],
      consistencyCheck
    };
  }

  /** 批量执行并导出含操作记录的完整报告 */
  runBatchWithReport(operations: PipelineOperation[]): PipelineReport {
    const operationRecords = this.runBatch(operations);
    return { ...this.exportReport(), operations: operationRecords };
  }
}
