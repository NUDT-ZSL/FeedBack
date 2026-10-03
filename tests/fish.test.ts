import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { FishManager } from '../src/fish';

const CLUSTER_CENTERS = [
  new THREE.Vector3(-8, 2, -6),
  new THREE.Vector3(7, 3, 5),
  new THREE.Vector3(0, 2, 10),
];

function makeManager(): FishManager {
  const scene = new THREE.Scene();
  return new FishManager(scene, CLUSTER_CENTERS.map(c => c.clone()));
}

function simulate(manager: FishManager, seconds: number, params?: { temperature?: number; turbidity?: number; lightIntensity?: number }): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  const temperature = params?.temperature ?? 25;
  const turbidity = params?.turbidity ?? 10;
  const lightIntensity = params?.lightIntensity ?? 80;
  for (let i = 0; i < steps; i++) {
    manager.update(dt, i * dt, temperature, turbidity, lightIntensity, 60);
  }
}

describe('鱼群游动链路 (fish)', () => {
  let manager: FishManager;

  beforeEach(() => {
    manager = makeManager();
  });

  it('初始生成 30 条鱼，fishCount 与实际数量一致', () => {
    expect(manager.fishes).toHaveLength(30);
    expect(manager.fishCount).toBe(30);
    expect(manager.smallSchool).toBe(false);
  });

  it('数量切换往返一致：30→15→30，不残留聚集目标', () => {
    manager.toggleSchoolSize();
    expect(manager.fishes).toHaveLength(15);
    expect(manager.fishCount).toBe(15);
    expect(manager.smallSchool).toBe(true);

    manager.toggleSchoolSize();
    expect(manager.fishes).toHaveLength(30);
    expect(manager.fishCount).toBe(30);
    expect(manager.smallSchool).toBe(false);

    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
  });

  it('连续多次往返切换数量始终在 15/30 间收敛，不出现只增不减', () => {
    const expected = [15, 30, 15, 30, 15, 30];
    for (const count of expected) {
      manager.toggleSchoolSize();
      simulate(manager, 0.5);
      expect(manager.fishes).toHaveLength(count);
      expect(manager.fishCount).toBe(count);
    }
  });

  it('切换后鱼群场景对象无泄漏：场景中的鱼体数量与鱼数一致', () => {
    const scene = manager.scene;
    const countFishGroups = () => scene.children.filter(c => manager.fishes.some(f => f.group === c)).length;
    expect(countFishGroups()).toBe(30);
    manager.toggleSchoolSize();
    expect(countFishGroups()).toBe(15);
    manager.toggleSchoolSize();
    expect(countFishGroups()).toBe(30);
  });

  it('聚集状态在 2 秒后收敛：isGathering 全部归零且无残留聚集目标', () => {
    const target = new THREE.Vector3(3, 4, 5);
    for (const fish of manager.fishes) {
      fish.startGathering(target);
    }
    expect(manager.fishes.every(f => f.isGathering)).toBe(true);

    simulate(manager, 3);

    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
  });

  it('聚集期间鱼群向目标点靠拢（平均距离显著减小）', () => {
    const target = new THREE.Vector3(0, 3, 0);
    const avgDistance = () =>
      manager.fishes.reduce((sum, f) => sum + f.position.distanceTo(target), 0) / manager.fishes.length;

    const before = avgDistance();
    for (const fish of manager.fishes) {
      fish.startGathering(target);
    }
    simulate(manager, 1.8);
    const during = avgDistance();
    expect(during).toBeLessThan(before * 0.85);
  });

  it('长时间推进后所有鱼位置保持在场景边界内', () => {
    simulate(manager, 20);
    for (const fish of manager.fishes) {
      expect(fish.position.x).toBeGreaterThanOrEqual(-30);
      expect(fish.position.x).toBeLessThanOrEqual(30);
      expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
      expect(fish.position.y).toBeLessThanOrEqual(20);
      expect(fish.position.z).toBeGreaterThanOrEqual(-30);
      expect(fish.position.z).toBeLessThanOrEqual(30);
    }
  });

  it('游动中的鱼朝向与速度方向一致（点积接近 1）', () => {
    simulate(manager, 5);
    const forward = new THREE.Vector3();
    const velocityDir = new THREE.Vector3();
    let checked = 0;
    for (const fish of manager.fishes) {
      if (fish.velocity.length() < 0.1) continue;
      fish.group.getWorldDirection(forward);
      velocityDir.copy(fish.velocity).normalize();
      expect(forward.dot(velocityDir)).toBeGreaterThan(0.9);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('鱼的位置与朝向在长时间模拟后均为有限值（无 NaN）', () => {
    simulate(manager, 15, { temperature: 35, turbidity: 90, lightIntensity: 10 });
    for (const fish of manager.fishes) {
      expect(Number.isFinite(fish.position.x)).toBe(true);
      expect(Number.isFinite(fish.position.y)).toBe(true);
      expect(Number.isFinite(fish.position.z)).toBe(true);
      const q = fish.group.quaternion;
      expect(Number.isFinite(q.x)).toBe(true);
      expect(Number.isFinite(q.y)).toBe(true);
      expect(Number.isFinite(q.z)).toBe(true);
      expect(Number.isFinite(q.w)).toBe(true);
    }
  });

  it('水温对游速单调影响：35°C 快于 25°C 快于 15°C', () => {
    const speedAt = (temp: number) => {
      const m = makeManager();
      simulate(m, 1, { temperature: temp });
      return m.fishes.reduce((sum, f) => sum + f.currentSpeed, 0) / m.fishes.length;
    };
    const slow = speedAt(15);
    const mid = speedAt(25);
    const fast = speedAt(35);
    expect(mid).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(mid);
  });

  it('浑浊度高于 70 时鱼体渐隐至 0.4，恢复后回到不透明', () => {
    simulate(manager, 3, { turbidity: 90 });
    for (const fish of manager.fishes) {
      expect(fish.baseOpacity).toBe(0.4);
      for (const mat of fish.materials) {
        expect(mat.opacity).toBeLessThan(0.6);
        expect(mat.transparent).toBe(true);
      }
    }

    simulate(manager, 1, { turbidity: 10 });
    for (const fish of manager.fishes) {
      expect(fish.baseOpacity).toBe(1.0);
      for (const mat of fish.materials) {
        expect(mat.opacity).toBe(1.0);
        expect(mat.transparent).toBe(false);
      }
    }
  });

  it('光照低于 30 触发生物荧光，恢复光照后荧光移除', () => {
    simulate(manager, 1, { lightIntensity: 10 });
    for (const fish of manager.fishes) {
      expect(fish.bioFluorescent).toBe(true);
      expect(fish.bioLights.length).toBeGreaterThan(0);
    }

    simulate(manager, 1, { lightIntensity: 80 });
    for (const fish of manager.fishes) {
      expect(fish.bioFluorescent).toBe(false);
      expect(fish.bioLights).toHaveLength(0);
    }
  });

  it('reset 后鱼群回到 30 条、非小鱼群模式且无聚集残留', () => {
    manager.toggleSchoolSize();
    const target = new THREE.Vector3(1, 2, 3);
    for (const fish of manager.fishes) {
      fish.startGathering(target);
    }

    manager.reset(CLUSTER_CENTERS.map(c => c.clone()));

    expect(manager.fishes).toHaveLength(30);
    expect(manager.fishCount).toBe(30);
    expect(manager.smallSchool).toBe(false);
    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
  });
});
