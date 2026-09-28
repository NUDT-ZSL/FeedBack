import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ambientLight = { intensity: 0.8 };

vi.mock('../src/core/SceneManager', () => ({
  sceneManager: {
    addObject: vi.fn(),
    removeObject: vi.fn(),
    getAmbientLight: () => ambientLight,
  },
}));

import { sceneManager } from '../src/core/SceneManager';
import { buildingSystem } from '../src/modules/building/BuildingSystem';
import { lightingController } from '../src/modules/lighting/LightingController';

// 用 setTimeout 驱动 requestAnimationFrame，配合 fake timers 确定性推进动画
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => {
  clearTimeout(id);
}) as typeof cancelAnimationFrame;

function clearAllBuildings(): void {
  for (const b of buildingSystem.getBuildings()) {
    buildingSystem.removeBuilding(b.id);
  }
}

function addBuildings(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = buildingSystem.addBuilding(i * 10, 0, 20 + i * 5, i);
    if (b) ids.push(b.id);
  }
  return ids;
}

beforeEach(() => {
  clearAllBuildings();
  lightingController.setAllLightsImmediate('day');
  ambientLight.intensity = 0.8;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  clearAllBuildings();
  lightingController.setAllLightsImmediate('day');
});

describe('建筑删除状态一致性', () => {
  it('连续删除同一建筑：只生效一次，不抛错', () => {
    const [id] = addBuildings(1);

    expect(buildingSystem.removeBuilding(id)).toBe(true);
    expect(buildingSystem.getBuildingCount()).toBe(0);

    expect(() => buildingSystem.removeBuilding(id)).not.toThrow();
    expect(buildingSystem.removeBuilding(id)).toBe(false);
    expect(buildingSystem.getBuildingCount()).toBe(0);
    expect(buildingSystem.getBuildings()).toHaveLength(0);
  });

  it('混合有效/无效/重复 id 的批量删除：有效建筑全部删净，计数正确', () => {
    const ids = addBuildings(3);
    const [id1, id2, id3] = ids;

    const removed = buildingSystem.removeBuildings([
      id1,
      'ghost_id',
      id2,
      id1, // 重复 id 只算一次
      'another_missing',
    ]);

    expect(removed).toBe(2);
    expect(buildingSystem.getBuildingCount()).toBe(1);

    const remaining = buildingSystem.getBuildings();
    expect(remaining.map(b => b.id)).toEqual([id3]);

    // 排序结果同样只包含剩余建筑
    buildingSystem.setSortByHeight('asc');
    expect(buildingSystem.getBuildings().map(b => b.id)).toEqual([id3]);
    buildingSystem.setSortByHeight('desc');
    expect(buildingSystem.getBuildings().map(b => b.id)).toEqual([id3]);
    buildingSystem.setSortByHeight(null);
  });

  it('删除后排序结果与剩余建筑严格对应', () => {
    const ids = addBuildings(4);
    buildingSystem.setSortByHeight('asc');

    buildingSystem.removeBuildings([ids[0], ids[2]]);

    const sorted = buildingSystem.getBuildings();
    expect(sorted.map(b => b.id)).toEqual([ids[1], ids[3]]);
    expect(sorted[0].height).toBeLessThanOrEqual(sorted[1].height);
    buildingSystem.setSortByHeight(null);
  });
});

describe('昼夜灯光状态一致性', () => {
  it('夜晚模式下新建建筑立即亮灯', () => {
    addBuildings(2);
    lightingController.setAllLightsImmediate('night');

    const b = buildingSystem.addBuilding(100, 100, 30, 0);
    expect(b).not.toBeNull();
    expect(b!.topLight!.visible).toBe(true);
    expect(b!.topLight!.intensity).toBe(2);
  });

  it('白天模式下新建建筑不亮灯', () => {
    const b = buildingSystem.addBuilding(0, 0, 30, 0);
    expect(b!.topLight!.visible).toBe(false);
    expect(b!.topLight!.intensity).toBe(0);
  });

  it('切换后立即查询灯光状态反映目标模式而非中间态', () => {
    const ids = addBuildings(3);

    lightingController.switchMode('night');

    // 动画尚未推进，但查询应反映目标模式
    expect(lightingController.currentMode).toBe('night');
    expect(buildingSystem.isNightMode()).toBe(true);
    expect(lightingController.isAnimating).toBe(true);
    expect(lightingController.getAnimationProgress()).toBeLessThan(1);
    for (const id of ids) {
      expect(lightingController.getBuildingLightState(id)).toBe(true);
    }

    vi.advanceTimersByTime(5000);
    expect(lightingController.isAnimating).toBe(false);
    expect(lightingController.getAnimationProgress()).toBe(1);
    for (const id of ids) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(true);
      expect(b.topLight!.intensity).toBe(2);
    }
    expect(ambientLight.intensity).toBeCloseTo(0.1, 5);
  });

  it('切换动画中途增删建筑：最终灯光与目标模式一致', () => {
    const ids = addBuildings(4);

    lightingController.switchMode('night');

    // 推进到动画中途（每 100ms 处理一栋）
    vi.advanceTimersByTime(150);
    expect(lightingController.isAnimating).toBe(true);

    // 动画中途：新增一栋、删除一栋尚未处理到的
    const added = buildingSystem.addBuilding(200, 200, 40, 1)!;
    const removedId = ids[3];
    const removedBuilding = buildingSystem.getBuildingById(removedId)!;
    expect(buildingSystem.removeBuilding(removedId)).toBe(true);

    // 新增建筑在夜晚目标模式下应立即亮灯
    expect(added.topLight!.visible).toBe(true);
    expect(added.topLight!.intensity).toBe(2);

    vi.advanceTimersByTime(5000);

    expect(lightingController.isAnimating).toBe(false);

    // 剩余建筑全部点亮
    for (const id of [ids[0], ids[1], ids[2], added.id]) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(true);
      expect(b.topLight!.intensity).toBe(2);
      expect(lightingController.getBuildingLightState(id)).toBe(true);
    }

    // 已删除建筑：查询返回 null，且其对象已从场景移除
    expect(buildingSystem.getBuildingById(removedId)).toBeUndefined();
    expect(lightingController.getBuildingLightState(removedId)).toBeNull();
    expect(sceneManager.removeObject).toHaveBeenCalledWith(removedBuilding.group);
  });

  it('切向白天的动画中途删除建筑：不会残留被点亮的灯', () => {
    const ids = addBuildings(3);
    lightingController.setAllLightsImmediate('night');

    lightingController.switchMode('day');
    vi.advanceTimersByTime(150);

    buildingSystem.removeBuilding(ids[2]);

    vi.advanceTimersByTime(5000);

    for (const id of [ids[0], ids[1]]) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(false);
      expect(b.topLight!.intensity).toBe(0);
      expect(lightingController.getBuildingLightState(id)).toBe(false);
    }
    expect(ambientLight.intensity).toBeCloseTo(0.8, 5);
  });

  it('快速连续切换：旧动画被取代，最终状态与最后目标模式一致', () => {
    const ids = addBuildings(4);

    lightingController.switchMode('night');
    vi.advanceTimersByTime(150);
    lightingController.switchMode('day');
    vi.advanceTimersByTime(120);
    lightingController.switchMode('night');

    vi.advanceTimersByTime(5000);

    expect(lightingController.currentMode).toBe('night');
    expect(lightingController.isAnimating).toBe(false);
    for (const id of ids) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(true);
      expect(b.topLight!.intensity).toBe(2);
    }
    expect(ambientLight.intensity).toBeCloseTo(0.1, 5);

    lightingController.switchMode('day');
    vi.advanceTimersByTime(5000);
    for (const id of ids) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(false);
      expect(b.topLight!.intensity).toBe(0);
    }
    expect(ambientLight.intensity).toBeCloseTo(0.8, 5);
  });

  it('暂停/恢复动画后仍能收敛到目标模式', () => {
    const ids = addBuildings(3);

    lightingController.switchMode('night');
    vi.advanceTimersByTime(150);
    lightingController.pauseAnimation();
    expect(lightingController.isAnimating).toBe(false);

    lightingController.resumeAnimation();
    vi.advanceTimersByTime(5000);

    for (const id of ids) {
      const b = buildingSystem.getBuildingById(id)!;
      expect(b.topLight!.visible).toBe(true);
      expect(b.topLight!.intensity).toBe(2);
    }
  });
});
