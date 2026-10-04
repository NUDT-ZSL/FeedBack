import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLinkages,
  linkageRatio,
  linkageViolations,
  validateLinkages,
} from '../../src/puppet/linkage.ts';
import { convergeAngle } from '../../src/puppet/joints.ts';
import type { LinkageConstraint } from '../../src/puppet/linkage.ts';
import { deterministicSequence, standardFixture } from './fixtures.ts';

describe('多关节联动：约束关系', () => {
  const { rig, restStates, linkages } = standardFixture();
  const shoulderLeft = rig.joints.find((j) => j.id === 'shoulderLeft')!;
  const shoulderRight = rig.joints.find((j) => j.id === 'shoulderRight')!;
  const hipLeft = rig.joints.find((j) => j.id === 'hipLeft')!;
  const hipRight = rig.joints.find((j) => j.id === 'hipRight')!;

  it('镜像联动：右臂 = -左臂（驱动在界内）', () => {
    const states = applyLinkages(rig, restStates, { shoulderLeft: 40 }, linkages);
    assert.equal(states.shoulderLeft.angle, 40);
    assert.equal(states.shoulderRight.angle, -40);
    assert.deepEqual(linkageViolations(rig, states, linkages), []);
  });

  it('比例联动：右腿 = 0.5 * 左腿，从动受自身边界收敛', () => {
    const states = applyLinkages(rig, restStates, { hipLeft: 60 }, linkages);
    assert.equal(states.hipLeft.angle, 60);
    assert.equal(states.hipRight.angle, 30);
    assert.deepEqual(linkageViolations(rig, states, linkages), []);
  });

  it('驱动越界时先收敛驱动，再传播；联动结果依然零违例', () => {
    const states = applyLinkages(
      rig,
      restStates,
      { shoulderLeft: 99999, hipLeft: -99999 },
      linkages,
    );
    assert.equal(states.shoulderLeft.angle, shoulderLeft.maxAngle);
    assert.equal(states.shoulderRight.angle, -shoulderRight.maxAngle);
    assert.equal(states.hipLeft.angle, hipLeft.minAngle);
    assert.equal(
      states.hipRight.angle,
      convergeAngle(hipRight, hipLeft.minAngle * 0.5, 0),
    );
    assert.deepEqual(linkageViolations(rig, states, linkages), []);
  });

  it('从动目标越界时停在从动边界（不是放弃约束）', () => {
    // 构造 elbow 式的极端 ratio，使目标超过左腿 90 度上限
    const forced: LinkageConstraint[] = [
      {
        id: 'overdrive',
        kind: 'ratio',
        driverJointId: 'shoulderLeft',
        followerJointId: 'hipRight',
        ratio: 10,
      },
    ];
    const states = applyLinkages(rig, restStates, { shoulderLeft: 100 }, forced);
    assert.equal(states.shoulderLeft.angle, 100);
    assert.equal(states.hipRight.angle, hipRight.maxAngle);
    // violations 用同一套收敛规则计算期望值，因此饱和后仍然一致
    assert.deepEqual(linkageViolations(rig, states, forced), []);
  });

  it('批量确定性输入下，联动状态始终自洽', () => {
    const values = deterministicSequence(7, 120, 400);
    for (const driverValue of values) {
      const states = applyLinkages(
        rig,
        restStates,
        { shoulderLeft: driverValue, hipLeft: driverValue },
        linkages,
      );
      const violations = linkageViolations(rig, states, linkages);
      assert.equal(violations.length, 0, JSON.stringify(violations));
    }
  });

  it('未驱动、未联动的关节保持初始状态不变', () => {
    const states = applyLinkages(rig, restStates, { shoulderLeft: 20 }, linkages);
    assert.equal(states.neck.angle, 0);
    assert.equal(states.hipLeft.angle, 0);
  });
});

describe('多关节联动：约束图合法性', () => {
  const { rig } = standardFixture();

  it('多级联动按拓扑顺序求值，结果与手工逐级计算一致', () => {
    // neck -> shoulderRight(mirror) -> hipLeft(ratio 0.25) -> hipRight(ratio 0.5)
    const chain: LinkageConstraint[] = [
      { id: 'c1', kind: 'mirror', driverJointId: 'neck', followerJointId: 'shoulderRight' },
      { id: 'c2', kind: 'ratio', driverJointId: 'shoulderRight', followerJointId: 'hipLeft', ratio: 0.25 },
      { id: 'c3', kind: 'ratio', driverJointId: 'hipLeft', followerJointId: 'hipRight', ratio: 0.5 },
    ];
    const ordered = validateLinkages(rig, chain);
    assert.deepEqual(ordered.map((c) => c.id), ['c1', 'c2', 'c3']);
    const states = applyLinkages(rig, standardFixture().restStates, { neck: 40 }, chain);
    assert.equal(states.shoulderRight.angle, -40);
    assert.equal(states.hipLeft.angle, -10);
    assert.equal(states.hipRight.angle, -5);
    assert.deepEqual(linkageViolations(rig, states, chain), []);
  });

  it('一个关节被两条约束同时驱动时报错，而不是隐式覆盖', () => {
    const conflict: LinkageConstraint[] = [
      { id: 'a', kind: 'mirror', driverJointId: 'shoulderLeft', followerJointId: 'hipLeft' },
      { id: 'b', kind: 'mirror', driverJointId: 'shoulderRight', followerJointId: 'hipLeft' },
    ];
    assert.throws(() => validateLinkages(rig, conflict), /不唯一/);
  });

  it('联动成环时报错（无确定求值顺序）', () => {
    const cycle: LinkageConstraint[] = [
      { id: 'a', kind: 'mirror', driverJointId: 'neck', followerJointId: 'shoulderLeft' },
      { id: 'b', kind: 'mirror', driverJointId: 'shoulderLeft', followerJointId: 'shoulderRight' },
      { id: 'c', kind: 'mirror', driverJointId: 'shoulderRight', followerJointId: 'neck' },
    ];
    assert.throws(() => validateLinkages(rig, cycle), /环/);
  });

  it('驱动或从动关节不存在时显式报错', () => {
    const missing: LinkageConstraint[] = [
      { id: 'x', kind: 'mirror', driverJointId: 'ghost', followerJointId: 'neck' },
    ];
    assert.throws(() => validateLinkages(rig, missing), /不存在/);
  });

  it('ratio 为 NaN/Infinity 时拒绝配置', () => {
    const bad: LinkageConstraint[] = [
      { id: 'x', kind: 'ratio', driverJointId: 'neck', followerJointId: 'hipLeft', ratio: Number.NaN },
    ];
    assert.throws(() => validateLinkages(rig, bad), RangeError);
  });

  it('linkageRatio 对 mirror 返回 -1、ratio 返回配置值', () => {
    assert.equal(linkageRatio({ id: 'm', kind: 'mirror', driverJointId: 'a', followerJointId: 'b' }), -1);
    assert.equal(linkageRatio({ id: 'r', kind: 'ratio', driverJointId: 'a', followerJointId: 'b', ratio: 0.25 }), 0.25);
  });
});
