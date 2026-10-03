// 链路 1 补充：反复来回调整质量后，轨道参数必须与直接设定到目标值一致，
// 即 updateMass 的结果只依赖当前质量而不依赖调整历史（无路径依赖）。
import { suite, test, assert } from './harness';
import { resetSeed } from './shims';
import {
  makeOrbit,
  getParams,
  getTargetParams,
  settle,
  step,
  expectedSemiMajorAxis,
  expectedPeriod
} from './helpers';

const DT = 1 / 60;
const SEQUENCE = [0.5, 10, 0.5, 10, 3, 7.7, 0.5, 3, 10, 3];
// 每段 1200 帧使插值残差降到 ~1e-18，远小于 1e-9 比较容差。
const FRAMES_PER_SEGMENT = 1200;

function buildOrbit(seed: number): ReturnType<typeof makeOrbit> {
  resetSeed(seed);
  return makeOrbit(4, Math.PI / 6, 3, -1000, 1000);
}

suite('反复调质量稳定性');

test('来回调整质量后收敛结果与直接设定一致（静止）', () => {
  const wiggled = buildOrbit(42);
  for (const mass of SEQUENCE) {
    wiggled.orbit.updateMass(mass);
    step(wiggled.orbit, FRAMES_PER_SEGMENT, DT, 0);
  }

  const direct = buildOrbit(42);
  direct.orbit.updateMass(3);
  step(direct.orbit, FRAMES_PER_SEGMENT * SEQUENCE.length, DT, 0);

  const a = getParams(wiggled.orbit);
  const b = getParams(direct.orbit);
  assert.close(a.semiMajorAxis, b.semiMajorAxis, 1e-9, '半长轴存在历史依赖');
  assert.close(a.period, b.period, 1e-9, '周期存在历史依赖');

  const ta = getTargetParams(wiggled.orbit);
  const tb = getTargetParams(direct.orbit);
  assert.close(ta.semiMajorAxis, tb.semiMajorAxis, 1e-12, '目标半长轴不一致');
  assert.close(ta.period, tb.period, 1e-12, '目标周期不一致');

  assert.close(ta.semiMajorAxis, expectedSemiMajorAxis(4, 3), 1e-12, '目标半长轴与公式不符');
  assert.close(ta.period, expectedPeriod(3, 4), 1e-12, '目标周期与公式不符');
});

test('重复设置同一质量幂等', () => {
  const { orbit } = buildOrbit(99);
  for (let k = 0; k < 20; k++) {
    orbit.updateMass(5);
    step(orbit, 60, DT, 0);
  }
  settle(orbit);

  const expectedA = expectedSemiMajorAxis(4, 5);
  const expectedP = expectedPeriod(5, expectedA);
  assert.close(getTargetParams(orbit).semiMajorAxis, expectedA, 1e-12, '重复设质量后半长轴错误');
  assert.close(getTargetParams(orbit).period, expectedP, 1e-12, '重复设质量后周期错误');
  assert.close(getParams(orbit).semiMajorAxis, expectedA, 1e-9, '重复设质量后半长轴未收敛');
  assert.close(getParams(orbit).period, expectedP, 1e-9, '重复设质量后周期未收敛');
});

test('运动中来回调整质量，最终轨道参数仍与直接设定一致', () => {
  const wiggled = buildOrbit(7);
  for (const mass of SEQUENCE) {
    wiggled.orbit.updateMass(mass);
    step(wiggled.orbit, FRAMES_PER_SEGMENT, DT, 1);
  }
  const direct = buildOrbit(7);
  direct.orbit.updateMass(3);
  step(direct.orbit, FRAMES_PER_SEGMENT * SEQUENCE.length, DT, 1);

  const a = getParams(wiggled.orbit);
  const b = getParams(direct.orbit);
  assert.close(a.semiMajorAxis, b.semiMajorAxis, 1e-9, '运动中半长轴存在历史依赖');
  assert.close(a.period, b.period, 1e-9, '运动中周期存在历史依赖');
  assert.close(a.eccentricity, b.eccentricity, 1e-9, '运动中偏心率不一致');
  assert.close(a.inclination, b.inclination, 1e-9, '运动中倾角不一致');
});
