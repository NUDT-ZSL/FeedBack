import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { EnvironmentManager } from '../src/environment';

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

describe('水质参数链路 (environment)', () => {
  let scene: THREE.Scene;
  let env: EnvironmentManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    env = new EnvironmentManager(scene);
  });

  it('初始参数为温度25/光照80/浑浊度10', () => {
    expect(env.params.temperature).toBe(25);
    expect(env.params.lightIntensity).toBe(80);
    expect(env.params.turbidity).toBe(10);
  });

  it('光照在区间端点 0 与 100 时可见光照量符合公式且不越界为负', () => {
    env.setLightIntensity(0);
    expect(env.ambientLight.intensity).toBeCloseTo(0, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(0, 10);

    env.setLightIntensity(100);
    expect(env.ambientLight.intensity).toBeCloseTo(0.5, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(1.0, 10);
  });

  it('光照对可见光照量呈严格单调影响（0→100 采样）', () => {
    const samples = [0, 10, 25, 50, 75, 100];
    const ambient: number[] = [];
    const directional: number[] = [];
    for (const v of samples) {
      env.setLightIntensity(v);
      ambient.push(env.ambientLight.intensity);
      directional.push(env.directionalLight.intensity);
    }
    for (let i = 1; i < ambient.length; i++) {
      expect(ambient[i]).toBeGreaterThan(ambient[i - 1]);
      expect(directional[i]).toBeGreaterThan(directional[i - 1]);
      expect(isFiniteNumber(ambient[i])).toBe(true);
      expect(isFiniteNumber(directional[i])).toBe(true);
    }
  });

  it('光照降到最低 0 时灯光强度归零（最低光照边界）', () => {
    env.setLightIntensity(80);
    env.setLightIntensity(0);
    expect(env.ambientLight.intensity).toBe(0);
    expect(env.directionalLight.intensity).toBe(0);
    expect(env.params.lightIntensity).toBe(0);
  });

  it('越界光照输入（-50/150）不产生 NaN，且单调方向保持一致', () => {
    const values = [-50, 0, 100, 150];
    const ambient: number[] = [];
    for (const v of values) {
      env.setLightIntensity(v);
      ambient.push(env.ambientLight.intensity);
      expect(isFiniteNumber(env.ambientLight.intensity)).toBe(true);
      expect(isFiniteNumber(env.directionalLight.intensity)).toBe(true);
    }
    for (let i = 1; i < ambient.length; i++) {
      expect(ambient[i]).toBeGreaterThanOrEqual(ambient[i - 1]);
    }
  });

  it('浑浊度在端点 0/100 时雾密度与粒子透明度符合预期', () => {
    env.setTurbidity(0);
    const fog0 = (scene.fog as THREE.FogExp2).density;
    const opacity0 = (env.waterParticles.material as THREE.PointsMaterial).opacity;
    expect(fog0).toBeCloseTo(0.01, 10);
    expect(opacity0).toBeCloseTo(0.4, 10);

    env.setTurbidity(100);
    const fog100 = (scene.fog as THREE.FogExp2).density;
    const opacity100 = (env.waterParticles.material as THREE.PointsMaterial).opacity;
    expect(fog100).toBeCloseTo(0.06, 10);
    expect(opacity100).toBeCloseTo(0.2, 10);
  });

  it('浑浊度对雾密度严格递增、对粒子透明度单调递减（含 0.2 下限钳制）', () => {
    const samples = [0, 20, 40, 60, 70, 80, 100];
    const densities: number[] = [];
    const opacities: number[] = [];
    for (const v of samples) {
      env.setTurbidity(v);
      densities.push((scene.fog as THREE.FogExp2).density);
      opacities.push((env.waterParticles.material as THREE.PointsMaterial).opacity);
    }
    for (let i = 1; i < densities.length; i++) {
      expect(densities[i]).toBeGreaterThan(densities[i - 1]);
      expect(opacities[i]).toBeLessThanOrEqual(opacities[i - 1] + 1e-12);
      expect(opacities[i]).toBeGreaterThanOrEqual(0.2 - 1e-12);
    }
  });

  it('越界浑浊度（-50/150）不产生 NaN，雾密度保持有限', () => {
    for (const v of [-50, 150]) {
      env.setTurbidity(v);
      expect(isFiniteNumber((scene.fog as THREE.FogExp2).density)).toBe(true);
      expect(isFiniteNumber((env.waterParticles.material as THREE.PointsMaterial).opacity)).toBe(true);
    }
  });

  it('水温区间端点 15/35 及越界值均被如实记录且为有限值', () => {
    for (const v of [15, 25, 35, 0, 50]) {
      env.setTemperature(v);
      expect(env.params.temperature).toBe(v);
    }
  });
});

describe('水母悬浮链路 (jellyfish)', () => {
  it('初始生成 20 只水母及配套点光源', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentManager(scene);
    expect(env.jellyfish).toHaveLength(20);
    expect(env.jellyfishLights).toHaveLength(20);
  });

  it('水母悬浮高度围绕基准高度波动，幅度不超过 ±1', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentManager(scene);

    for (const jf of env.jellyfish) {
      expect(jf.userData.baseY).toBeGreaterThanOrEqual(5);
      expect(jf.userData.baseY).toBeLessThanOrEqual(25);
    }

    for (let step = 0; step < 480; step++) {
      const time = step * 0.05;
      env.update(0.05, time);
      for (const jf of env.jellyfish) {
        const offset = jf.position.y - jf.userData.baseY;
        expect(Math.abs(offset)).toBeLessThanOrEqual(1 + 1e-9);
        expect(isFiniteNumber(jf.position.y)).toBe(true);
      }
    }
  });

  it('水母悬浮高度随时间真实波动（覆盖至少一个完整周期，出现上下两侧位移）', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentManager(scene);
    const target = env.jellyfish[0];
    // 位置公式为 baseY + sin(time / bobPeriod + phase)，真实周期为 2π × bobPeriod
    const truePeriod = 2 * Math.PI * target.userData.bobPeriod;
    const heights: number[] = [];

    for (let step = 0; step <= 400; step++) {
      const time = (step / 400) * truePeriod * 1.2;
      env.update(truePeriod * 1.2 / 400, time);
      heights.push(target.position.y);
    }

    const min = Math.min(...heights);
    const max = Math.max(...heights);
    expect(max - min).toBeGreaterThan(1.5);
    expect(min).toBeLessThan(target.userData.baseY);
    expect(max).toBeGreaterThan(target.userData.baseY);
  });

  it('水母点光源位置随水母移动同步', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentManager(scene);
    env.update(0.1, 2.3);
    for (let i = 0; i < env.jellyfish.length; i++) {
      expect(env.jellyfishLights[i].position.distanceTo(env.jellyfish[i].position)).toBeCloseTo(0, 6);
    }
  });
});
