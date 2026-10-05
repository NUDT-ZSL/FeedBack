import { FractureType } from '../types.ts';
import type { FixationMaterialSpec } from './types.ts';

/** 复位允许偏差（度） */
export const REDUCTION_TOLERANCE_DEGREES = 5;

export interface FractureProtocol {
  fractureType: FractureType;
  /** 各关节目标角度 */
  targetAngles: Record<string, number>;
  /** 允许偏差（度） */
  tolerance: number;
}

const FRACTURE_TARGET_ANGLES: Record<FractureType, Record<string, number>> = {
  [FractureType.RADIAL_DISTAL]: { upper_arm: 0, forearm: 15, palm: -10 },
  [FractureType.HUMERAL_SHAFT]: { upper_arm: -20, forearm: 5, palm: 0 },
  [FractureType.OLECRANON]: { upper_arm: 10, forearm: -15, palm: 5 }
};

/** 由骨折类型推导各关节目标角度与允许偏差 */
export function getFractureProtocol(fractureType: FractureType): FractureProtocol {
  return {
    fractureType,
    targetAngles: { ...(FRACTURE_TARGET_ANGLES[fractureType] ?? {}) },
    tolerance: REDUCTION_TOLERANCE_DEGREES
  };
}

/** 固定材料工艺规范：顺序与期望位置的唯一事实来源 */
export const FIXATION_PROTOCOL: FixationMaterialSpec[] = [
  { id: 'cotton_pad', name: '棉垫', order: 1, correctPosition: 'fracture_site' },
  { id: 'willow_splint', name: '柳木夹板', order: 2, correctPosition: 'outer_side' },
  { id: 'bamboo_splint', name: '竹制夹板', order: 3, correctPosition: 'inner_side' },
  { id: 'gauze', name: '纱布绷带', order: 4, correctPosition: 'wrap' }
];

/** 生成一个偏离目标角度的初始角度（随机初始化用），rng 可注入以便离线复现 */
export function generateMisalignedAngle(targetAngle: number, rng: () => number = Math.random): number {
  const offset = (rng() - 0.5) * 40;
  return targetAngle + offset;
}
