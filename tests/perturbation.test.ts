// 风险三：双星距离进入/离开扰动阈值（10 单位）时，偏心率与倾角的动态项
// 必须平滑收敛，不允许单帧跳变；远离阈值后应回归基础值。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBinarySystem, settle } from './helpers.ts';

const BASE_ECCENTRICITY = 0.15;
const INCLINATION = (30 * Math.PI) / 180;
const DT = 1 / 60;

describe('扰动阈值平滑性', () => {
  it('距离 30（阈值外）时偏心率/倾角稳定在基础值', () => {
    const sys = createBinarySystem({ seed: 11, starDistance: 30 });
    settle(sys.primaryOrbit, DT, 600);

    const samples = [];
    for (let i = 0; i < 300; i++) {
      sys.primaryOrbit.update(DT, 1);
      const p = sys.primaryOrbit.getParams();
      samples.push(p.eccentricity, p.inclination);
    }
    const eccentricities = samples.filter((_, i) => i % 2 === 0);
    const inclinations = samples.filter((_, i) => i % 2 === 1);

    assert.ok(Math.abs(Math.max(...eccentricities) - BASE_ECCENTRICITY) < 0.01);
    assert.ok(Math.abs(Math.min(...eccentricities) - BASE_ECCENTRICITY) < 0.01);
    assert.ok(Math.max(...inclinations) - Math.min(...inclinations) < 0.01);
  });

  it('进入阈值（30→5）后动态项平滑放大，无单帧跳变，且扰动确实生效', () => {
    const sys = createBinarySystem({ seed: 12, starDistance: 30 });
    settle(sys.primaryOrbit, DT, 600);
    sys.setStarDistance(5);

    let previous = sys.primaryOrbit.getParams();
    let maxEJump = 0;
    let maxIJump = 0;
    const eccentricities: number[] = [];
    const inclinations: number[] = [];

    for (let i = 0; i < 600; i++) {
      sys.primaryOrbit.update(DT, 1);
      const p = sys.primaryOrbit.getParams();
      maxEJump = Math.max(maxEJump, Math.abs(p.eccentricity - previous.eccentricity));
      maxIJump = Math.max(maxIJump, Math.abs(p.inclination - previous.inclination));
      assert.ok(p.eccentricity > 0 && p.eccentricity < 0.3,
        `偏心率 ${p.eccentricity} 越过物理安全范围`);
      eccentricities.push(p.eccentricity);
      inclinations.push(p.inclination);
      previous = p;
    }

    // 理论动态振幅 0.25*0.3=0.075；若出现直接赋值会有约 0.075 的瞬时跳变
    assert.ok(maxEJump < 0.02, `偏心率单帧最大变化 ${maxEJump} 超出平滑阈值`);
    assert.ok(maxIJump < 0.02, `倾角单帧最大变化 ${maxIJump} 超出平滑阈值`);
    // 扰动生效：10 秒内应观察到明显周期振荡，而非保持基础值
    const eRange = Math.max(...eccentricities) - Math.min(...eccentricities);
    const iRange = Math.max(...inclinations) - Math.min(...inclinations);
    assert.ok(eRange > 0.05, `扰动下偏心率振荡幅度 ${eRange} 过小`);
    assert.ok(iRange > 0.05, `扰动下倾角振荡幅度 ${iRange} 过小`);
  });

  it('离开阈值（5→30）后动态项平滑收敛回基础值', () => {
    const sys = createBinarySystem({ seed: 13, starDistance: 30 });
    settle(sys.primaryOrbit, DT, 600);
    sys.setStarDistance(5);
    for (let i = 0; i < 600; i++) sys.primaryOrbit.update(DT, 1);
    sys.setStarDistance(30);

    let previous = sys.primaryOrbit.getParams();
    let maxEJump = 0;
    for (let i = 0; i < 1200; i++) {
      sys.primaryOrbit.update(DT, 1);
      const p = sys.primaryOrbit.getParams();
      maxEJump = Math.max(maxEJump, Math.abs(p.eccentricity - previous.eccentricity));
      previous = p;
    }

    assert.ok(maxEJump < 0.02, `撤离阈值时偏心率单帧最大变化 ${maxEJump} 超出平滑阈值`);
    const final = sys.primaryOrbit.getParams();
    assert.ok(Math.abs(final.eccentricity - BASE_ECCENTRICITY) < 0.01,
      `偏心率应收敛回 ${BASE_ECCENTRICITY}，实际 ${final.eccentricity}`);
    assert.ok(Math.abs(final.inclination - INCLINATION) < 0.01,
      `倾角应收敛回 ${INCLINATION}，实际 ${final.inclination}`);
  });

  it('在阈值边界附近（12→8）连续扫过距离，偏心率/倾角无跳变', () => {
    const sys = createBinarySystem({ seed: 14, starDistance: 12 });
    settle(sys.primaryOrbit, DT, 300);

    let previous = sys.primaryOrbit.getParams();
    for (let d = 12; d >= 8; d -= 0.05) {
      sys.setStarDistance(d);
      sys.primaryOrbit.update(DT, 1);
      const p = sys.primaryOrbit.getParams();
      assert.ok(Math.abs(p.eccentricity - previous.eccentricity) < 0.02,
        `距离 ${d.toFixed(2)} 处偏心率跳变`);
      assert.ok(Math.abs(p.inclination - previous.inclination) < 0.02,
        `距离 ${d.toFixed(2)} 处倾角跳变`);
      previous = p;
    }
  });
});
