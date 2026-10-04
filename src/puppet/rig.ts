/**
 * 标准皮影影人骨架（6 部件：头、身、双臂、双腿）与联动约束的固定定义。
 * 作为游戏运行时与离线验证共用的同一份数据，避免两边定义漂移。
 */

import type { FigureRig, JointStateMap } from './types.ts';
import type { LinkageConstraint } from './linkage.ts';
import { DEFAULT_DAMPING } from './joints.ts';

export function createStandardRig(): FigureRig {
  return {
    id: 'standard-figure',
    name: '标准影人',
    rootPartId: 'body',
    parts: [
      { id: 'head', type: 'head', color: '#c0392b', leatherType: 'cow', jointIds: ['neck'] },
      { id: 'body', type: 'body', color: '#2c3e50', leatherType: 'cow', jointIds: [] },
      { id: 'armLeft', type: 'armLeft', color: '#2980b9', leatherType: 'cow', jointIds: ['shoulderLeft'] },
      { id: 'armRight', type: 'armRight', color: '#2980b9', leatherType: 'cow', jointIds: ['shoulderRight'] },
      { id: 'legLeft', type: 'legLeft', color: '#27ae60', leatherType: 'cow', jointIds: ['hipLeft'] },
      { id: 'legRight', type: 'legRight', color: '#27ae60', leatherType: 'cow', jointIds: ['hipRight'] },
    ],
    joints: [
      {
        id: 'neck', partId: 'head', parentPartId: 'body',
        position: { x: 0, y: 30 }, parentPosition: { x: 0, y: -40 },
        minAngle: -45, maxAngle: 45, damping: DEFAULT_DAMPING,
      },
      {
        id: 'shoulderLeft', partId: 'armLeft', parentPartId: 'body',
        position: { x: 0, y: 0 }, parentPosition: { x: -18, y: -30 },
        minAngle: -170, maxAngle: 170, damping: DEFAULT_DAMPING,
      },
      {
        id: 'shoulderRight', partId: 'armRight', parentPartId: 'body',
        position: { x: 0, y: 0 }, parentPosition: { x: 18, y: -30 },
        minAngle: -170, maxAngle: 170, damping: DEFAULT_DAMPING,
      },
      {
        id: 'hipLeft', partId: 'legLeft', parentPartId: 'body',
        position: { x: 0, y: 0 }, parentPosition: { x: -10, y: 40 },
        minAngle: -90, maxAngle: 90, damping: DEFAULT_DAMPING,
      },
      {
        id: 'hipRight', partId: 'legRight', parentPartId: 'body',
        position: { x: 0, y: 0 }, parentPosition: { x: 10, y: 40 },
        minAngle: -90, maxAngle: 90, damping: DEFAULT_DAMPING,
      },
    ],
  };
}

/** 全部关节的静止（零角度）初始状态。 */
export function createRestStates(rig: FigureRig): JointStateMap {
  const states: JointStateMap = {};
  for (const joint of rig.joints) {
    states[joint.id] = { angle: 0, angularVelocity: 0 };
  }
  return states;
}

/**
 * 标准联动约束：表演时右臂镜像左臂（mirror），右腿跟随左腿（ratio 0.5）。
 * 从动角度同样受各自关节边界收敛。
 */
export function createStandardLinkages(): LinkageConstraint[] {
  return [
    {
      id: 'arms-mirror',
      kind: 'mirror',
      driverJointId: 'shoulderLeft',
      followerJointId: 'shoulderRight',
    },
    {
      id: 'legs-follow',
      kind: 'ratio',
      driverJointId: 'hipLeft',
      followerJointId: 'hipRight',
      ratio: 0.5,
    },
  ];
}
