// 风险四：反复来回调整质量后，轨道参数最终必须与直接设定一致（路径无关性）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBinarySystem,
  settle,
  expectedPeriod,
  expectedSemiMajorAxis
} from './helpers.ts';

describe('质量反复调整的收敛一致性', () => {
  it('单次设定质量后周期与半长轴立即自洽（回归：周期曾用旧半长轴计算）', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 21, starDistance: 30 });
    primaryOrbit.updateMass(7);
    settle(primaryOrbit);

    const params = primaryOrbit.getParams();
    const expectedSMA = expectedSemiMajorAxis(4, 7);
    assert.ok(Math.abs(params.semiMajorAxis - expectedSMA) < 1e-9);
    assert.ok(Math.abs(params.period - expectedPeriod(7, expectedSMA)) < 1e-9,
      `周期 ${params.period} 与质量7+半长轴${expectedSMA} 的开普勒关系 ${expectedPeriod(7, expectedSMA)} 不一致`);
  });

  it('0.5↔10 往返 20 次后停在 5，与直接设定 5 的终态一致', () => {
    const sysA = createBinarySystem({ seed: 22, starDistance: 30 });
    const sysB = createBinarySystem({ seed: 22, starDistance: 30 });

    for (let round = 0; round < 20; round++) {
      sysA.primaryOrbit.updateMass(0.5);
      sysA.primaryOrbit.updateMass(10);
    }
    sysA.primaryOrbit.updateMass(5);
    sysB.primaryOrbit.updateMass(5);

    settle(sysA.primaryOrbit);
    settle(sysB.primaryOrbit);

    const a = sysA.primaryOrbit.getParams();
    const b = sysB.primaryOrbit.getParams();
    assert.ok(Math.abs(a.semiMajorAxis - b.semiMajorAxis) < 1e-9,
      `半长轴不一致：往返 ${a.semiMajorAxis} vs 直接 ${b.semiMajorAxis}`);
    assert.ok(Math.abs(a.period - b.period) < 1e-9,
      `周期不一致：往返 ${a.period} vs 直接 ${b.period}`);
    assert.ok(Math.abs(a.eccentricity - b.eccentricity) < 1e-9);
    assert.ok(Math.abs(a.inclination - b.inclination) < 1e-9);
  });

  it('同一质量重复设定是幂等的', () => {
    const sysA = createBinarySystem({ seed: 23, starDistance: 30 });
    const sysB = createBinarySystem({ seed: 23, starDistance: 30 });

    sysA.primaryOrbit.updateMass(8);
    sysB.primaryOrbit.updateMass(8);
    sysB.primaryOrbit.updateMass(8);
    sysB.primaryOrbit.updateMass(8);

    settle(sysA.primaryOrbit);
    settle(sysB.primaryOrbit);

    const a = sysA.primaryOrbit.getParams();
    const b = sysB.primaryOrbit.getParams();
    assert.ok(Math.abs(a.semiMajorAxis - b.semiMajorAxis) < 1e-9);
    assert.ok(Math.abs(a.period - b.period) < 1e-9);
  });
});
