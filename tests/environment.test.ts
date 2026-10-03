import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  EnvironmentManager,
  DEFAULT_WATER_PARAMS,
  WATER_PARAM_RANGES,
} from '../src/environment';
import { createSimulation, advance, FIXED_DT } from './harness';

function createEnv(): EnvironmentManager {
  return new EnvironmentManager(new THREE.Scene());
}

describe('水质参数链路 - 默认值与边界', () => {
  it('初始参数为默认值 (25°C / 80 / 10)', () => {
    const env = createEnv();
    expect(env.params).toEqual(DEFAULT_WATER_PARAMS);
  });

  it('光照端点 0/100 映射到灯光强度端点', () => {
    const env = createEnv();
    env.setLightIntensity(0);
    expect(env.params.lightIntensity).toBe(0);
    expect(env.ambientLight.intensity).toBe(0);
    expect(env.directionalLight.intensity).toBe(0);

    env.setLightIntensity(100);
    expect(env.params.lightIntensity).toBe(100);
    expect(env.ambientLight.intensity).toBeCloseTo(0.5, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(1.0, 10);
  });

  it('光照对可见量(灯光强度)单调递增', () => {
    const env = createEnv();
    const samples = [0, 25, 50, 75, 100].map((v) => {
      env.setLightIntensity(v);
      return { ambient: env.ambientLight.intensity, directional: env.directionalLight.intensity };
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].ambient).toBeGreaterThan(samples[i - 1].ambient);
      expect(samples[i].directional).toBeGreaterThan(samples[i - 1].directional);
    }
  });

  it('浑浊度端点 0/100 映射到雾密度端点', () => {
    const env = createEnv();
    env.setTurbidity(0);
    expect(env.scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect((env.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.01, 10);

    env.setTurbidity(100);
    expect((env.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.06, 10);
  });

  it('浑浊度对雾密度单调递增、对粒子不透明度单调不增且不低于 0.2', () => {
    const env = createEnv();
    const densities: number[] = [];
    const opacities: number[] = [];
    for (const v of [0, 25, 50, 75, 100]) {
      env.setTurbidity(v);
      densities.push((env.scene.fog as THREE.FogExp2).density);
      opacities.push((env.waterParticles.material as THREE.PointsMaterial).opacity);
    }
    for (let i = 1; i < densities.length; i++) {
      expect(densities[i]).toBeGreaterThan(densities[i - 1]);
      expect(opacities[i]).toBeLessThanOrEqual(opacities[i - 1]);
    }
    for (const opacity of opacities) {
      expect(opacity).toBeGreaterThanOrEqual(0.2);
      expect(opacity).toBeLessThanOrEqual(0.4);
    }
  });

  it('越界输入被钳制到区间内', () => {
    const env = createEnv();

    env.setTemperature(WATER_PARAM_RANGES.temperature.min - 20);
    expect(env.params.temperature).toBe(WATER_PARAM_RANGES.temperature.min);
    env.setTemperature(WATER_PARAM_RANGES.temperature.max + 20);
    expect(env.params.temperature).toBe(WATER_PARAM_RANGES.temperature.max);

    env.setLightIntensity(-50);
    expect(env.params.lightIntensity).toBe(0);
    expect(env.ambientLight.intensity).toBe(0);
    env.setLightIntensity(250);
    expect(env.params.lightIntensity).toBe(100);
    expect(env.directionalLight.intensity).toBeCloseTo(1.0, 10);

    env.setTurbidity(-10);
    expect(env.params.turbidity).toBe(0);
    expect((env.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.01, 10);
    env.setTurbidity(500);
    expect(env.params.turbidity).toBe(100);
    expect((env.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.06, 10);
  });

  it('非有限输入被忽略，参数保持不变', () => {
    const env = createEnv();
    env.setTemperature(Number.NaN);
    expect(env.params.temperature).toBe(DEFAULT_WATER_PARAMS.temperature);
    env.setLightIntensity(Number.POSITIVE_INFINITY);
    expect(env.params.lightIntensity).toBe(DEFAULT_WATER_PARAMS.lightIntensity);
    env.setTurbidity(Number.NaN);
    expect(env.params.turbidity).toBe(DEFAULT_WATER_PARAMS.turbidity);
  });

  it('reset 后参数与可见量回到初始一致状态', () => {
    const env = createEnv();
    const initialFog = (env.scene.fog as THREE.FogExp2).density;
    const initialOpacity = (env.waterParticles.material as THREE.PointsMaterial).opacity;

    env.setTemperature(35);
    env.setLightIntensity(0);
    env.setTurbidity(100);
    env.reset();

    expect(env.params).toEqual(DEFAULT_WATER_PARAMS);
    expect(env.ambientLight.intensity).toBeCloseTo(0.5 * 0.8, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(0.8, 10);
    expect((env.scene.fog as THREE.FogExp2).density).toBeCloseTo(initialFog, 10);
    expect((env.waterParticles.material as THREE.PointsMaterial).opacity).toBeCloseTo(initialOpacity, 10);
    expect(env.jellyfish.length).toBe(20);
    expect(env.jellyfishLights.length).toBe(20);
  });
});

describe('水质参数链路 - 模拟推进下的悬浮与粒子', () => {
  it('水母悬浮高度围绕基准值波动且不越界', () => {
    const sim = createSimulation();
    const track = sim.environment.jellyfish.map(() => ({ min: Infinity, max: -Infinity }));

    advance(sim, 40, FIXED_DT, (s) => {
      s.environment.jellyfish.forEach((jf, i) => {
        track[i].min = Math.min(track[i].min, jf.position.y);
        track[i].max = Math.max(track[i].max, jf.position.y);
      });
    });

    sim.environment.jellyfish.forEach((jf, i) => {
      const baseY = jf.userData.baseY as number;
      expect(track[i].min).toBeGreaterThanOrEqual(baseY - 1 - 1e-6);
      expect(track[i].max).toBeLessThanOrEqual(baseY + 1 + 1e-6);
      expect(track[i].max - track[i].min).toBeGreaterThan(1.0);
      expect(jf.position.y).toBeGreaterThan(0);
      expect(jf.position.y).toBeLessThan(30);
    });
  });

  it('水母点光源跟随水母位置', () => {
    const sim = createSimulation();
    advance(sim, 2);
    sim.environment.jellyfish.forEach((jf, i) => {
      const light = sim.environment.jellyfishLights[i];
      expect(light.position.y).toBeCloseTo(jf.position.y, 6);
    });
  });

  it('水粒子在 [-5, 50] 高度区间内循环', () => {
    const sim = createSimulation();
    advance(sim, 10, FIXED_DT, (s) => {
      const arr = s.environment.waterParticles.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < arr.length / 3; i++) {
        const y = arr[i * 3 + 1];
        expect(y).toBeGreaterThanOrEqual(-5);
        expect(y).toBeLessThanOrEqual(50);
      }
    });
  });
});
