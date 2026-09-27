import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CoralManager } from '../src/coral';
import { step } from './helpers';

function makeCorals(): CoralManager {
  return new CoralManager(new THREE.Scene());
}

describe('CoralManager 生长与重置', () => {
  it('初始生成 54 株珊瑚（6 种 x 9），生长进度从零开始', () => {
    const cm = makeCorals();
    expect(cm.coralCount).toBe(54);
    expect(cm.corals.length).toBe(54);
    for (const coral of cm.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }
  });

  it('生长动画随时间推进并最终达到基准高度', () => {
    const cm = makeCorals();
    step(60, 1 / 60, (d, t) => cm.update(d, t, 80, 25));
    const early = cm.corals[0];
    expect(early.growthTime).toBeGreaterThan(0);
    expect(early.currentHeight).toBeGreaterThan(0);
    expect(early.currentHeight).toBeLessThanOrEqual(early.baseHeight);
    step(60 * 30, 1 / 60, (d, t) => cm.update(d, t, 80, 25));
    for (const coral of cm.corals) {
      expect(coral.currentHeight).toBeCloseTo(coral.baseHeight, 5);
      expect(coral.group.scale.x).toBeCloseTo(1, 5);
    }
  });

  it('光照越强生长越快', () => {
    const bright = makeCorals();
    const dark = makeCorals();
    step(60, 1 / 60, (d, t) => bright.update(d, t, 100, 25));
    step(60, 1 / 60, (d, t) => dark.update(d, t, 0, 25));
    expect(bright.corals[0].growthTime).toBeGreaterThan(dark.corals[0].growthTime);
  });
});
describe('CoralManager 重置与边界', () => {
  it('重置后生长状态归零且计数不累积（连续多次）', () => {
    const cm = makeCorals();
    step(120, 1 / 60, (d, t) => cm.update(d, t, 80, 25));
    for (let i = 0; i < 5; i++) {
      cm.reset();
      expect(cm.coralCount).toBe(54);
      expect(cm.corals.length).toBe(54);
      for (const coral of cm.corals) {
        expect(coral.growthTime).toBe(0);
        expect(coral.currentHeight).toBe(0);
      }
      step(30, 1 / 60, (d, t) => cm.update(d, t, 80, 25));
    }
    expect(cm.coralCount).toBe(54);
  });

  it('重置后聚集中心数量保持为 3', () => {
    const cm = makeCorals();
    expect(cm.getClusterCenters().length).toBe(3);
    cm.reset();
    expect(cm.getClusterCenters().length).toBe(3);
  });

  it('极端温度下饱和度仍在 [0.3, 1.0] 且无 NaN', () => {
    const cm = makeCorals();
    for (const temp of [15, 25, 35]) {
      step(10, 1 / 60, (d, t) => cm.update(d, t, 80, temp));
      for (const coral of cm.corals) {
        expect(Number.isFinite(coral.baseSaturation)).toBe(true);
        expect(coral.baseSaturation).toBeGreaterThanOrEqual(0.3);
        expect(coral.baseSaturation).toBeLessThanOrEqual(1.0);
      }
    }
    step(10, 1 / 60, (d, t) => cm.update(d, t, 80, 25));
    expect(cm.corals[0].baseSaturation).toBeCloseTo(1.0);
  });
});
