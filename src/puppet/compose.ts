/**
 * 角色合成（正向运动学，纯函数）：
 * 根据骨架定义与各关节角度，沿骨架树自根向叶计算每个部件的世界坐标与旋转。
 *
 * 约定：角度单位为度；y 轴向下（与 Canvas/SVG 一致），正角度为顺时针。
 * 部件姿态 = 父部件姿态 + 关节铰链变换：
 *   rotation_child = rotation_parent + jointAngle
 *   position_child = position_parent
 *     + rotate(rotation_parent, joint.parentPosition)
 *     - rotate(rotation_child,  joint.position)
 *
 * 合成不做隐式钳制：输入的关节角度必须已经通过 convergeAngle 收敛。
 * 若出现越界角度直接抛错，避免"合成结果悄悄替你修正输入"。
 */

import type {
  FigurePose,
  FigureRig,
  JointStateMap,
  PartPose,
  Vec2,
} from './types.ts';

const BOUND_TOLERANCE = 1e-9;

export function rotateDegrees(point: Vec2, degrees: number): Vec2 {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function assertWithinBounds(
  rig: FigureRig,
  states: JointStateMap,
): void {
  for (const joint of rig.joints) {
    const state = states[joint.id];
    if (!state) {
      throw new Error(`合成失败：关节 ${joint.id} 缺少状态输入`);
    }
    if (!Number.isFinite(state.angle)) {
      throw new RangeError(`合成失败：关节 ${joint.id} 的角度不是有限数`);
    }
    if (
      state.angle < joint.minAngle - BOUND_TOLERANCE ||
      state.angle > joint.maxAngle + BOUND_TOLERANCE
    ) {
      throw new RangeError(
        `合成失败：关节 ${joint.id} 角度 ${state.angle} 越界 ` +
          `[${joint.minAngle}, ${joint.maxAngle}]，应先经过关节收敛`,
      );
    }
  }
}

export function composeFigure(
  rig: FigureRig,
  states: JointStateMap,
  rootPosition: Vec2 = { x: 0, y: 0 },
): FigurePose {
  assertWithinBounds(rig, states);

  const poses: PartPose[] = [];
  const visit = (
    partId: string,
    parentPosition: Vec2,
    parentRotation: number,
  ): void => {
    const joint = rig.joints.find((item) => item.partId === partId);
    let position: Vec2;
    let rotation: number;
    if (partId === rig.rootPartId) {
      position = { ...rootPosition };
      rotation = 0;
    } else if (!joint || !joint.parentPosition) {
      throw new Error(`合成失败：非根部件 ${partId} 缺少与父部件的关节连接定义`);
    } else {
      const angle = states[joint.id].angle;
      rotation = parentRotation + angle;
      position = {
        x:
          parentPosition.x +
          rotateDegrees(joint.parentPosition, parentRotation).x -
          rotateDegrees(joint.position, rotation).x,
        y:
          parentPosition.y +
          rotateDegrees(joint.parentPosition, parentRotation).y -
          rotateDegrees(joint.position, rotation).y,
      };
    }
    poses.push({ partId, position, rotation });

    for (const childJoint of rig.joints.filter(
      (item) => item.parentPartId === partId,
    )) {
      visit(childJoint.partId, position, rotation);
    }
  };

  visit(rig.rootPartId, rootPosition, 0);
  return { rigId: rig.id, parts: poses };
}
