// 链路 1：质量改变后的轨道半径与周期重算。
// 覆盖质量最小/最大边界（0.5 / 10）与钳位边界（0 -> 0.1），
// 验证半长轴、周期、行星位置在边界下仍有限、无 NaN、无除零。
import { suite, test, assert } from './harness';
import {
  makeOrbit,
  makeRealStar,
  getParams,
  getTargetParams,
  settle,
  step,
  planetPosition,
  vectorFinite,
  expectedSemiMajorAxis,
  expectedPeriod
} from './helpers';

const BASE_A = 4;
const BOUNDARY_MASSES = [0.5, 10, 0.1, 0];

suite('质量边界');

test('质量取边界值时半长轴与周期收敛到独立公式期望值', () => {
  for (const mass of BOUNDARY_MASSES) {
    const { orbit } = makeOrbit(BASE_A, Math.PI / 6, 3);
    orbit.updateMass(mass);
    settle(orbit);

    const params = getParams(orbit);
    const expectedA = expectedSemiMajorAxis(BASE_A, mass);
    const expectedP = expectedPeriod(mass, expectedA);

    assert.close(params.semiMajorAxis, expectedA, 1e-9, `mass=${mass} 半长轴未收敛`);
    assert.close(params.period, expectedP, 1e-9, `mass=${mass} 周期未收敛`);
    assert.close(getTargetParams(orbit).period, expectedP, 1e-12, `mass=${mass} 目标周期错误`);
  }
});

test('边界质量下长时推进无 NaN/Infinity 且行星位置有界', () => {
  for (const mass of BOUNDARY_MASSES) {
    const { orbit } = makeOrbit(BASE_A, Math.PI / 6, 3);
    orbit.updateMass(mass);
    settle(orbit);
    step(orbit, 600, 1 / 60, 1);

    const params = getParams(orbit);
    const expectedA = expectedSemiMajorAxis(BASE_A, mass);
    const e = params.eccentricity;

    assert.finite(params.period, `mass=${mass} 周期出现非有限值`);
    assert.finite(params.trueAnomaly, `mass=${mass} 近点角出现非有限值`);
    assert.between(params.trueAnomaly, 0, Math.PI * 2, `mass=${mass} 近点角越界`);
    assert.between(e, 0, 1, `mass=${mass} 偏心率越界`);

    const pos = planetPosition(orbit);
    assert.ok(vectorFinite(pos), `mass=${mass} 行星位置出现 NaN/Infinity`);
    const r = pos.length();
    const rMin = expectedA * (1 - e);
    const rMax = expectedA * (1 + e);
    assert.between(r, rMin * 0.99, rMax * 1.01, `mass=${mass} 行星半径 ${r} 超出 [${rMin}, ${rMax}]`);
  }
});

test('半长轴随质量单调递增、周期在低质量段单调递减', () => {
  const masses = [0.5, 1, 2, 3, 5, 7.5, 10];
  const settled = masses.map(mass => {
    const { orbit } = makeOrbit(BASE_A, Math.PI / 6, 3);
    orbit.updateMass(mass);
    settle(orbit);
    return getParams(orbit);
  });
  for (let i = 1; i < masses.length; i++) {
    assert.ok(
      settled[i].semiMajorAxis > settled[i - 1].semiMajorAxis,
      `半长轴未随质量递增：m=${masses[i - 1]} -> ${masses[i]}`
    );
  }
  // 模型中周期 p = 2*sqrt(a^3/m) 且 a 随质量增长，p 在 m≈4.75 附近取极小，
  // 因此只在低质量段（m<=3）断言单调递减，全段公式一致性由上一用例覆盖。
  const lowMasses = [0.5, 1, 2, 3];
  const lowSettled = lowMasses.map(mass => {
    const { orbit } = makeOrbit(BASE_A, Math.PI / 6, 3);
    orbit.updateMass(mass);
    settle(orbit);
    return getParams(orbit);
  });
  for (let i = 1; i < lowMasses.length; i++) {
    assert.ok(
      lowSettled[i].period < lowSettled[i - 1].period,
      `低质量段周期未随质量递减：m=${lowMasses[i - 1]} -> ${lowMasses[i]}`
    );
  }
});

test('恒星视觉参数在质量边界下被钳位且有限', () => {
  for (const mass of BOUNDARY_MASSES) {
    const star = makeRealStar(3);
    star.updateMass(mass);
    for (let i = 0; i < 600; i++) star.update(1 / 60);

    assert.finite(star.light.intensity, `mass=${mass} 光强非有限`);
    assert.ok(star.light.intensity >= 1, `mass=${mass} 光强低于下限`);

    const scale = star.mesh.scale.x;
    assert.finite(scale, `mass=${mass} 缩放非有限`);
    assert.between(scale, 0.5, 2.5, `mass=${mass} 缩放越界`);
    assert.finite(star.getRadius(), `mass=${mass} 半径非有限`);
  }
});
