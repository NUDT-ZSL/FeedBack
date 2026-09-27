import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import './helpers';
import { CoralManager } from '../src/coral';

describe('CoralManager 珊瑚生长与重置', () => {
  let scene: THREE.Scene;
  let manager: CoralManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new CoralManager(scene);
  });

  it('生成 6 种 x 9 株 = 54 株珊瑚，计数一致', () => {
    expect(manager.corals.length).toBe(54);
    expect(manager.coralCount).toBe(54);
    const types = new Set(manager.corals.map((c) => c.type));
    expect(types.size).toBe(6);
  });

  it('光照 100 时生长 3 秒后达到完整高度', () => {
    const coral = manager.corals[0];
    const heights: number[] = [];
    for (let i = 0; i < 40; i++) {
      coral.update(0.1, i * 0.1, 100, 25);
      heights.push(coral.currentHeight);
    }
    // 生长速率 delta * (0.5 + 100/200) = 0.1/帧，30 帧后长满
    expect(coral.growthTime).toBeGreaterThanOrEqual(coral.growthDuration);
    expect(coral.currentHeight).toBeCloseTo(coral.baseHeight, 5);
    expect(coral.group.scale.x).toBeCloseTo(1, 5);
    // 生长过程单调不减
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    }
  });

  it('光照 0 时生长速度减半但不出现 NaN', () => {
    const coral = manager.corals[0];
    for (let i = 0; i < 30; i++) {
      coral.update(0.1, i * 0.1, 0, 25);
    }
    // 速率 0.5x -> 30 帧仅长到一半进度
    expect(coral.growthTime).toBeCloseTo(1.5, 5);
    expect(coral.currentHeight).toBeLessThan(coral.baseHeight);
    expect(coral.currentHeight).toBeGreaterThan(0);
    expect(Number.isFinite(coral.currentHeight)).toBe(true);
    expect(Number.isFinite(coral.group.scale.x)).toBe(true);
  });

  it('摆动幅度有界：rotation 不超出 swayAmplitude 派生范围', () => {
    const coral = manager.corals[0];
    for (let i = 0; i < 100; i++) {
      coral.update(0.05, i * 0.05, 80, 25);
      expect(Math.abs(coral.group.rotation.z)).toBeLessThanOrEqual(coral.swayAmplitude * 0.3 + 1e-9);
      expect(Math.abs(coral.group.rotation.x)).toBeLessThanOrEqual(coral.swayAmplitude * 0.2 + 1e-9);
    }
  });

  it('温度驱动饱和度且钳制在 [0.3, 1.0]', () => {
    const coral = manager.corals[0];
    coral.update(0.1, 0, 80, 25);
    expect(coral.baseSaturation).toBeCloseTo(1.0, 10);

    coral.update(0.1, 0, 80, 35);
    expect(coral.baseSaturation).toBeCloseTo(0.75, 10);

    coral.update(0.1, 0, 80, 15);
    expect(coral.baseSaturation).toBeCloseTo(0.75, 10);

    // 极端温度不越界、不 NaN
    coral.update(0.1, 0, 80, 1000);
    expect(coral.baseSaturation).toBe(0.3);
    coral.update(0.1, 0, 80, -1000);
    expect(coral.baseSaturation).toBe(0.3);
    expect(Number.isFinite(coral.baseSaturation)).toBe(true);
  });

  it('重置后生长进度归零、数量不变', () => {
    // 先让所有珊瑚生长一段时间
    manager.update(2, 2, 100, 25);
    expect(manager.corals.some((c) => c.growthTime > 0)).toBe(true);

    manager.reset();
    expect(manager.corals.length).toBe(54);
    expect(manager.coralCount).toBe(54);
    for (const coral of manager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }
  });

  it('连续多次重置后计数与场景子节点不累积', () => {
    manager.reset();
    const childrenAfterFirstReset = scene.children.length;

    for (let i = 0; i < 5; i++) {
      manager.update(1, i, 80, 25);
      manager.reset();
      expect(manager.coralCount).toBe(54);
      expect(manager.corals.length).toBe(54);
      expect(scene.children.length).toBe(childrenAfterFirstReset);
    }
  });
});
