// 风险二：跨越整周期时真实近点角正确回绕，行星位置连续；
// 风险四之几何：轨道线重建后采样点严格满足椭圆方程。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createBinarySystem,
  settle,
  runFrames,
  ellipseRadius,
  isFiniteVector
} from './helpers.ts';

const TWO_PI = Math.PI * 2;

describe('真实近点角回绕', () => {
  it('长时间推进后近点角始终落在 [0, 2π)，且至少发生两次回绕', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 123, starDistance: 30 });
    settle(primaryOrbit);

    let wraps = 0;
    let previousAnomaly = primaryOrbit.getParams().trueAnomaly;
    const dt = 1 / 60;
    for (let frame = 0; frame < 3000; frame++) {
      primaryOrbit.update(dt, 1);
      const anomaly = primaryOrbit.getParams().trueAnomaly;
      assert.ok(anomaly >= 0 && anomaly < TWO_PI, `第 ${frame} 帧近点角 ${anomaly} 越界`);
      if (anomaly < previousAnomaly - Math.PI) wraps++;
      previousAnomaly = anomaly;
    }
    assert.ok(wraps >= 2, `预期至少两次回绕，实际 ${wraps} 次`);
  });

  it('回绕前后行星位置连续，不出现跨圆跳跃', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 5, starDistance: 30 });
    settle(primaryOrbit);

    let previousPos = primaryOrbit.star.planet.position.clone();
    const dt = 1 / 60;
    let maxJump = 0;
    for (let frame = 0; frame < 3000; frame++) {
      primaryOrbit.update(dt, 1);
      const pos = primaryOrbit.star.planet.position;
      const jump = pos.distanceTo(previousPos);
      maxJump = Math.max(maxJump, jump);
      previousPos.copy(pos);
    }
    // 单帧角位移约 0.011 rad，最大半径约 4.6；0.15 已留足余量，回绕跳跃应与普通帧同量级
    assert.ok(maxJump < 0.15, `帧间最大位置跳跃 ${maxJump} 超过连续性阈值`);
  });

  it('推进恰好一个周期后行星回到出发点附近', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 55, starDistance: 30 });
    settle(primaryOrbit);
    const period = primaryOrbit.getParams().period;

    const startPos = primaryOrbit.star.planet.position.clone();
    const dt = 1 / 60;
    runFrames(primaryOrbit, Math.round(period / dt), dt, 1);
    const endPos = primaryOrbit.star.planet.position;

    const error = startPos.distanceTo(endPos);
    assert.ok(error < 0.15, `一个周期后位置偏差 ${error} 过大（起点 ${startPos.toArray()}，终点 ${endPos.toArray()}）`);
  });
});

describe('轨道线几何重建', () => {
  it('128 个采样点有限且严格满足椭圆方程，包围球半径等于远拱点', () => {
    const { primaryOrbit } = createBinarySystem({ seed: 3, starDistance: 30 });
    primaryOrbit.updateMass(7);
    settle(primaryOrbit);
    runFrames(primaryOrbit, 10, 1 / 60, 1);

    const params = primaryOrbit.getParams();
    const positions = primaryOrbit.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    assert.equal(positions.count, 128);

    let maxRadius = 0;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
      assert.ok(isFiniteVector(p), `采样点 ${i} 非有限`);
      const angle = (i / positions.count) * TWO_PI;
      const expected = ellipseRadius(params.semiMajorAxis, params.eccentricity, angle);
      assert.ok(Math.abs(p.length() - Math.abs(expected)) < 1e-5,
        `采样点 ${i} 到焦点距离 ${p.length()} 与椭圆公式 ${expected} 不符`);
      maxRadius = Math.max(maxRadius, p.length());
    }
    const apocenter = params.semiMajorAxis * (1 + params.eccentricity);
    assert.ok(Math.abs(maxRadius - apocenter) < 1e-3,
      `包围球采样最大半径 ${maxRadius} 与远拱点 ${apocenter} 不符`);
    assert.ok(Number.isFinite(primaryOrbit.labelSprite.position.length()), '标签位置必须有限');
  });
});

describe('确定性：固定种子后轨迹可复现', () => {
  it('相同种子的两个实例每帧行星位置完全一致，不同种子初值不同', () => {
    const sysA = createBinarySystem({ seed: 2024, starDistance: 30 });
    const sysB = createBinarySystem({ seed: 2024, starDistance: 30 });
    const sysC = createBinarySystem({ seed: 2025, starDistance: 30 });

    assert.deepEqual(
      sysA.primaryOrbit.getParams(),
      sysB.primaryOrbit.getParams()
    );
    assert.notDeepEqual(
      sysA.primaryOrbit.getParams().trueAnomaly,
      sysC.primaryOrbit.getParams().trueAnomaly
    );

    const dt = 1 / 60;
    for (let frame = 0; frame < 600; frame++) {
      sysA.primaryOrbit.update(dt, 1);
      sysB.primaryOrbit.update(dt, 1);
      assert.deepEqual(
        sysA.primaryOrbit.star.planet.position.toArray(),
        sysB.primaryOrbit.star.planet.position.toArray(),
        `第 ${frame} 帧相同种子的行星位置发散`
      );
    }
  });
});
