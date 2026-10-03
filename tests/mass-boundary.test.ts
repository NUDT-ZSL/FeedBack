// 风险一：质量取边界/退化值时，轨道半径、周期、行星位置仍需有限且落在合理范围。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createBinarySystem,
  settle,
  expectedPeriod,
  expectedSemiMajorAxis,
  isFiniteVector
} from './helpers.ts';

const BASE_SMA = 4;
const BASE_ECCENTRICITY = 0.15;
const MASS_MIN = 0.5; // GUI 滑块下界
const MASS_MAX = 10; // GUI 滑块上界

function orbitLinePoints(orbit: ReturnType<typeof createBinarySystem>['primaryOrbit']): THREE.BufferAttribute {
  return orbit.line.geometry.getAttribute('position') as THREE.BufferAttribute;
}

function assertOrbitLineFinite(orbit: ReturnType<typeof createBinarySystem>['primaryOrbit']): void {
  const positions = orbitLinePoints(orbit);
  for (let i = 0; i < positions.count; i++) {
    assert.ok(
      Number.isFinite(positions.getX(i)) &&
        Number.isFinite(positions.getY(i)) &&
        Number.isFinite(positions.getZ(i)),
      `轨道线第 ${i} 个采样点出现非有限值`
    );
  }
}

describe('质量边界：GUI 滑块最小/最大质量', () => {
  for (const mass of [MASS_MIN, MASS_MAX]) {
    it(`质量=${mass} 时半径/周期与公式一致，行星位置有限且在轨道包络内`, () => {
      const { primaryOrbit } = createBinarySystem({ seed: 42 });
      primaryOrbit.updateMass(mass);
      settle(primaryOrbit);

      const params = primaryOrbit.getParams();
      const expectedSMA = expectedSemiMajorAxis(BASE_SMA, mass);
      assert.ok(Math.abs(params.semiMajorAxis - expectedSMA) < 1e-9,
        `半长轴应收敛到 ${expectedSMA}，实际 ${params.semiMajorAxis}`);
      assert.ok(Math.abs(params.period - expectedPeriod(mass, expectedSMA)) < 1e-9,
        `周期应收敛到 ${expectedPeriod(mass, expectedSMA)}，实际 ${params.period}`);
      assert.ok(params.period > 0 && Number.isFinite(params.period), '周期必须为正的有限值');

      const planetPos = primaryOrbit.star.planet.position;
      assert.ok(isFiniteVector(planetPos), '行星位置必须有限');
      const distance = planetPos.length();
      const minR = expectedSMA * (1 - BASE_ECCENTRICITY);
      const maxR = expectedSMA * (1 + BASE_ECCENTRICITY);
      assert.ok(distance >= minR - 1e-6 && distance <= maxR + 1e-6,
        `行星距焦点 ${distance} 应落在 [${minR}, ${maxR}] 内`);

      assertOrbitLineFinite(primaryOrbit);
    });
  }

  it('质量全量程扫描（0.5~10，步长0.1）参数始终有限且在包络内', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 7 });
    for (let m = MASS_MIN; m <= MASS_MAX + 1e-9; m += 0.1) {
      primaryOrbit.updateMass(m);
      settle(primaryOrbit, 0.1, 60);
      const params = primaryOrbit.getParams();
      assert.ok(Number.isFinite(params.semiMajorAxis) && Number.isFinite(params.period),
        `质量 ${m.toFixed(1)} 下参数出现非有限值`);
      assert.ok(params.semiMajorAxis >= 3.2 - 1e-9 && params.semiMajorAxis <= 6.24 + 1e-9,
        `质量 ${m.toFixed(1)} 下半长轴 ${params.semiMajorAxis} 超出 [3.2, 6.24]`);
      assert.ok(params.period > 0, `质量 ${m.toFixed(1)} 下周期必须为正`);
      assert.ok(isFiniteVector(primaryOrbit.star.planet.position),
        `质量 ${m.toFixed(1)} 下行星位置出现非有限值`);
    }
    assertOrbitLineFinite(primaryOrbit);
  });
});

describe('质量边界：退化输入的除零/NaN 防护', () => {
  for (const mass of [0, -1, -100]) {
    it(`质量=${mass} 时不产生 NaN/Infinity`, () => {
      const { primaryOrbit } = createBinarySystem({ seed: 9 });
      primaryOrbit.updateMass(mass);
      settle(primaryOrbit);

      const params = primaryOrbit.getParams();
      assert.ok(Number.isFinite(params.semiMajorAxis), '半长轴必须有限');
      assert.ok(Number.isFinite(params.period), '周期必须有限（除零保护）');
      assert.ok(isFiniteVector(primaryOrbit.star.planet.position), '行星位置必须有限');
      assertOrbitLineFinite(primaryOrbit);
    });
  }
});
