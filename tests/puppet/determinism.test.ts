import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyLinkages } from '../../src/puppet/linkage.ts';
import { composeFigure } from '../../src/puppet/compose.ts';
import { convergeAngle, simulateHinge } from '../../src/puppet/joints.ts';
import { jointById } from '../../src/puppet/linkage.ts';
import {
  GOLDEN_DRIVER_INPUTS,
  deterministicSequence,
  standardFixture,
} from './fixtures.ts';

const ROOT = { x: 400, y: 300 };

/** 与结果顺序无关的稳定序列化，确保比较不受对象键顺序影响。 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = v[key];
          return acc;
        }, {});
    }
    return v;
  });
}

describe('重复执行稳定性', () => {
  const { rig, restStates, linkages } = standardFixture();

  it('相同输入重复 20 次：收敛→联动→合成全链路逐字节一致', () => {
    const first = stableStringify(
      composeFigure(
        rig,
        applyLinkages(rig, restStates, GOLDEN_DRIVER_INPUTS, linkages),
        ROOT,
      ),
    );
    for (let run = 0; run < 20; run += 1) {
      const pose = composeFigure(
        rig,
        applyLinkages(rig, restStates, GOLDEN_DRIVER_INPUTS, linkages),
        ROOT,
      );
      assert.equal(stableStringify(pose), first, `第 ${run + 1} 次执行结果漂移`);
    }
  });

  it('铰链积分轨迹重复执行逐帧一致', () => {
    const joint = jointById(rig, 'shoulderLeft');
    const traceA = simulateHinge(joint, { angle: 0, angularVelocity: 80 }, 20, 1 / 60, 1e-9, 800);
    const traceB = simulateHinge(joint, { angle: 0, angularVelocity: 80 }, 20, 1 / 60, 1e-9, 800);
    assert.equal(traceA.length, traceB.length);
    assert.equal(stableStringify(traceA), stableStringify(traceB));
  });

  it('收敛函数对同值多次调用完全一致（无隐藏内部状态）', () => {
    for (const value of [0, -45, 45, 1000, -1000, Infinity, -Infinity, Number.NaN]) {
      const first = convergeAngle(jointById(rig, 'neck'), value, 12);
      for (let run = 0; run < 10; run += 1) {
        assert.equal(convergeAngle(jointById(rig, 'neck'), value, 12), first);
      }
    }
  });

  it('夹具确定性：伪随机序列每次生成相同序列（非 Math.random）', () => {
    assert.deepEqual(deterministicSequence(42, 8), deterministicSequence(42, 8));
    assert.notDeepEqual(deterministicSequence(42, 8), deterministicSequence(43, 8));
  });

  it('全量边界矩阵稳定：每个关节 × 每类输入的收敛值构成固定快照', () => {
    const snapshot: Record<string, Record<string, number>> = {};
    const cases = [
      ['min', (min: number) => min],
      ['max', (_min: number, max: number) => max],
      ['under', (min: number) => min - 1000],
      ['over', (_min: number, max: number) => max + 1000],
      ['negInf', () => -Infinity],
      ['posInf', () => Infinity],
    ] as const;
    for (const joint of rig.joints) {
      snapshot[joint.id] = {};
      for (const [name, producer] of cases) {
        snapshot[joint.id][name] = convergeAngle(joint, producer(joint.minAngle, joint.maxAngle), 0);
      }
    }
    assert.equal(
      stableStringify(snapshot),
      stableStringify({
        neck: { min: -45, max: 45, under: -45, over: 45, negInf: -45, posInf: 45 },
        shoulderLeft: { min: -170, max: 170, under: -170, over: 170, negInf: -170, posInf: 170 },
        shoulderRight: { min: -170, max: 170, under: -170, over: 170, negInf: -170, posInf: 170 },
        hipLeft: { min: -90, max: 90, under: -90, over: 90, negInf: -90, posInf: 90 },
        hipRight: { min: -90, max: 90, under: -90, over: 90, negInf: -90, posInf: 90 },
      }),
    );
  });
});
