// 链路 2：双星互相扰动下的偏心率与倾角演化。
// 双星距离进入/离开扰动阈值（10 单位）时，扰动量、偏心率、倾角
// 必须逐帧平滑过渡并收敛，不允许跳变或发散。
import { suite, test, assert } from './harness';
import { makeOrbit, getParams, getPerturbation, step, planetPosition, vectorFinite } from './helpers';

const DT = 1 / 60;
const BASE_E = 0.15;
const INCLINATION = Math.PI / 6;
// 理论单帧最大变化：lerpFactor=1/30，偏心率目标域最大跨度 0.3，扰动量最大跨度 0.5。
const MAX_E_STEP = 0.01;
const MAX_I_STEP = 0.01;
const MAX_P_STEP = 0.02;

interface FrameSample {
  e: number;
  i: number;
  p: number;
}

function sample(orbit: Parameters<typeof getParams>[0]): FrameSample {
  const params = getParams(orbit);
  return { e: params.eccentricity, i: params.inclination, p: getPerturbation(orbit) };
}

function assertSmooth(samples: FrameSample[], label: string): void {
  for (let k = 1; k < samples.length; k++) {
    const dE = Math.abs(samples[k].e - samples[k - 1].e);
    const dI = Math.abs(samples[k].i - samples[k - 1].i);
    const dP = Math.abs(samples[k].p - samples[k - 1].p);
    assert.ok(dE < MAX_E_STEP, `${label} 第 ${k} 帧偏心率跳变 ${dE}`);
    assert.ok(dI < MAX_I_STEP, `${label} 第 ${k} 帧倾角跳变 ${dI}`);
    assert.ok(dP < MAX_P_STEP, `${label} 第 ${k} 帧扰动量跳变 ${dP}`);
  }
}

suite('扰动阈值平滑收敛');

test('距离连续扫过阈值时扰动量/偏心率/倾角平滑且收敛', () => {
  const { orbit, other } = makeOrbit(4, INCLINATION, 3, 0, 15);
  const samples: FrameSample[] = [];

  // 连续 2400 帧：进入(15->4) -> 保持 -> 离开(4->15) -> 保持，全程逐帧采样。
  for (let f = 0; f < 2400; f++) {
    if (f < 600) {
      other.group.position.x = 15 - (11 * (f + 1)) / 600;
    } else if (f < 1200) {
      other.group.position.x = 4;
    } else if (f < 1800) {
      other.group.position.x = 4 + (11 * (f - 1200 + 1)) / 600;
    } else {
      other.group.position.x = 15;
    }
    orbit.update(DT, 0);
    samples.push(sample(orbit));
  }

  assertSmooth(samples, '距离扫描');

  // 进入后扰动量收敛到理论值 max(0, 1 - 4/10) * 0.5 = 0.3。
  const inside = samples[1199];
  assert.close(inside.p, 0.3, 1e-3, '扰动区内扰动量未收敛到 0.3');
  assert.ok(Math.abs(inside.e - BASE_E) <= 0.12, `扰动区内偏心率 ${inside.e} 超出预期波动范围`);

  // 离开后扰动消失，偏心率/倾角回到基准值。
  const last = samples[samples.length - 1];
  assert.ok(last.p < 1e-3, `离开阈值后扰动量未归零：${last.p}`);
  assert.close(last.e, BASE_E, 1e-3, '离开阈值后偏心率未回到基准值');
  assert.close(last.i, INCLINATION, 1e-3, '离开阈值后倾角未回到基准值');
});

test('距离瞬时跳变（进出阈值）也不引起输出跳变', () => {
  const { orbit, other } = makeOrbit(4, INCLINATION, 3, 0, 50);
  step(orbit, 600, DT, 0);

  // 瞬移进入扰动区。
  other.group.position.x = 3;
  const enterSamples: FrameSample[] = [sample(orbit)];
  for (let f = 0; f < 600; f++) {
    orbit.update(DT, 0);
    enterSamples.push(sample(orbit));
  }
  assertSmooth(enterSamples, '瞬移进入');
  assert.close(getPerturbation(orbit), 0.35, 1e-3, '进入后扰动量未收敛到 0.35');

  // 瞬移离开扰动区。
  other.group.position.x = 50;
  const leaveSamples: FrameSample[] = [sample(orbit)];
  for (let f = 0; f < 600; f++) {
    orbit.update(DT, 0);
    leaveSamples.push(sample(orbit));
  }
  assertSmooth(leaveSamples, '瞬移离开');
  assert.ok(getPerturbation(orbit) < 1e-3, '离开后扰动量未归零');
  assert.close(getParams(orbit).eccentricity, BASE_E, 1e-3, '离开后偏心率未回到基准值');
});

test('深度扰动下长时间演化保持有界且无 NaN', () => {
  const { orbit, other } = makeOrbit(4, INCLINATION, 3, 0, 2);
  for (let f = 0; f < 6000; f++) {
    orbit.update(DT, 1);
    const params = getParams(orbit);
    assert.finite(params.eccentricity, `第 ${f} 帧偏心率非有限`);
    assert.finite(params.inclination, `第 ${f} 帧倾角非有限`);
    assert.between(params.eccentricity, 0, 1, `第 ${f} 帧偏心率越界`);
    assert.between(params.trueAnomaly, 0, Math.PI * 2, `第 ${f} 帧近点角越界`);
    assert.ok(vectorFinite(planetPosition(orbit)), `第 ${f} 帧行星位置非有限`);
  }
});
