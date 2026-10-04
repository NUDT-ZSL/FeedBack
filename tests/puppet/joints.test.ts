import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAMPING,
  convergeAngle,
  isHingeSettled,
  normalizeAngle,
  simulateHinge,
  stepHinge,
} from '../../src/puppet/joints.ts';
import type { Joint, JointState } from '../../src/puppet/types.ts';
import {
  boundaryAndOutOfRangeInputs,
  deterministicSequence,
  standardFixture,
} from './fixtures.ts';

function makeJoint(overrides: Partial<Joint> = {}): Joint {
  return {
    id: 'j',
    partId: 'p',
    position: { x: 0, y: 0 },
    minAngle: -60,
    maxAngle: 60,
    damping: DEFAULT_DAMPING,
    ...overrides,
  };
}

describe('关节角度：边界与越界输入收敛', () => {
  const { rig } = standardFixture();

  it('范围内输入原样通过', () => {
    const joint = makeJoint();
    assert.equal(convergeAngle(joint, 12.5), 12.5);
    assert.equal(convergeAngle(joint, -60), -60);
    assert.equal(convergeAngle(joint, 60), 60);
  });

  it('越界输入收敛到最近边界（逐关节、逐样例）', () => {
    for (const sample of boundaryAndOutOfRangeInputs(rig)) {
      const joint = rig.joints.find((item) => item.id === sample.jointId)!;
      const result = convergeAngle(joint, sample.value, 0);
      switch (sample.label) {
        case '下界精确值':
        case '大幅低于下界':
        case '负无穷':
          assert.equal(result, joint.minAngle, `${joint.id} / ${sample.label}`);
          break;
        case '上界精确值':
        case '大幅高于上界':
        case '正无穷':
          assert.equal(result, joint.maxAngle, `${joint.id} / ${sample.label}`);
          break;
        case 'NaN':
          assert.equal(result, 0, `${joint.id} / NaN 应保持当前角度 0`);
          break;
      }
    }
  });

  it('NaN 输入保持当前角度（当前角度自身越界时也收敛回界内）', () => {
    const joint = makeJoint();
    assert.equal(convergeAngle(joint, Number.NaN, 25), 25);
    assert.equal(convergeAngle(joint, Number.NaN, 9999), joint.maxAngle);
  });

  it('收敛结果始终落在合法闭区间内（批量确定性输入）', () => {
    for (const joint of rig.joints) {
      for (const value of deterministicSequence(49, 200)) {
        const result = convergeAngle(joint, value, 0);
        assert.ok(result >= joint.minAngle && result <= joint.maxAngle);
      }
    }
  });

  it('角度归一化落在 (-180, 180] 且非有限输入按 0 处理', () => {
    assert.equal(normalizeAngle(0), 0);
    assert.equal(normalizeAngle(180), 180);
    assert.equal(normalizeAngle(-180), 180);
    assert.equal(normalizeAngle(270), -90);
    assert.equal(normalizeAngle(-540), 180);
    assert.equal(normalizeAngle(Number.NaN), 0);
    assert.equal(normalizeAngle(Infinity), 0);
  });
});

describe('铰链物理：阻尼 0.3 的收敛行为', () => {
  const joint = makeJoint({ minAngle: -360, maxAngle: 360 });
  const frameSeconds = 1 / 60;

  it('零外力时角速度指数衰减并最终静止', () => {
    const initial: JointState = { angle: 0, angularVelocity: 120 };
    const trace = simulateHinge(joint, initial, 0, frameSeconds, 1e-9, 5000);
    const last = trace[trace.length - 1];
    const previous = trace[trace.length - 2];
    assert.ok(Math.abs(last.angularVelocity) < 1e-3, '角速度应收敛到 0 附近');
    assert.ok(isHingeSettled(previous, last, frameSeconds, 1e-6), '角度应停止变化');
  });

  it('恒定外力下收敛到非零稳态速度，且稳态满足阻尼平衡关系', () => {
    const initial: JointState = { angle: 0, angularVelocity: 0 };
    const trace = simulateHinge(joint, initial, 60, frameSeconds, 1e-9, 20000);
    const last = trace[trace.length - 1];
    const steadyVelocity = last.angularVelocity;
    assert.ok(Math.abs(steadyVelocity) > 1, '恒定外力下应收敛到非零稳态速度');
    // 稳态：v = (v + (f - d*v)*dt) * 0.95^(dt*60)，用该式反推必须成立
    const drag = 0.95 ** (frameSeconds * 60);
    const predicted =
      (steadyVelocity + (60 - DEFAULT_DAMPING * steadyVelocity) * frameSeconds) *
      drag;
    assert.ok(
      Math.abs(predicted - steadyVelocity) < 1e-6,
      `稳态速度 ${steadyVelocity} 不满足阻尼平衡（预测 ${predicted}）`,
    );
  });

  it('碰到角度边界后停在边界且速度清零，不发生回弹抖动', () => {
    const limited = makeJoint({ minAngle: -30, maxAngle: 30 });
    let state: JointState = { angle: 0, angularVelocity: 0 };
    for (let step = 0; step < 600; step += 1) {
      state = stepHinge(limited, state, 500, frameSeconds);
    }
    assert.equal(state.angle, 30);
    assert.equal(state.angularVelocity, 0);
    const afterExtra = stepHinge(limited, state, 500, frameSeconds);
    assert.equal(afterExtra.angle, 30);
    assert.equal(afterExtra.angularVelocity, 0);
  });

  it('deltaTime 非法时直接拒绝，避免静默产生错误轨迹', () => {
    assert.throws(() => stepHinge(joint, { angle: 0, angularVelocity: 0 }, 1, 0), RangeError);
    assert.throws(() => stepHinge(joint, { angle: 0, angularVelocity: 0 }, 1, -1), RangeError);
  });
});
