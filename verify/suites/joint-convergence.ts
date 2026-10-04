/**
 * 套件一：关节角度在边界与越界输入下的收敛行为。
 *
 * 判定标准（来自夹具 joint-limits.json，不放宽）：
 *  - 越界目标必须被截断（setTarget 返回 clamped=true），且关节状态永不越出限位；
 *  - 边界/越界目标最终精确停在限位上（容差 0.05°，速度 < 0.5°/s，持续 120 步不漂移）；
 *  - 非法输入（NaN/±Infinity）必须抛错而不是静默吞掉。
 */

import { HingeJoint } from '../../src/puppet/hinge.ts';
import { Harness, assertApprox, assertEqual, assertThrows, assertTrue } from '../harness.ts';
import { jointFixture } from '../fixtures.ts';

export function runJointConvergenceSuite(): Harness {
  const h = new Harness('关节收敛（边界与越界输入）');
  const { joint, settle } = jointFixture;

  for (const scenario of jointFixture.scenarios) {
    h.check(`目标 ${scenario.name}（${scenario.targetDeg}°）收敛到 ${scenario.expect.settleAtDeg}°`, () => {
      const hinge = new HingeJoint(joint);
      const result = hinge.setTarget(scenario.targetDeg);
      assertEqual(result.clamped, scenario.expect.clamped, '截断标记');
      assertApprox(result.targetDeg, scenario.expect.settleAtDeg, 1e-9, '截断后的目标角');

      let heldSteps = 0;
      let settledAt = -1;
      for (let i = 0; i < settle.maxSteps; i++) {
        hinge.step();
        assertTrue(
          hinge.angle >= joint.minDeg - 1e-9 && hinge.angle <= joint.maxDeg + 1e-9,
          `第 ${i + 1} 步角度越出限位：${hinge.angle}°（限位 [${joint.minDeg}, ${joint.maxDeg}]）`,
        );
        const settled =
          Math.abs(hinge.angle - scenario.expect.settleAtDeg) <= settle.angleToleranceDeg &&
          Math.abs(hinge.velocity) <= settle.velocityToleranceDegPerSec;
        heldSteps = settled ? heldSteps + 1 : 0;
        if (heldSteps >= settle.holdSteps) {
          settledAt = i;
          break;
        }
      }
      assertTrue(
        settledAt >= 0,
        `${settle.maxSteps} 步内未稳定收敛（最终角度 ${hinge.angle}°，速度 ${hinge.velocity}°/s）`,
      );
      assertApprox(hinge.angle, scenario.expect.settleAtDeg, settle.angleToleranceDeg, '收敛角度');
    });
  }

  h.check('非法目标输入（NaN / ±Infinity）抛错且不污染状态', () => {
    const hinge = new HingeJoint(joint);
    hinge.snapTo(10);
    for (const token of jointFixture.invalidTargets) {
      const value = token === 'NaN' ? NaN : token === 'Infinity' ? Infinity : -Infinity;
      assertThrows(() => hinge.setTarget(value), `setTarget(${token})`, '有限数值');
      assertThrows(() => hinge.snapTo(value), `snapTo(${token})`, '有限数值');
    }
    assertApprox(hinge.angle, 10, 1e-9, '非法输入后角度保持不变');
  });

  h.check('瞬时甩力后关节衰减回目标且全程不越界', () => {
    const hinge = new HingeJoint(joint);
    hinge.snapTo(jointFixture.forceScenario.expectSettleAtDeg);
    hinge.applyForce(jointFixture.forceScenario.forceDegPerSecSq);
    assertTrue(hinge.velocity > 0, '施加正力后角速度应为正');
    for (let i = 0; i < jointFixture.forceScenario.steps; i++) {
      hinge.step();
      assertTrue(
        hinge.angle >= joint.minDeg - 1e-9 && hinge.angle <= joint.maxDeg + 1e-9,
        `第 ${i + 1} 步角度越出限位：${hinge.angle}°`,
      );
    }
    assertApprox(
      hinge.angle,
      jointFixture.forceScenario.expectSettleAtDeg,
      settle.angleToleranceDeg,
      '甩力后收敛角度',
    );
  });

  h.check('装配吸附 snapTo 对越界输入截断到限位', () => {
    const hinge = new HingeJoint(joint);
    const over = hinge.snapTo(joint.maxDeg + 500);
    assertEqual(over.clamped, true, '越界吸附截断标记');
    assertApprox(over.angleDeg, joint.maxDeg, 1e-9, '越界吸附落点');
    const inside = hinge.snapTo(0);
    assertEqual(inside.clamped, false, '界内吸附截断标记');
  });

  h.check('非法构造参数（限位颠倒 / 负阻尼）直接抛错', () => {
    assertThrows(
      () => new HingeJoint({ minDeg: 10, maxDeg: -10, damping: 0.3 }),
      '限位颠倒',
      '限位非法',
    );
    assertThrows(
      () => new HingeJoint({ minDeg: -90, maxDeg: 90, damping: -0.1 }),
      '负阻尼',
      '阻尼',
    );
  });

  return h;
}
