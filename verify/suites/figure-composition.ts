/**
 * 套件三：角色合成结果与各关节输入是否对得上。
 *
 * 判定标准（夹具 figure-composition.json，黄金值来自独立旋转矩阵计算）：
 *  - 每个部件的世界坐标 / 旋转角 / 末端点必须与关节角输入严格对应（容差 1e-6）；
 *  - 越界关节角按限位截断，且截断名单必须如实上报（clampedJoints）；
 *  - 缺失的关节角按 0° 处理并如实上报（missingJoints），不得静默吞掉；
 *  - 非法结构（缺部件、重复 id、错误挂载、限位颠倒、非有限角度）必须抛错。
 */

import { assembleFigure, composeFigure, type FigureDefinition } from '../../src/puppet/figure.ts';
import { Harness, assertApprox, assertEqual, assertThrows, assertTrue, assertVec2Approx } from '../harness.ts';
import { figureFixture } from '../fixtures.ts';

const TOL = 1e-6;

function definition(): FigureDefinition {
  return JSON.parse(JSON.stringify(figureFixture.figure)) as FigureDefinition;
}

export function runFigureCompositionSuite(): Harness {
  const h = new Harness('角色合成一致性');

  for (const pose of figureFixture.poses) {
    h.check(`姿态 [${pose.name}] 合成结果与关节输入逐项对应`, () => {
      const composed = composeFigure(definition(), { jointAngles: pose.jointAngles });
      assertEqual(composed.parts.length, 6, '合成部件数量');
      assertEqual(
        composed.clampedJoints.slice().sort().join(','),
        pose.expectClamped.slice().sort().join(','),
        '截断关节名单',
      );
      assertEqual(
        composed.missingJoints.slice().sort().join(','),
        pose.expectMissing.slice().sort().join(','),
        '缺失关节名单',
      );
      for (const part of composed.parts) {
        const expected = pose.expectParts[part.type];
        assertTrue(expected !== undefined, `夹具缺少部件 ${part.type} 的期望值`);
        assertVec2Approx(part.position, expected.position, TOL, `${part.type} 世界坐标`);
        assertApprox(part.rotationDeg, expected.rotationDeg, TOL, `${part.type} 旋转角`);
        assertVec2Approx(part.tip, expected.tip, TOL, `${part.type} 末端点`);
      }
    });
  }

  h.check('装配校验：缺部件 / 部件数量不符 / 重复 id 均抛错', () => {
    const missing = definition();
    missing.parts = missing.parts.filter((p) => p.type !== 'head');
    assertThrows(() => assembleFigure(missing), '只剩 5 件部件', '恰好包含 6 种部件');

    const wrongType = definition();
    wrongType.parts[1] = { ...wrongType.parts[1], type: 'wing' as never };
    assertThrows(() => assembleFigure(wrongType), '部件类型不在必需集合', '缺少必需部件');

    const extra = definition();
    extra.parts.push({ id: 'armLeft2', type: 'armLeft', length: 80, anchor: { x: 0, y: 0 } });
    assertThrows(() => assembleFigure(extra), '七件部件', '恰好包含 6 种部件');

    const dup = definition();
    dup.parts[1] = { ...dup.parts[1], id: 'body' };
    assertThrows(() => assembleFigure(dup), '重复部件 id', '重复');
  });

  h.check('装配校验：肢体未绑在躯干 / 限位颠倒 / 关节重复均抛错', () => {
    const wrongParent = definition();
    wrongParent.bindings.find((b) => b.id === 'shoulderL')!.parentPartId = 'head';
    assertThrows(() => assembleFigure(wrongParent), '手臂绑到头部', '必须绑定在躯干上');

    const badLimit = definition();
    badLimit.bindings.find((b) => b.id === 'hipL')!.minDeg = 90;
    assertThrows(() => assembleFigure(badLimit), '限位颠倒', '限位非法');

    const dupJoint = definition();
    dupJoint.bindings.push({ ...dupJoint.bindings[0] });
    assertThrows(() => assembleFigure(dupJoint), '重复关节 id', '重复');
  });

  h.check('合成校验：非有限关节角抛错，未知关节 id 不影响既有合成', () => {
    assertThrows(
      () => composeFigure(definition(), { jointAngles: { shoulderL: NaN } }),
      'NaN 关节角',
      '有限数值',
    );
    const composed = composeFigure(definition(), {
      jointAngles: { neck: 0, shoulderL: 0, shoulderR: 0, hipL: 0, hipR: 0, ghostJoint: 30 },
    });
    assertEqual(composed.parts.length, 6, '含未知关节时部件数量');
    const rest = figureFixture.poses[0];
    const armLeft = composed.parts.find((p) => p.type === 'armLeft')!;
    assertVec2Approx(armLeft.position, rest.expectParts.armLeft.position, TOL, '未知关节不影响 armLeft');
  });

  return h;
}
