import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FishManager } from '../src/fish';
import { step, expectVectorFinite } from './helpers';

const CENTERS = [
  new THREE.Vector3(-5, 0, -5),
  new THREE.Vector3(5, 0, -5),
  new THREE.Vector3(0, 0, 5),
];

function makeFish(): FishManager {
  return new FishManager(new THREE.Scene(), CENTERS.map(c => c.clone()));
}

function update(fm: FishManager, frames: number, delta: number, temp = 25, turb = 10, light = 80): void {
  step(frames, delta, (d, t) => fm.update(d, t, temp, turb, light, 60));
}

describe('FishManager 数量与重置一致性', () => {
  it('初始 30 条鱼，fishCount 与内部数组一致', () => {
    const fm = makeFish();
    expect(fm.fishes.length).toBe(30);
    expect(fm.fishCount).toBe(fm.fishes.length);
  });

  it('切换鱼群数量在 15/30 间切换且计数一致', () => {
    const fm = makeFish();
    fm.toggleSchoolSize();
    expect(fm.fishes.length).toBe(15);
    expect(fm.fishCount).toBe(15);
    fm.toggleSchoolSize();
    expect(fm.fishes.length).toBe(30);
    expect(fm.fishCount).toBe(30);
  });

  it('连续多次重置后数量不累积、位置在边界内且无 NaN', () => {
    const fm = makeFish();
    update(fm, 120, 1 / 60);
    for (let i = 0; i < 5; i++) {
      fm.reset(CENTERS.map(c => c.clone()));
      expect(fm.fishes.length).toBe(30);
      expect(fm.fishCount).toBe(30);
      expect(fm.smallSchool).toBe(false);
      update(fm, 60, 1 / 60);
      for (const fish of fm.fishes) {
        expectVectorFinite(fish.position, 'fish.position');
        expectVectorFinite(fish.velocity, 'fish.velocity');
        expect(Math.abs(fish.position.x)).toBeLessThanOrEqual(30);
        expect(Math.abs(fish.position.z)).toBeLessThanOrEqual(30);
        expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
        expect(fish.position.y).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('鱼群聚集行为', () => {
  it('聚集时速度加倍并向目标靠近，计时结束后退出聚集', () => {
    const fm = makeFish();
    const target = new THREE.Vector3(0, 5, 0);
    fm.fishes.forEach(f => f.startGathering(target));
    const before = fm.fishes.map(f => f.position.distanceTo(target));
    update(fm, 30, 1 / 30);
    fm.fishes.forEach((f, i) => {
      expect(f.isGathering).toBe(true);
      expect(f.currentSpeed).toBeCloseTo(f.baseSpeed * 2, 5);
      expect(f.position.distanceTo(target)).toBeLessThan(before[i]);
    });
    // 聚集持续 2 秒后应退出并清空目标
    update(fm, 90, 1 / 30);
    fm.fishes.forEach(f => {
      expect(f.isGathering).toBe(false);
      expect(f.gatherTarget).toBeNull();
    });
  });

  it('温度变化线性影响游动速度', () => {
    const fm = makeFish();
    update(fm, 5, 1 / 60, 35);
    fm.fishes.forEach(f => {
      expect(f.currentSpeed).toBeCloseTo(f.baseSpeed * 1.6, 5);
    });
    update(fm, 5, 1 / 60, 15);
    fm.fishes.forEach(f => {
      expect(f.currentSpeed).toBeCloseTo(f.baseSpeed * 0.4, 5);
    });
  });
});
describe('水质对鱼群的影响与边界', () => {
  it('浑浊度高于 70 时鱼体透明度下降，恢复后回到不透明', () => {
    const fm = makeFish();
    update(fm, 120, 1 / 30, 25, 90);
    fm.fishes.forEach(f => {
      expect(f.baseOpacity).toBe(0.4);
      f.materials.forEach(m => {
        expect(m.transparent).toBe(true);
        expect(m.opacity).toBeLessThan(0.9);
      });
    });
    update(fm, 30, 1 / 30, 25, 10);
    fm.fishes.forEach(f => {
      expect(f.baseOpacity).toBe(1.0);
      f.materials.forEach(m => expect(m.opacity).toBe(1.0));
    });
  });

  it('光照低于 30 时开启生物荧光，恢复后移除光源', () => {
    const fm = makeFish();
    update(fm, 10, 1 / 60, 25, 10, 20);
    fm.fishes.forEach(f => {
      expect(f.bioFluorescent).toBe(true);
      expect(f.bioLights.length).toBe(1);
    });
    update(fm, 10, 1 / 60, 25, 10, 80);
    fm.fishes.forEach(f => {
      expect(f.bioFluorescent).toBe(false);
      expect(f.bioLights.length).toBe(0);
    });
  });

  it('参数取极值时长时间模拟不出现 NaN 或越界', () => {
    const fm = makeFish();
    const extremes: Array<[number, number, number]> = [
      [15, 0, 0],
      [35, 100, 100],
      [35, 100, 0],
      [15, 0, 100],
    ];
    for (const [temp, turb, light] of extremes) {
      update(fm, 300, 1 / 30, temp, turb, light);
      fm.fishes.forEach(f => {
        expectVectorFinite(f.position, 'fish.position');
        expectVectorFinite(f.velocity, 'fish.velocity');
        expect(Number.isFinite(f.currentSpeed)).toBe(true);
        expect(f.currentSpeed).toBeGreaterThan(0);
      });
    }
  });

  it('点击事件触发全体聚集（通过 window._camera 替身）', () => {
    const fm = makeFish();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    camera.position.set(0, 20, 40);
    camera.lookAt(0, 3, 0);
    camera.updateMatrixWorld(true);
    (window as any)._camera = camera;
    window.dispatchEvent(new window.MouseEvent('click', {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
    }));
    fm.fishes.forEach(f => expect(f.isGathering).toBe(true));
    delete (window as any)._camera;
  });
});
