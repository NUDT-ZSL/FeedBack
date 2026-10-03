// 长时演化：在确定性伪随机脚本驱动下（固定种子），反复改质量、双星距离
// 反复穿越扰动阈值，验证 3600 帧内所有可观测量有限、不越界，
// 且两次运行采样结果逐位一致（可复现）。
import { suite, test, assert } from './harness';
import { resetSeed } from './shims';
import { makeOrbit, getParams, getPerturbation, planetPosition, vectorFinite } from './helpers';

const DT = 1 / 60;
const FRAMES = 3600;

function runTrial(seed: number): number[][] {
  resetSeed(seed);
  const { orbit, star, other } = makeOrbit(4, Math.PI / 6, 3, -20, 20);
  const samples: number[][] = [];

  for (let f = 0; f < FRAMES; f++) {
    if (f % 240 === 0) {
      const mass = 0.5 + Math.random() * 9.5;
      orbit.updateMass(mass);
      const distance = 2 + Math.random() * 16;
      other.group.position.x = star.group.position.x + distance;
    }
    orbit.update(DT, 1);

    const params = getParams(orbit);
    assert.finite(params.semiMajorAxis, `第 ${f} 帧半长轴非有限`);
    assert.finite(params.period, `第 ${f} 帧周期非有限`);
    assert.finite(params.eccentricity, `第 ${f} 帧偏心率非有限`);
    assert.finite(params.inclination, `第 ${f} 帧倾角非有限`);
    assert.finite(getPerturbation(orbit), `第 ${f} 帧扰动量非有限`);
    assert.between(params.trueAnomaly, 0, Math.PI * 2, `第 ${f} 帧近点角越界`);
    assert.between(params.eccentricity, 0, 1, `第 ${f} 帧偏心率越界`);
    assert.ok(params.period > 0, `第 ${f} 帧周期非正`);
    assert.ok(vectorFinite(planetPosition(orbit)), `第 ${f} 帧行星位置非有限`);

    if (f % 60 === 0) {
      const pos = planetPosition(orbit);
      samples.push([
        params.semiMajorAxis,
        params.eccentricity,
        params.inclination,
        params.period,
        params.trueAnomaly,
        pos.x,
        pos.y,
        pos.z
      ]);
    }
  }
  return samples;
}

suite('长时演化可复现');

test('固定种子下两次完整运行结果逐位一致', () => {
  const first = runTrial(20261004);
  const second = runTrial(20261004);
  assert.equal(first.length, second.length, '采样帧数不一致');
  for (let i = 0; i < first.length; i++) {
    for (let j = 0; j < first[i].length; j++) {
      assert.ok(
        Object.is(first[i][j], second[i][j]),
        `第 ${i} 个采样点第 ${j} 分量不一致：${first[i][j]} vs ${second[i][j]}`
      );
    }
  }
});

test('不同种子下长时演化均满足全局不变量', () => {
  runTrial(1);
  runTrial(987654321);
});
