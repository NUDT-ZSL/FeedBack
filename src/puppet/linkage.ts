/**
 * 多关节联动：一组关节在同一操控输入下保持可验证的确定关系。
 *
 * 联动类型：
 * - mirror：从动关节角度 = -驱动关节角度（镜像联动，如双臂对称）。
 * - ratio ：从动关节角度 = ratio * 驱动关节角度（联动缩放，如肩带肘）。
 *
 * 从动角度同样要经过关节自身的边界收敛；因此当联动目标超出从动关节范围时，
 * 从动关节停在其边界上，这属于一致状态，而不是偷偷放宽约束。
 *
 * 约束图必须是合法 DAG：
 * - 一个关节不能同时被两条约束驱动（多重驱动无法确定唯一结果）；
 * - 不允许环（否则没有确定的求值顺序）；
 * 违反以上规则直接抛错，避免隐式覆盖导致"看起来对、其实不确定"。
 */

import type { FigureRig, Joint, JointState, JointStateMap } from './types.ts';
import { convergeAngle } from './joints.ts';

export type LinkageKind = 'mirror' | 'ratio';

export interface LinkageConstraint {
  id: string;
  kind: LinkageKind;
  driverJointId: string;
  followerJointId: string;
  /** kind === 'ratio' 时使用，mirror 固定为 -1。 */
  ratio?: number;
}

export interface LinkageViolation {
  constraintId: string;
  driverJointId: string;
  followerJointId: string;
  expected: number;
  actual: number;
  delta: number;
}

export function jointById(rig: FigureRig, jointId: string): Joint {
  const joint = rig.joints.find((item) => item.id === jointId);
  if (!joint) {
    throw new RangeError(`关节 ${jointId} 不存在于骨架 ${rig.id}`);
  }
  return joint;
}

export function linkageRatio(constraint: LinkageConstraint): number {
  return constraint.kind === 'mirror' ? -1 : (constraint.ratio ?? 1);
}

/** 校验约束图，返回拓扑求值顺序（驱动在从动之前）。 */
export function validateLinkages(
  rig: FigureRig,
  constraints: LinkageConstraint[],
): LinkageConstraint[] {
  const incoming = new Map<string, string>();
  const edges: Array<[string, string]> = [];

  for (const constraint of constraints) {
    const driver = jointById(rig, constraint.driverJointId);
    const follower = jointById(rig, constraint.followerJointId);
    if (driver.id === follower.id) {
      throw new Error(`联动约束 ${constraint.id} 的驱动与从动不能是同一关节`);
    }
    if (constraint.kind === 'ratio') {
      const ratio = constraint.ratio ?? 1;
      if (!Number.isFinite(ratio)) {
        throw new RangeError(`联动约束 ${constraint.id} 的 ratio 必须是有限数`);
      }
    }
    const existing = incoming.get(follower.id);
    if (existing) {
      throw new Error(
        `关节 ${follower.id} 同时被约束 ${existing} 与 ${constraint.id} 驱动，联动结果不唯一`,
      );
    }
    incoming.set(follower.id, constraint.id);
    edges.push([driver.id, follower.id]);
  }

  // Kahn 拓扑排序（按声明顺序入队，保证求值确定）。
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const [driver, follower] of edges) {
    indegree.set(driver, indegree.get(driver) ?? 0);
    indegree.set(follower, (indegree.get(follower) ?? 0) + 1);
    const list = outgoing.get(driver) ?? [];
    list.push(follower);
    outgoing.set(driver, list);
  }
  const queue = constraints
    .map((constraint) => constraint.driverJointId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: LinkageConstraint[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const constraint of constraints) {
      if (constraint.driverJointId === current) {
        ordered.push(constraint);
        const next = constraint.followerJointId;
        indegree.set(next, (indegree.get(next) ?? 1) - 1);
        if ((indegree.get(next) ?? 0) === 0) queue.push(next);
      }
    }
  }
  if (ordered.length !== constraints.length) {
    throw new Error('联动约束中存在环，无法得到确定的关节状态');
  }
  return ordered;
}

function expectedFollowerAngle(
  rig: FigureRig,
  states: JointStateMap,
  constraint: LinkageConstraint,
): number {
  const followerJoint = jointById(rig, constraint.followerJointId);
  const driverState = states[constraint.driverJointId];
  if (!driverState) {
    throw new Error(`驱动关节 ${constraint.driverJointId} 缺少当前状态`);
  }
  const raw = driverState.angle * linkageRatio(constraint);
  return convergeAngle(followerJoint, raw, driverState.angle);
}

/**
 * 应用驱动输入并联动传播，返回一份全新的关节状态表。
 * 未在 driverInputs 中出现、也不是从动关节的关节保持初始状态。
 */
export function applyLinkages(
  rig: FigureRig,
  initialStates: JointStateMap,
  driverInputs: Record<string, number>,
  constraints: LinkageConstraint[],
): JointStateMap {
  const ordered = validateLinkages(rig, constraints);
  const states: JointStateMap = {};
  for (const [id, state] of Object.entries(initialStates)) {
    states[id] = { ...state };
  }
  for (const [jointId, rawInput] of Object.entries(driverInputs)) {
    const joint = jointById(rig, jointId);
    const current = states[jointId]?.angle ?? 0;
    states[jointId] = {
      angle: convergeAngle(joint, rawInput, current),
      angularVelocity: 0,
    };
  }
  for (const constraint of ordered) {
    const followerJoint = jointById(rig, constraint.followerJointId);
    const expected = expectedFollowerAngle(rig, states, constraint);
    states[followerJoint.id] = { angle: expected, angularVelocity: 0 };
  }
  return states;
}

/** 检查联动后所有关节状态是否互相一致，返回所有违例（空数组表示一致）。 */
export function linkageViolations(
  rig: FigureRig,
  states: JointStateMap,
  constraints: LinkageConstraint[],
  tolerance: number = 1e-9,
): LinkageViolation[] {
  validateLinkages(rig, constraints);
  const violations: LinkageViolation[] = [];
  for (const constraint of constraints) {
    const expected = expectedFollowerAngle(rig, states, constraint);
    const actual = states[constraint.followerJointId]?.angle;
    if (actual === undefined) {
      throw new Error(`从动关节 ${constraint.followerJointId} 缺少当前状态`);
    }
    const delta = Math.abs(actual - expected);
    if (delta > tolerance) {
      violations.push({
        constraintId: constraint.id,
        driverJointId: constraint.driverJointId,
        followerJointId: constraint.followerJointId,
        expected,
        actual,
        delta,
      });
    }
  }
  return violations;
}
