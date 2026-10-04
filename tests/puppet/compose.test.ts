import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyLinkages } from '../../src/puppet/linkage.ts';
import { composeFigure, rotateDegrees } from '../../src/puppet/compose.ts';
import type { FigurePose, FigureRig, JointStateMap } from '../../src/puppet/types.ts';
import {
  GOLDEN_DRIVER_INPUTS,
  GOLDEN_EXPECTED_ROTATIONS,
  standardFixture,
} from './fixtures.ts';

const ROOT = { x: 400, y: 300 };

function poseOf(pose: FigurePose, partId: string) {
  const part = pose.parts.find((item) => item.partId === partId);
  assert.ok(part, `合成结果缺少部件 ${partId}`);
  return part!;
}

function assertClose(actual: number, expected: number, epsilon = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message} 期望 ${expected}，实际 ${actual}`,
  );
}

/** 独立于 compose 的铰链连通性检查：父子两侧算出的关节世界点必须重合。 */
function assertPivotsConnected(
  rig: FigureRig,
  pose: FigurePose,
): void {
  for (const joint of rig.joints) {
    if (!joint.parentPartId || !joint.parentPosition) continue;
    const parent = poseOf(pose, joint.parentPartId);
    const child = poseOf(pose, joint.partId);
    const anchorFromParentX = parent.position.x + rotateDegrees(joint.parentPosition, parent.rotation).x;
    const anchorFromParentY = parent.position.y + rotateDegrees(joint.parentPosition, parent.rotation).y;
    const anchorFromChildX = child.position.x + rotateDegrees(joint.position, child.rotation).x;
    const anchorFromChildY = child.position.y + rotateDegrees(joint.position, child.rotation).y;
    assertClose(anchorFromChildX, anchorFromParentX, 1e-9, `${joint.id} 铰链世界点 x`);
    assertClose(anchorFromChildY, anchorFromParentY, 1e-9, `${joint.id} 铰链世界点 y`);
  }
}

describe('角色合成：静止姿态手算坐标', () => {
  const { rig, restStates } = standardFixture();
  const pose = composeFigure(rig, restStates, ROOT);

  it('根部件位于指定根坐标且无旋转', () => {
    const body = poseOf(pose, 'body');
    assert.deepEqual(body.position, ROOT);
    assert.equal(body.rotation, 0);
  });

  it('零角度时各部件位置与手工几何计算完全一致（整数坐标）', () => {
    assert.deepEqual(poseOf(pose, 'head').position, { x: 400, y: 230 });
    assert.deepEqual(poseOf(pose, 'armLeft').position, { x: 382, y: 270 });
    assert.deepEqual(poseOf(pose, 'armRight').position, { x: 418, y: 270 });
    assert.deepEqual(poseOf(pose, 'legLeft').position, { x: 390, y: 340 });
    assert.deepEqual(poseOf(pose, 'legRight').position, { x: 410, y: 340 });
  });

  it('所有部件旋转均为 0', () => {
    for (const part of pose.parts) assert.equal(part.rotation, 0, part.partId);
  });
});

describe('角色合成：结果与关节输入一致', () => {
  const { rig, restStates, linkages } = standardFixture();
  const states = applyLinkages(rig, restStates, GOLDEN_DRIVER_INPUTS, linkages);
  const pose = composeFigure(rig, states, ROOT);

  it('每个部件旋转严格等于对应关节的收敛后输入', () => {
    for (const part of pose.parts) {
      const expected =
        (GOLDEN_EXPECTED_ROTATIONS as Record<string, number>)[part.partId];
      assert.equal(part.rotation, expected, `${part.partId} 旋转与关节输入不一致`);
    }
  });

  it('头部姿态与手算结果一致（10 度）', () => {
    const head = poseOf(pose, 'head');
    const sin10 = Math.sin((10 * Math.PI) / 180);
    const cos10 = Math.cos((10 * Math.PI) / 180);
    assertClose(head.position.x, 400 + 30 * sin10, 1e-9, 'head.x');
    assertClose(head.position.y, 260 - 30 * cos10, 1e-9, 'head.y');
    assert.equal(head.rotation, 10);
  });

  it('170/-170 度的双臂关于身体竖直轴对称', () => {
    const left = poseOf(pose, 'armLeft');
    const right = poseOf(pose, 'armRight');
    assertClose(left.position.x - 400, 400 - right.position.x, 1e-9, '双臂 x 不对称');
    assertClose(left.position.y, right.position.y, 1e-9, '双臂 y 不等高');
    assert.equal(left.rotation, 170);
    assert.equal(right.rotation, -170);
  });

  it('父子部件在铰链世界点处精确连通（无断裂、无重叠错位）', () => {
    assertPivotsConnected(rig, pose);
  });

  it('修改颈部只影响头部，其他部件姿态完全不变', () => {
    const baseline = composeFigure(rig, restStates, ROOT);
    const moved: JointStateMap = {
      ...restStates,
      neck: { angle: 30, angularVelocity: 0 },
    };
    const changed = composeFigure(rig, moved, ROOT);
    for (const partId of ['body', 'armLeft', 'armRight', 'legLeft', 'legRight']) {
      assert.deepEqual(poseOf(changed, partId), poseOf(baseline, partId));
    }
    assert.notEqual(poseOf(changed, 'head').position.x, poseOf(baseline, 'head').position.x);
  });

  it('合成输入必须先收敛：越界/非有限/缺失角度直接报错', () => {
    const outOfRange: JointStateMap = {
      ...restStates,
      neck: { angle: 999, angularVelocity: 0 },
    };
    assert.throws(() => composeFigure(rig, outOfRange, ROOT), /越界/);

    const nonFinite: JointStateMap = {
      ...restStates,
      neck: { angle: Number.NaN, angularVelocity: 0 },
    };
    assert.throws(() => composeFigure(rig, nonFinite, ROOT), RangeError);

    const missing: JointStateMap = { ...restStates };
    delete missing.neck;
    assert.throws(() => composeFigure(rig, missing, ROOT), /缺少状态/);
  });

  it('根坐标平移时所有部件整体平移、旋转不变', () => {
    const shifted = composeFigure(rig, states, { x: 520, y: 180 });
    for (const part of pose.parts) {
      const counterpart = poseOf(shifted, part.partId);
      assertClose(counterpart.position.x - part.position.x, 120, 1e-9);
      assertClose(counterpart.position.y - part.position.y, -120, 1e-9);
      assert.equal(counterpart.rotation, part.rotation);
    }
  });
});
