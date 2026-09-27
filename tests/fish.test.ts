import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { fakeWindow, allFinite } from './helpers';
import { FishManager } from '../src/fish';

const CENTERS = [
  new THREE.Vector3(-10, 0, -10),
  new THREE.Vector3(10, 0, -5),
  new THREE.Vector3(0, 0, 12),
];

function createManager(scene: THREE.Scene): FishManager {
  return new FishManager(scene, CENTERS.map((c) => c.clone()));
}

describe('FishManager 边界与重置', () => {
  let scene: THREE.Scene;
  let manager: FishManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = createManager(scene);
  });

  it('极端参数下限/上限长时间运行不越界、不出现 NaN', () => {
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += 0.05;
      manager.update(0.05, t, 35, 100, 0, 60);
    }
    for (const fish of manager.fishes) {
      expect(allFinite([fish.position, fish.velocity])).toBe(true);
      expect(fish.position.x).toBeGreaterThanOrEqual(-30);
      expect(fish.position.x).toBeLessThanOrEqual(30);
      expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
      expect(fish.position.y).toBeLessThanOrEqual(20);
      expect(fish.position.z).toBeGreaterThanOrEqual(-30);
      expect(fish.position.z).toBeLessThanOrEqual(30);
      expect(Number.isFinite(fish.currentSpeed)).toBe(true);
    }
  });

  it('光照低于 30 触发生物荧光，恢复后光源移除', () => {
    manager.update(0.016, 0, 25, 10, 20, 60);
    for (const fish of manager.fishes) {
      expect(fish.bioFluorescent).toBe(true);
      expect(fish.bioLights.length).toBe(1);
    }
    manager.update(0.016, 0.016, 25, 10, 80, 60);
    for (const fish of manager.fishes) {
      expect(fish.bioFluorescent).toBe(false);
      expect(fish.bioLights.length).toBe(0);
    }
  });

  it('浑浊度高于 70 鱼体透明度降至 0.4，恢复后回到 1', () => {
    manager.update(0.016, 0, 25, 80, 80, 60);
    for (const fish of manager.fishes) expect(fish.baseOpacity).toBe(0.4);
    manager.update(0.016, 0.016, 25, 10, 80, 60);
    for (const fish of manager.fishes) expect(fish.baseOpacity).toBe(1.0);
  });

  it('低帧率时跳帧：偶数帧槽位不更新鱼位置', () => {
    const before = manager.fishes.map((f) => f.position.clone());
    // time = 0 -> floor(0*60)=0 为偶数 -> 跳帧
    manager.update(0.1, 0, 35, 10, 80, 20);
    manager.fishes.forEach((fish, i) => {
      expect(fish.position.equals(before[i])).toBe(true);
    });
  });

  it('切换鱼群数量：30 -> 15 -> 30，计数同步', () => {
    manager.toggleSchoolSize();
    expect(manager.smallSchool).toBe(true);
    expect(manager.fishes.length).toBe(15);
    expect(manager.fishCount).toBe(15);

    manager.toggleSchoolSize();
    expect(manager.smallSchool).toBe(false);
    expect(manager.fishes.length).toBe(30);
    expect(manager.fishCount).toBe(30);
  });

  it('重置后位置/速度/数量恢复初始且连续重置不累积', () => {
    let t = 0;
    for (let i = 0; i < 50; i++) {
      t += 0.1;
      manager.update(0.1, t, 35, 10, 80, 60);
    }
    manager.toggleSchoolSize(); // 缩到 15 条

    manager.reset(CENTERS.map((c) => c.clone()));
    expect(manager.fishes.length).toBe(30);
    expect(manager.fishCount).toBe(30);
    expect(manager.smallSchool).toBe(false);
    for (const fish of manager.fishes) {
      expect(fish.velocity.length()).toBe(0);
      expect(fish.isGathering).toBe(false);
      expect(allFinite([fish.position])).toBe(true);
    }

    const childrenAfterReset = scene.children.length;
    for (let i = 0; i < 5; i++) {
      manager.reset(CENTERS.map((c) => c.clone()));
      expect(manager.fishes.length).toBe(30);
      expect(manager.fishCount).toBe(30);
      expect(scene.children.length).toBe(childrenAfterReset);
    }
  });
});

describe('FishManager 鱼群游动与聚集', () => {
  let scene: THREE.Scene;
  let manager: FishManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = createManager(scene);
  });

  it('初始 30 条鱼，三种各 10 条，计数一致', () => {
    expect(manager.fishes.length).toBe(30);
    expect(manager.fishCount).toBe(30);
    const byType = new Map<string, number>();
    for (const f of manager.fishes) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
    expect([...byType.values()].sort()).toEqual([10, 10, 10]);
  });

  it('温度联动鱼速：25°C 基准，35°C 加速，15°C 减速', () => {
    const fish = manager.fishes[0];
    fish.update(0.016, 0, 25, 10, 80);
    expect(fish.currentSpeed).toBeCloseTo(fish.baseSpeed, 5);

    fish.update(0.016, 0.016, 35, 10, 80);
    expect(fish.currentSpeed).toBeCloseTo(fish.baseSpeed * 1.6, 5);

    fish.update(0.016, 0.032, 15, 10, 80);
    expect(fish.currentSpeed).toBeCloseTo(fish.baseSpeed * 0.4, 5);
  });

  it('点击触发聚集：速度翻倍并在 2 秒后退出聚集状态', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    camera.position.set(0, 20, 40);
    camera.lookAt(0, 3, 0);
    camera.updateMatrixWorld(true);
    (fakeWindow as unknown as Record<string, unknown>)._camera = camera;

    fakeWindow.dispatch('click', {
      clientX: fakeWindow.innerWidth / 2,
      clientY: fakeWindow.innerHeight / 2,
    });

    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(true);
      expect(fish.gatherTarget).not.toBeNull();
    }

    manager.update(0.016, 0, 25, 10, 80, 60);
    for (const fish of manager.fishes) {
      expect(fish.currentSpeed).toBeCloseTo(fish.baseSpeed * 2, 5);
    }

    // 推进 2.5 秒模拟时间，聚集计时器(2s)应全部到期
    let t = 0;
    for (let i = 0; i < 25; i++) {
      t += 0.1;
      manager.update(0.1, t, 25, 10, 80, 60);
    }
    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
      expect(fish.currentSpeed).toBeCloseTo(fish.baseSpeed, 5);
    }
  });

  it('聚集目标消失后鱼回到贝塞尔路径且状态有限', () => {
    const target = new THREE.Vector3(0, 5, 0);
    for (const fish of manager.fishes) fish.startGathering(target);
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 0.1;
      manager.update(0.1, t, 25, 10, 80, 60);
    }
    for (const fish of manager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
      expect(allFinite([fish.position, fish.velocity])).toBe(true);
      expect(fish.bezierProgress).toBeGreaterThanOrEqual(0);
      expect(fish.bezierProgress).toBeLessThanOrEqual(1);
    }
  });
});
