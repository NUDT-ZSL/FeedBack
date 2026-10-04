/**
 * 关节角度操控与铰链物理（纯函数，可在 Node 下离线执行）。
 *
 * 角度收敛规则（边界与越界输入）：
 * 1. 有限输入：任何超出 [minAngle, maxAngle] 的角度一律收敛（钳制）到最近的边界。
 * 2. NaN 输入：关节没有可执行的目标角度，保持当前角度不变，不引入随机/环境依赖。
 * 3. +Infinity / -Infinity：分别收敛到 maxAngle / minAngle。
 *
 * 铰链积分沿用技术架构 6.2 节的公式：
 *   acceleration = force - damping * angularVelocity
 *   angularVelocity += acceleration * deltaTime
 *   angularVelocity *= 0.95 ^ (deltaTime * 60)
 * 积分后角度若越过边界，则收敛到边界并把速度清零，保证停在边界时不会抖动回弹。
 */

import type { Joint, JointState } from './types.ts';

export const DEFAULT_DAMPING = 0.3;

const FRAME_DRAG_BASE = 0.95;

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 把角度归一化到 (-180, 180]。非有限值按 0 处理，使结果始终确定。 */
export function normalizeAngle(angle: number): number {
  const finite = isFiniteNumber(angle) ? angle : 0;
  let normalized = finite % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return normalized;
}

/** 依据关节合法范围把输入角度收敛为可执行角度。 */
export function convergeAngle(
  joint: Joint,
  target: number,
  current: number = 0,
): number {
  if (Number.isNaN(target)) {
    return isFiniteNumber(current) ? clampToJoint(joint, current) : midpoint(joint);
  }
  if (!isFiniteNumber(target)) {
    return target > 0 ? joint.maxAngle : joint.minAngle;
  }
  return clampToJoint(joint, target);
}

function clampToJoint(joint: Joint, value: number): number {
  return Math.min(joint.maxAngle, Math.max(joint.minAngle, value));
}

function midpoint(joint: Joint): number {
  return (joint.minAngle + joint.maxAngle) / 2;
}

/**
 * 对单个关节施加一帧力矩，返回新的关节状态（不修改入参）。
 * deltaTime 单位为秒，force 为角加速度量纲的外力。
 */
export function stepHinge(
  joint: Joint,
  state: JointState,
  targetForce: number,
  deltaTime: number,
): JointState {
  if (!(deltaTime > 0)) {
    throw new RangeError(`deltaTime 必须为正数，实际为 ${String(deltaTime)}`);
  }
  const force = isFiniteNumber(targetForce) ? targetForce : 0;

  let angularVelocity =
    state.angularVelocity +
    (force - joint.damping * state.angularVelocity) * deltaTime;
  angularVelocity *= FRAME_DRAG_BASE ** (deltaTime * 60);

  let angle = state.angle + angularVelocity * deltaTime;
  if (angle < joint.minAngle) {
    angle = joint.minAngle;
    angularVelocity = 0;
  } else if (angle > joint.maxAngle) {
    angle = joint.maxAngle;
    angularVelocity = 0;
  }
  return { angle, angularVelocity };
}

/**
 * 从初始状态开始对恒定外力做积分，直到角速度变化小于 tol（收敛）或达到最大步数。
 * 返回每一步的状态序列，便于断言收敛轨迹。
 */
export function simulateHinge(
  joint: Joint,
  initial: JointState,
  force: number,
  deltaTime: number,
  tolerance: number = 1e-6,
  maxSteps: number = 10000,
): JointState[] {
  const trace: JointState[] = [{ ...initial }];
  let state = initial;
  for (let step = 0; step < maxSteps; step += 1) {
    const next = stepHinge(joint, state, force, deltaTime);
    trace.push(next);
    if (Math.abs(next.angularVelocity - state.angularVelocity) < tolerance) {
      return trace;
    }
    state = next;
  }
  return trace;
}

/** 无外力时铰链是否已稳定（角度不再变化的浮点阈值）。 */
export function isHingeSettled(
  previous: JointState,
  current: JointState,
  deltaTime: number,
  tolerance: number = 1e-9,
): boolean {
  return Math.abs(current.angle - previous.angle) <= tolerance * Math.max(1, deltaTime * 60);
}
