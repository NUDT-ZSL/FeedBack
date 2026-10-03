import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { Coral, CoralManager } from '../src/coral';

function simulate(manager: CoralManager, seconds: number, lightIntensity = 80, temperature = 25): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    manager.update(dt, i * dt, lightIntensity, temperature);
  }
}

describe('珊瑚生长链路 (coral)', () => {
  let scene: THREE.Scene;
  let manager: CoralManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new CoralManager(scene);
  });

  it('初始生成 54 株珊瑚（6 种 × 9），coralCount 一致', () => {
    expect(manager.corals).toHaveLength(54);
    expect(manager.coralCount).toBe(54);
    const types = new Set(manager.corals.map(c => c.type));
    expect(types.size).toBe(6);
  });

  it('新生成的珊瑚生长进度为零', () => {
    for (const coral of manager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }
  });

  it('生长高度随时间单调不减，且不超过基准高度上限', () => {
    const dt = 1 / 60;
    let time = 0;
    for (let step = 0; step < 360; step++) {
      time += dt;
      manager.update(dt, time, 80, 25);
      for (const coral of manager.corals) {
        expect(coral.currentHeight).toBeLessThanOrEqual(coral.baseHeight + 1e-9);
      }
    }
  });

  it('生长进度在足够时间后收敛到基准高度（上限）', () => {
    simulate(manager, 10);
    for (const coral of manager.corals) {
      expect(coral.currentHeight).toBeGreaterThan(coral.baseHeight * 0.99);
      expect(coral.currentHeight).toBeLessThanOrEqual(coral.baseHeight + 1e-9);
      expect(coral.growthTime).toBeLessThanOrEqual(coral.growthDuration + 1 / 60);
    }
  });

  it('单株珊瑚生长曲线单调不减（逐帧采样）', () => {
    const coral = new Coral('staghorn', new THREE.Vector3(0, 0, 0), 3);
    const dt = 1 / 60;
    let previous = 0;
    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += dt;
      coral.update(dt, time, 80, 25);
      expect(coral.currentHeight).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = coral.currentHeight;
    }
    expect(coral.currentHeight).toBeCloseTo(3, 5);
  });

  it('光照越强生长越快：光照 100 的进度高于光照 0', () => {
    const bright = new Coral('brain', new THREE.Vector3(0, 0, 0), 2);
    const dark = new Coral('brain', new THREE.Vector3(0, 0, 0), 2);
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      bright.update(dt, i * dt, 100, 25);
      dark.update(dt, i * dt, 0, 25);
    }
    expect(bright.growthTime).toBeGreaterThan(dark.growthTime);
    expect(bright.currentHeight).toBeGreaterThan(dark.currentHeight);
  });

  it('温度偏离 25°C 时饱和度下降，且始终钳制在 [0.3, 1.0]', () => {
    const coral = new Coral('tube', new THREE.Vector3(0, 0, 0), 2);
    coral.update(1 / 60, 0, 80, 25);
    expect(coral.baseSaturation).toBeCloseTo(1.0, 10);

    coral.update(1 / 60, 0.1, 80, 35);
    expect(coral.baseSaturation).toBeLessThan(1.0);
    expect(coral.baseSaturation).toBeGreaterThan(0.3);

    coral.update(1 / 60, 0.2, 80, 15);
    expect(coral.baseSaturation).toBeLessThan(1.0);

    coral.update(1 / 60, 0.3, 80, 100);
    expect(coral.baseSaturation).toBe(0.3);

    coral.update(1 / 60, 0.4, 80, -50);
    expect(coral.baseSaturation).toBe(0.3);
  });

  it('reset 后珊瑚数量回到 54，所有生长进度归零', () => {
    simulate(manager, 10);
    expect(manager.corals.every(c => c.currentHeight > 0)).toBe(true);

    manager.reset();

    expect(manager.corals).toHaveLength(54);
    expect(manager.coralCount).toBe(54);
    for (const coral of manager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }
  });

  it('reset 后旧珊瑚对象从场景移除，无对象泄漏', () => {
    const oldCorals = [...manager.corals];
    manager.reset();
    for (const coral of oldCorals) {
      expect(scene.children.includes(coral.group)).toBe(false);
    }
    for (const coral of manager.corals) {
      expect(scene.children.includes(coral.group)).toBe(true);
    }
  });
});
