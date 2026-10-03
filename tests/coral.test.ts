import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Coral, CoralManager } from '../src/coral';
import { createSimulation, advance } from './harness';

const CORAL_TOTAL = 6 * 9;

describe('珊瑚生长链路 - 初始状态', () => {
  it('珊瑚数量为 6 类 × 9 = 54', () => {
    const sim = createSimulation();
    expect(sim.coralManager.coralCount).toBe(CORAL_TOTAL);
    expect(sim.coralManager.corals.length).toBe(CORAL_TOTAL);
    expect(sim.coralManager.getClusterCenters().length).toBe(3);
  });

  it('新生成的珊瑚生长进度为零', () => {
    const sim = createSimulation();
    for (const coral of sim.coralManager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }
  });
});

describe('珊瑚生长链路 - 单调性与上限', () => {
  it('生长进度与当前高度随时间单调不减', () => {
    const sim = createSimulation();
    sim.environment.setLightIntensity(80);

    const tracked = sim.coralManager.corals.slice(0, 10);
    let prevGrowth = tracked.map(() => -1);
    let prevHeight = tracked.map(() => -1);

    advance(sim, 2.5, 1 / 60, () => {
      tracked.forEach((coral, i) => {
        expect(coral.growthTime).toBeGreaterThanOrEqual(prevGrowth[i] - 1e-9);
        expect(coral.currentHeight).toBeGreaterThanOrEqual(prevHeight[i] - 1e-9);
        prevGrowth[i] = coral.growthTime;
        prevHeight[i] = coral.currentHeight;
      });
    });
  });

  it('生长高度不超过基准高度，缩放不超过 1', () => {
    const sim = createSimulation();
    sim.environment.setLightIntensity(100);
    advance(sim, 30);
    for (const coral of sim.coralManager.corals) {
      expect(coral.currentHeight).toBeLessThanOrEqual(coral.baseHeight + 1e-9);
      expect(coral.currentHeight).toBeGreaterThanOrEqual(0);
      expect(coral.group.scale.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(coral.growthTime).toBeGreaterThanOrEqual(coral.growthDuration - 1e-9);
      expect(coral.currentHeight).toBeCloseTo(coral.baseHeight, 6);
    }
  });

  it('高光照下生长快于最低光照', () => {
    const dark = new Coral('brain', new THREE.Vector3(), 3);
    const bright = new Coral('brain', new THREE.Vector3(), 3);
    for (let i = 0; i < 60; i++) {
      dark.update(1 / 60, i / 60, 0, 25);
      bright.update(1 / 60, i / 60, 100, 25);
    }
    expect(bright.growthTime).toBeGreaterThan(dark.growthTime);
    expect(bright.currentHeight).toBeGreaterThan(dark.currentHeight);
  });

  it('最低光照下仍以基准速率持续生长', () => {
    const coral = new Coral('tube', new THREE.Vector3(), 2);
    advanceCoral(coral, 2, 0);
    expect(coral.growthTime).toBeCloseTo(1.0, 5);
    expect(coral.currentHeight).toBeGreaterThan(0);
  });

  it('水温端点与越界温度下饱和度均落在 [0.3, 1.0]，25°C 最饱和', () => {
    const samples = new Map<number, number>();
    for (const temp of [-100, 15, 25, 35, 100]) {
      const coral = new Coral('star', new THREE.Vector3(), 1);
      coral.update(1 / 60, 0, 80, temp);
      expect(coral.baseSaturation).toBeGreaterThanOrEqual(0.3);
      expect(coral.baseSaturation).toBeLessThanOrEqual(1.0);
      samples.set(temp, coral.baseSaturation);
    }
    expect(samples.get(25)).toBeCloseTo(1.0, 9);
    expect(samples.get(25)).toBeGreaterThan(samples.get(15)!);
    expect(samples.get(25)).toBeGreaterThan(samples.get(35)!);
  });
});

describe('珊瑚生长链路 - 重置', () => {
  it('reset 后数量一致且生长进度全部归零', () => {
    const sim = createSimulation();
    sim.environment.setLightIntensity(100);
    advance(sim, 30);
    expect(sim.coralManager.corals.every((c) => c.currentHeight > 0)).toBe(true);

    sim.coralManager.reset();

    expect(sim.coralManager.coralCount).toBe(CORAL_TOTAL);
    expect(sim.coralManager.corals.length).toBe(CORAL_TOTAL);
    expect(sim.coralManager.getClusterCenters().length).toBe(3);
    for (const coral of sim.coralManager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }

    sim.environment.setLightIntensity(80);
    advance(sim, 1);
    expect(sim.coralManager.corals.every((c) => c.currentHeight > 0)).toBe(true);
  });
});

function advanceCoral(coral: Coral, seconds: number, light: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    coral.update(1 / 60, i / 60, light, 25);
  }
}
