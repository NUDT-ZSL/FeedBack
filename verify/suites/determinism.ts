/**
 * 套件四：相同输入重复执行时结果是否稳定。
 *
 * 判定标准（不放宽）：完全相同的输入序列重复执行，
 * 数值结果必须逐位一致（JSON 序列化后字符串相等），
 * 不允许出现「大致相同」——任何漂移都说明存在隐式状态或时间依赖。
 */

import { HingeJoint } from '../../src/puppet/hinge.ts';
import { solveTwoBoneIK, type TwoBoneChain } from '../../src/puppet/linkage.ts';
import { composeFigure, type FigureDefinition } from '../../src/puppet/figure.ts';
import { Harness, assertEqual, assertTrue } from '../harness.ts';
import { figureFixture, jointFixture, limbChainFixture } from '../fixtures.ts';

/** 固定脚本：三段关节的一串目标切换（含越界），模拟一次完整操纵。 */
const SCRIPT: Array<{ joint: number; target: number }> = [
  { joint: 0, target: 45 },
  { joint: 1, target: -30 },
  { joint: 2, target: 720 },
  { joint: 0, target: -90 },
  { joint: 1, target: 0 },
  { joint: 0, target: 12.5 },
  { joint: 2, target: -720 },
];

function runScriptedTrajectory(): string {
  const joints = [0, 1, 2].map(
    () => new HingeJoint({ minDeg: -90, maxDeg: 90, damping: jointFixture.joint.damping }),
  );
  const samples: number[] = [];
  for (let step = 0; step < 1200; step++) {
    const command = SCRIPT[Math.floor(step / 150) % SCRIPT.length];
    joints[command.joint].setTarget(command.target);
    for (const joint of joints) joint.step();
    for (const joint of joints) samples.push(joint.angle, joint.velocity);
  }
  return JSON.stringify(samples);
}

export function runDeterminismSuite(): Harness {
  const h = new Harness('重复执行稳定性');

  h.check('固定操纵脚本执行两次，7200 个采样点逐位一致', () => {
    const first = runScriptedTrajectory();
    const second = runScriptedTrajectory();
    assertEqual(second, first, '两次执行的完整轨迹（JSON 序列化）');
  });

  h.check('两个独立关节实例受相同输入驱动，轨迹逐位一致（无共享隐式状态）', () => {
    const make = () => new HingeJoint({ minDeg: -90, maxDeg: 90, damping: 0.3 });
    const a = make();
    const b = make();
    const traceA: number[] = [];
    const traceB: number[] = [];
    for (const target of [30, -80, 200, 0, -200, 90]) {
      a.setTarget(target);
      b.setTarget(target);
      for (let i = 0; i < 200; i++) {
        a.step();
        b.step();
        traceA.push(a.angle, a.velocity);
        traceB.push(b.angle, b.velocity);
      }
    }
    assertEqual(JSON.stringify(traceB), JSON.stringify(traceA), '两实例轨迹');
  });

  h.check('同一 IK 目标重复求解 50 次，结果逐位一致', () => {
    const chain: TwoBoneChain = { ...limbChainFixture.chain, bendSign: 1 };
    const baseline = JSON.stringify(solveTwoBoneIK(chain, { x: 100, y: 100 }));
    for (let i = 0; i < 50; i++) {
      assertEqual(JSON.stringify(solveTwoBoneIK(chain, { x: 100, y: 100 })), baseline, `第 ${i + 1} 次求解`);
    }
  });

  h.check('同一角色姿态重复合成 50 次，结果逐位一致', () => {
    const def = JSON.parse(JSON.stringify(figureFixture.figure)) as FigureDefinition;
    const pose = { jointAngles: figureFixture.poses[1].jointAngles };
    const baseline = JSON.stringify(composeFigure(def, pose));
    for (let i = 0; i < 50; i++) {
      assertEqual(JSON.stringify(composeFigure(def, pose)), baseline, `第 ${i + 1} 次合成`);
    }
  });

  h.check('合成结果不随输入对象被改写（输出为全新对象）', () => {
    const def = JSON.parse(JSON.stringify(figureFixture.figure)) as FigureDefinition;
    const pose = { jointAngles: figureFixture.poses[0].jointAngles };
    const first = composeFigure(def, pose);
    const snapshot = JSON.stringify(first);
    const again = composeFigure(def, pose);
    assertTrue(first.parts[0].position !== again.parts[0].position, '两次合成应返回独立对象');
    assertEqual(JSON.stringify(again), snapshot, '前一次结果不应被后续调用污染');
  });

  return h;
}
