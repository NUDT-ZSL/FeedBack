import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FishManager } from '../src/fish';
import { createSimulation, advance, FIXED_DT, Simulation } from './harness';

const FISH_TOTAL = 30;
const FISH_SMALL = 15;

function expectFishInBounds(sim: Simulation): void {
  for (const fish of sim.fishManager.fishes) {
    expect(Number.isFinite(fish.position.x)).toBe(true);
    expect(Number.isFinite(fish.position.y)).toBe(true);
    expect(Number.isFinite(fish.position.z)).toBe(true);
    expect(fish.position.x).toBeGreaterThanOrEqual(-30);
    expect(fish.position.x).toBeLessThanOrEqual(30);
    expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
    expect(fish.position.y).toBeLessThanOrEqual(20);
    expect(fish.position.z).toBeGreaterThanOrEqual(-30);
    expect(fish.position.z).toBeLessThanOrEqual(30);
    expect(fish.group.position.x).toBeCloseTo(fish.position.x, 6);
    expect(fish.group.position.y).toBeCloseTo(fish.position.y, 6);
    expect(fish.group.position.z).toBeCloseTo(fish.position.z, 6);
    const q = fish.group.quaternion;
    expect(Number.isFinite(q.x)).toBe(true);
    expect(Number.isFinite(q.y)).toBe(true);
    expect(Number.isFinite(q.z)).toBe(true);
    expect(Number.isFinite(q.w)).toBe(true);
    expect(q.length()).toBeCloseTo(1, 6);
  }
}

describe('鱼群链路 - 参数端点下的位置与朝向', () => {
  const corners: Array<[number, number, number]> = [
    [15, 0, 0],
    [35, 100, 100],
    [25, 80, 10],
  ];

  for (const [temperature, light, turbidity] of corners) {
    it(`温度=${temperature} 光照=${light} 浑浊度=${turbidity} 下 20s 内位置与朝向保持合理`, () => {
      const sim = createSimulation();
      sim.environment.setTemperature(temperature);
      sim.environment.setLightIntensity(light);
      sim.environment.setTurbidity(turbidity);
      advance(sim, 20, FIXED_DT, expectFishInBounds);
    });
  }
});

describe('鱼群链路 - 数量切换往返一致性', () => {
  it('初始为 30 条，切换为 15 条，再切回 30 条', () => {
    const sim = createSimulation();
    expect(sim.fishManager.fishCount).toBe(FISH_TOTAL);
    expect(sim.fishManager.fishes.length).toBe(FISH_TOTAL);

    sim.fishManager.toggleSchoolSize();
    expect(sim.fishManager.fishCount).toBe(FISH_SMALL);
    expect(sim.fishManager.fishes.length).toBe(FISH_SMALL);

    sim.fishManager.toggleSchoolSize();
    expect(sim.fishManager.fishCount).toBe(FISH_TOTAL);
    expect(sim.fishManager.fishes.length).toBe(FISH_TOTAL);
  });

  it('多次往返切换数量收敛，不只增不减', () => {
    const sim = createSimulation();
    const expected = [FISH_SMALL, FISH_TOTAL, FISH_SMALL, FISH_TOTAL, FISH_SMALL, FISH_TOTAL];
    for (const count of expected) {
      sim.fishManager.toggleSchoolSize();
      expect(sim.fishManager.fishCount).toBe(count);
      expect(sim.fishManager.fishes.length).toBe(count);
    }
    for (const fish of sim.fishManager.fishes) {
      expect(fish.group.parent).toBe(sim.scene);
    }
  });

  it('切换后继续推进模拟，位置仍在合理范围', () => {
    const sim = createSimulation();
    sim.fishManager.toggleSchoolSize();
    advance(sim, 5, FIXED_DT, expectFishInBounds);
    sim.fishManager.toggleSchoolSize();
    advance(sim, 5, FIXED_DT, expectFishInBounds);
    expect(sim.fishManager.fishCount).toBe(FISH_TOTAL);
  });

  it('聚集指令在 2s 后收敛，无残留聚集目标', () => {
    const sim = createSimulation();
    const target = new THREE.Vector3(5, 3, -5);
    for (const fish of sim.fishManager.fishes) {
      fish.startGathering(target);
    }
    expect(sim.fishManager.fishes.every((f) => f.isGathering)).toBe(true);

    advance(sim, 3);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
  });

  it('聚集过程中切换鱼群数量，剩余鱼群仍能收敛且无残留目标', () => {
    const sim = createSimulation();
    const target = new THREE.Vector3(0, 4, 0);
    for (const fish of sim.fishManager.fishes) {
      fish.startGathering(target);
    }

    sim.fishManager.toggleSchoolSize();
    expect(sim.fishManager.fishCount).toBe(FISH_SMALL);
    advance(sim, 3);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }

    sim.fishManager.toggleSchoolSize();
    expect(sim.fishManager.fishCount).toBe(FISH_TOTAL);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
    advance(sim, 5, FIXED_DT, expectFishInBounds);
  });
});

describe('鱼群链路 - 光照与浑浊度响应', () => {
  it('光照低于 30 触发荧光，恢复后移除', () => {
    const sim = createSimulation();
    sim.environment.setLightIntensity(10);
    advance(sim, 1);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.bioFluorescent).toBe(true);
      expect(fish.bioLights.length).toBe(1);
    }

    sim.environment.setLightIntensity(80);
    advance(sim, 1);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.bioFluorescent).toBe(false);
      expect(fish.bioLights.length).toBe(0);
    }
  });

  it('浑浊度高于 70 鱼体透明度下降，恢复后回到不透明', () => {
    const sim = createSimulation();
    sim.environment.setTurbidity(100);
    advance(sim, 5);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.baseOpacity).toBe(0.4);
      for (const mat of fish.materials) {
        expect(mat.opacity).toBeLessThan(0.9);
      }
    }

    sim.environment.setTurbidity(10);
    advance(sim, 1);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.baseOpacity).toBe(1.0);
      for (const mat of fish.materials) {
        expect(mat.opacity).toBe(1.0);
        expect(mat.transparent).toBe(false);
      }
    }
  });
});

describe('鱼群链路 - 重置', () => {
  it('reset 后数量回到 30 且小群标志清除', () => {
    const sim = createSimulation();
    sim.fishManager.toggleSchoolSize();
    expect(sim.fishManager.fishCount).toBe(FISH_SMALL);

    sim.fishManager.reset(sim.coralManager.getClusterCenters());
    expect(sim.fishManager.fishCount).toBe(FISH_TOTAL);
    expect(sim.fishManager.fishes.length).toBe(FISH_TOTAL);
    expect(sim.fishManager.smallSchool).toBe(false);
    for (const fish of sim.fishManager.fishes) {
      expect(fish.group.parent).toBe(sim.scene);
    }
    advance(sim, 5, FIXED_DT, expectFishInBounds);
  });
});
