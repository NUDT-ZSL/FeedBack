/**
 * 离线固定夹具：所有样例均为本地确定性数据，不读取网络、localStorage 或任何外部账号。
 */

import {
  createRestStates,
  createStandardLinkages,
  createStandardRig,
} from '../../src/puppet/index.ts';
import type { FigureRig, JointStateMap } from '../../src/puppet/index.ts';

export interface SampleInput {
  jointId: string;
  value: number;
  label: string;
}

export function standardFixture() {
  const rig: FigureRig = createStandardRig();
  const restStates: JointStateMap = createRestStates(rig);
  const linkages = createStandardLinkages();
  return { rig, restStates, linkages };
}

/** 每个关节的边界、越界与非有限输入样例。 */
export function boundaryAndOutOfRangeInputs(rig: FigureRig): SampleInput[] {
  const samples: SampleInput[] = [];
  for (const joint of rig.joints) {
    samples.push(
      { jointId: joint.id, value: joint.minAngle, label: '下界精确值' },
      { jointId: joint.id, value: joint.maxAngle, label: '上界精确值' },
      { jointId: joint.id, value: joint.minAngle - 1000, label: '大幅低于下界' },
      { jointId: joint.id, value: joint.maxAngle + 1000, label: '大幅高于上界' },
      { jointId: joint.id, value: -Infinity, label: '负无穷' },
      { jointId: joint.id, value: Infinity, label: '正无穷' },
      { jointId: joint.id, value: Number.NaN, label: 'NaN' },
    );
  }
  return samples;
}

/** 确定性伪随机序列（LCG），用于批量覆盖"任意输入"而不引入 Math.random 的不确定性。 */
export function deterministicSequence(
  seed: number,
  length: number,
  scale: number = 360,
): number[] {
  let state = seed >>> 0;
  const values: number[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values.push((state / 0xffffffff - 0.5) * 2 * scale);
  }
  return values;
}

/** 黄金姿态的操控输入（含越界值，用于验证"收敛→联动→合成"整条链路）。 */
export const GOLDEN_DRIVER_INPUTS = {
  neck: 10,
  shoulderLeft: 500, // 越界 → 收敛 170
  hipLeft: -200, // 越界 → 收敛 -90
};

/** 手工核算的黄金姿态期望（根位置 400,300；角度单位：度）。 */
export const GOLDEN_EXPECTED_ROTATIONS = {
  body: 0,
  head: 10,
  armLeft: 170,
  armRight: -170, // mirror(-170)
  legLeft: -90,
  legRight: -45, // ratio 0.5 * (-90)
};
