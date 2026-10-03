// 链路 3：行星沿椭圆轨道推进。
// 验证跨越整周期时真实近点角正确回绕到 [0, 2π)，且回绕前后行星位置连续；
// 大时间步（一帧跨多个周期）下同样满足模运算回绕。
import { suite, test, assert } from './harness';
import { makeOrbit, getParams, settle, setTrueAnomaly, planetPosition, vectorFinite } from './helpers';

const TWO_PI = Math.PI * 2;
const DT = 1 / 60;

suite('近点角回绕与位置连续');

test('回绕瞬间近点角落在 [0, 2π) 且行星位置不跳变', () => {
  const { orbit } = makeOrbit(4, Math.PI / 6, 3);
  settle(orbit);

  const params = getParams(orbit);
  const angularVelocity = TWO_PI / params.period;
  const overflow = 0.01;
  setTrueAnomaly(orbit, TWO_PI - overflow);
  orbit.update(0, 0); // 同步行星位置到刚设置的近点角

  const beforePos = planetPosition(orbit).clone();
  orbit.update(DT, 1);

  assert.between(params.trueAnomaly, 0, TWO_PI, '回绕后近点角越界');
  const expected = ((TWO_PI - overflow) + angularVelocity * DT) % TWO_PI;
  assert.close(params.trueAnomaly, expected, 1e-9, '回绕后近点角数值不正确');

  const afterPos = planetPosition(orbit);
  assert.ok(vectorFinite(afterPos), '回绕后行星位置出现 NaN');
  const jump = afterPos.distanceTo(beforePos);
  // 回绕是角度表示上的跳变，物理位置只应移动正常一帧的小弧长。
  assert.between(jump, 0, 0.05, `回绕处位置跳变 ${jump} 异常`);
});

test('沿轨道推进整数个周期后回到同一位置（轨道闭合）', () => {
  const { orbit } = makeOrbit(4, Math.PI / 6, 3);
  settle(orbit);
  const period = getParams(orbit).period;
  setTrueAnomaly(orbit, 0.73);
  orbit.update(0, 0);
  const startPos = planetPosition(orbit).clone();

  // 选取整除 3 个周期的步长，消除取整帧造成的伪漂移。
  const frames = Math.ceil((period * 3) / 0.01);
  const dt = (period * 3) / frames;
  for (let i = 0; i < frames; i++) orbit.update(dt, 1);

  const drift = planetPosition(orbit).distanceTo(startPos);
  assert.ok(drift < 1e-5, `推进 3 个周期后位置漂移 ${drift}（应为 0）`);
  assert.between(getParams(orbit).trueAnomaly, 0, TWO_PI, '近点角越界');
});

test('一帧跨越大时间步时近点角按模回绕且位置有限连续', () => {
  const { orbit } = makeOrbit(4, Math.PI / 6, 3);
  settle(orbit);
  const period = getParams(orbit).period;

  setTrueAnomaly(orbit, 0.1);
  orbit.update(0, 0);
  const beforePos = planetPosition(orbit).clone();
  orbit.update(period * 10 + period * 0.25, 1);

  assert.between(getParams(orbit).trueAnomaly, 0, TWO_PI, '大时间步后近点角越界');
  assert.close(getParams(orbit).trueAnomaly, 0.1 + TWO_PI * 0.25, 1e-9, '大时间步回绕相位错误');
  assert.ok(vectorFinite(planetPosition(orbit)), '大时间步后位置非有限');

  const displacement = planetPosition(orbit).distanceTo(beforePos);
  assert.finite(displacement, '大时间步位置位移非有限');
});
