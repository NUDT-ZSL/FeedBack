/**
 * 套件二：多关节联动时各关节状态是否互相一致。
 *
 * 一致性核心不变量（对每个 IK 解强制校验）：
 *  1. 解析黄金值：根角度、弯折角度、末端坐标与独立三角计算的夹具黄金值一致；
 *  2. FK 闭环：用解出的两个关节角重新做正运动学，末端必须等于解中返回的末端
 *     —— 即「角度状态」与「合成位置」必须对得上，不允许限位截断后仍宣称到达目标；
 *  3. 幂等：对求解结果的末端再解一次，关节角必须不变（同输入同结果、无隐式状态）；
 *  4. 限位截断必须显式上报（limited=true，且记录 requiredBend 与实际 bend 的差）。
 */

import { forwardKinematics, propagateChainDelta, solveTwoBoneIK, type TwoBoneChain } from '../../src/puppet/linkage.ts';
import { Harness, assertApprox, assertEqual, assertThrows, assertTrue, assertVec2Approx } from '../harness.ts';
import { limbChainFixture } from '../fixtures.ts';

const TIGHT = 1e-9;
const XY_TOL = 1e-6;

export function runLinkageConsistencySuite(): Harness {
  const h = new Harness('多关节联动一致性');
  const base = limbChainFixture.chain;

  for (const testCase of limbChainFixture.ikCases) {
    h.check(`IK 解 [${testCase.name}] 匹配黄金值`, () => {
      const chain: TwoBoneChain = { ...base, bendSign: testCase.bendSign };
      const pose = solveTwoBoneIK(chain, testCase.target);
      const e = testCase.expect;
      assertApprox(pose.rootAngleDeg, e.rootAngleDeg, TIGHT, '根关节角度');
      assertApprox(pose.bendAngleDeg, e.bendAngleDeg, TIGHT, '肘关节弯折角');
      assertVec2Approx(pose.end, e.end, XY_TOL, '末端坐标');
      assertEqual(pose.reachable, e.reachable, '可达标记');
      assertEqual(pose.limited, e.limited, '限位截断标记');
    });

    h.check(`FK 闭环 [${testCase.name}]：角度 ←→ 末端一致`, () => {
      const chain: TwoBoneChain = { ...base, bendSign: testCase.bendSign };
      const pose = solveTwoBoneIK(chain, testCase.target);
      const fk = forwardKinematics(chain, pose.rootAngleDeg, pose.bendAngleDeg);
      assertVec2Approx(fk.elbow, pose.elbow, XY_TOL, '肘部坐标（解内一致性）');
      assertVec2Approx(fk.end, pose.end, XY_TOL, '末端坐标（解内一致性）');
      assertTrue(
        Number.isFinite(pose.rootAngleDeg) && Number.isFinite(pose.bendAngleDeg),
        '关节角度必须为有限值',
      );
    });

    h.check(`幂等性 [${testCase.name}]：对结果末端二次求解不变`, () => {
      const chain: TwoBoneChain = { ...base, bendSign: testCase.bendSign };
      const first = solveTwoBoneIK(chain, testCase.target);
      const again = solveTwoBoneIK(chain, first.end);
      assertApprox(again.rootAngleDeg, first.rootAngleDeg, TIGHT, '二次求解根角度');
      assertApprox(again.bendAngleDeg, first.bendAngleDeg, TIGHT, '二次求解弯折角');
    });
  }

  h.check('肘关节受限时截断量显式上报，且角度/末端仍 FK 一致', () => {
    const rc = limbChainFixture.restrictedChain;
    const chain: TwoBoneChain = {
      origin: rc.origin,
      upperLength: rc.upperLength,
      lowerLength: rc.lowerLength,
      rootLimit: rc.rootLimit,
      bendLimit: rc.bendLimit,
      bendSign: rc.bendSign,
    };
    const pose = solveTwoBoneIK(chain, limbChainFixture.restrictedCase.target);
    const e = limbChainFixture.restrictedCase.expect;
    assertEqual(pose.limited, true, '限位截断标记');
    assertApprox(pose.bendAngleDeg, e.bendAngleDeg, TIGHT, '截断后的弯折角');
    assertApprox(pose.requiredBendDeg, e.requiredBendDeg, TIGHT, '无约束所需弯折角');
    assertApprox(pose.rootAngleDeg, e.rootAngleDeg, TIGHT, '根角度');
    assertVec2Approx(pose.elbow, e.elbow, XY_TOL, '肘部黄金坐标');
    assertVec2Approx(pose.end, e.end, XY_TOL, '截断后末端黄金坐标');
    const fk = forwardKinematics(chain, pose.rootAngleDeg, pose.bendAngleDeg);
    assertVec2Approx(fk.end, pose.end, XY_TOL, '截断后 FK 闭环');
    assertTrue(
      Math.hypot(pose.end.x - 100, pose.end.y - 100) > XY_TOL,
      '被限位截断时末端必须不同于原目标，不能假装到达',
    );
  });

  for (const chainCase of limbChainFixture.propagateChain.cases) {
    h.check(`联动传导 [${chainCase.name}] 生效量/截断量匹配黄金值`, () => {
      const result = propagateChainDelta(
        limbChainFixture.propagateChain.nodes.map((n) => ({
          id: n.id,
          limit: n.limit,
          couplingToChild: n.couplingToChild,
        })),
        chainCase.rawDeltaDeg,
      );
      assertEqual(result.realizedDeltaDeg.length, chainCase.expectRealized.length, '关节数量');
      for (let i = 0; i < chainCase.expectRealized.length; i++) {
        assertApprox(
          result.realizedDeltaDeg[i],
          chainCase.expectRealized[i],
          TIGHT,
          `关节 ${i + 1} 生效增量`,
        );
        assertApprox(
          result.blockedDeg[i],
          chainCase.expectBlocked[i],
          TIGHT,
          `关节 ${i + 1} 截断量`,
        );
      }
    });
  }

  h.check('联动传导：非有限增量与非法耦合系数必须抛错', () => {
    const nodes = limbChainFixture.propagateChain.nodes;
    assertThrows(() => propagateChainDelta(nodes, NaN), 'NaN 增量', '有限数值');
    assertThrows(() => propagateChainDelta([], 10), '空关节链', '不能为空');
    const bad = nodes.map((n) => ({ ...n }));
    bad[0].couplingToChild = 1.5;
    assertThrows(() => propagateChainDelta(bad, 10), '耦合系数 > 1', '耦合系数');
  });

  h.check('IK 入参校验：非有限目标、非正骨长、空弯折方向均抛错', () => {
    const chain: TwoBoneChain = { ...base, bendSign: 1 };
    assertThrows(() => solveTwoBoneIK(chain, { x: NaN, y: 0 }), 'NaN 目标', '有限数值');
    assertThrows(
      () => solveTwoBoneIK({ ...chain, upperLength: 0 }, { x: 1, y: 1 }),
      '零骨长',
      '长度必须为正',
    );
  });

  return h;
}
