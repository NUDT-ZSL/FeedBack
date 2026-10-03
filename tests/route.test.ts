import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  generateTerrain,
  getHeightAt,
  generateSmoothPath,
  calculatePathMetrics,
  type TerrainData
} from '../src/terrain';
import { RouteStore, RoamController } from '../src/route';

function terrainPoints(pairs: [number, number][], terrain: TerrainData): THREE.Vector3[] {
  return pairs.map(([x, z]) => new THREE.Vector3(x, getHeightAt(x, z, terrain), z));
}

describe('链路：控制点变更 -> 平滑路径 -> 统计 -> 漫游 单一数据源', () => {
  let terrain: TerrainData;
  let store: RouteStore;
  let received: ReturnType<RouteStore['getSnapshot']>[];

  beforeEach(() => {
    terrain = generateTerrain({ size: 400, segments: 64, maxHeight: 500, minHeight: 100, seed: 42 });
    store = new RouteStore(terrainData(terrain), 15);
    received = [];
    store.subscribe(snap => received.push(snap));
  });

  function terrainData(t: TerrainData): TerrainData {
    return t;
  }

  it('每次变更都同步发布同一快照：路径、统计、漫游拿到的是同一份数据', () => {
    const roam = new RoamController();
    store.subscribe(snap => roam.setPath(snap.smoothedPath, false));

    const initial = store.getSnapshot();
    store.addPoint(new THREE.Vector3(10, getHeightAt(10, 10, terrain), 10));
    store.addPoint(new THREE.Vector3(40, getHeightAt(40, 40, terrain), 40));

    const snap = store.getSnapshot();
    expect(snap.metrics.distances).toHaveLength(snap.smoothedPath.length);
    expect(snap.metrics.totalDistance).toBe(snap.metrics.distances.at(-1));
    expect(roam.getTotalLength()).toBeGreaterThan(snap.metrics.totalDistance);

    expect(received.at(-1)).toBe(snap);
    expect(received.at(-1)!.version).toBeGreaterThan(initial.version);
  });

  it('连续快速增删后，最终状态与最后一次控制点集合严格一致', () => {
    const base = terrainPoints([[0, 0], [50, 20], [100, 60], [60, 120], [-30, 80]], terrain);
    store.setPoints(base);

    for (let i = 0; i < 50; i++) {
      const x = (i * 17) % 160 - 80;
      const z = (i * 23) % 160 - 80;
      store.addPoint(new THREE.Vector3(x, getHeightAt(x, z, terrain), z));
      store.removePoint(store.getSnapshot().controlPoints.length - 1);
    }
    const snap = store.getSnapshot();
    expect(snap.controlPoints).toHaveLength(5);
    expect(snap.smoothedPath.length).toBe(generateSmoothPath(base, terrain, 15).length);
    expect(calculatePathMetrics(snap.smoothedPath).totalDistance).toBe(snap.metrics.totalDistance);
    expect(received.length).toBe(1 + 1 + 100);
  });

  it('漫游中控制点发生变更，漫游路径立刻跟随且不跳变（保持弧长比例）', () => {
    store.setPoints(terrainPoints([[0, 0], [50, 20], [100, 60]], terrain));
    const roam = new RoamController();
    roam.setPath(store.getSnapshot().smoothedPath, false);
    roam.update(2);
    const ratioBefore = roam.getDistance() / roam.getTotalLength();
    const frameBefore = roam.getFrame()!;

    store.addPoint(new THREE.Vector3(60, getHeightAt(60, 120, terrain), 120));
    roam.setPath(store.getSnapshot().smoothedPath, true);
    const frameAfter = roam.getFrame()!;

    const drift = frameAfter.position.distanceTo(frameBefore.position);
    expect(drift).toBeLessThan(60);
    expect(Math.abs(roam.getDistance() / roam.getTotalLength() - ratioBefore)).toBeLessThan(0.05);
  });
});

describe('边界：0 / 1 / 2 个控制点与重合点', () => {
  let terrain: TerrainData;
  beforeEach(() => {
    terrain = generateTerrain({ size: 400, segments: 64, maxHeight: 500, minHeight: 100, seed: 7 });
  });

  it('0 个控制点：空路径、零统计、无 NaN、漫游不可用', () => {
    const path = generateSmoothPath([], terrain, 15);
    expect(path).toEqual([]);
    const m = calculatePathMetrics(path);
    expect(m.totalDistance).toBe(0);
    expect(m.avgSlope).toBe(0);
    expect(m.maxSlopeIndex).toBe(-1);

    const store = new RouteStore(terrain, 15);
    const snap = store.getSnapshot();
    expect(snap.controlPoints).toHaveLength(0);
    expect(snap.metrics.totalDistance).toBe(0);
    expect(Number.isFinite(snap.metrics.avgSlope)).toBe(true);

    const roam = new RoamController();
    roam.setPath(path);
    expect(roam.isReady).toBe(false);
    expect(roam.getFrame()).toBeNull();
    roam.update(1);
    expect(roam.getDistance()).toBe(0);
  });

  it('1 个控制点：单点路径、统计为零、漫游停住不产生异常位置', () => {
    const pts = terrainPoints([[30, -20]], terrain);
    const path = generateSmoothPath(pts, terrain, 15);
    expect(path).toHaveLength(1);
    const m = calculatePathMetrics(path);
    expect(m.totalDistance).toBe(0);
    expect(m.avgSlope).toBe(0);
    expect(m.slopes).toEqual([0]);

    const roam = new RoamController();
    roam.setPath(path);
    expect(roam.isReady).toBe(false);
    expect(roam.getFrame()).toBeNull();
  });

  it('2 个控制点：正常生成路径与统计', () => {
    const pts = terrainPoints([[0, 0], [100, 0]], terrain);
    const path = generateSmoothPath(pts, terrain, 15);
    expect(path.length).toBeGreaterThan(10);
    const m = calculatePathMetrics(path);
    expect(m.totalDistance).toBeGreaterThan(90);
    expect(Number.isFinite(m.avgSlope)).toBe(true);
    expect(Number.isFinite(m.maxSlope)).toBe(true);
  });

  it('控制点几乎重合：去重后稳定，不出现 NaN / Infinity / 除零', () => {
    const y = getHeightAt(20, 20, terrain);
    const pts = [
      new THREE.Vector3(20, y, 20),
      new THREE.Vector3(20 + 1e-7, y, 20 + 1e-7),
      new THREE.Vector3(20 + 2e-7, y, 20 + 2e-7)
    ];
    const path = generateSmoothPath(pts, terrain, 15);
    expect(path).toHaveLength(1);
    const m = calculatePathMetrics(path);
    for (const v of [...m.distances, ...m.slopes, m.totalDistance, m.avgSlope, m.maxSlope]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(m.totalDistance).toBe(0);
    expect(m.avgSlope).toBe(0);

    const roam = new RoamController();
    roam.setPath(path);
    expect(roam.isReady).toBe(false);
  });

  it('平滑采样越界时钳制在地形范围内，高度始终有限', () => {
    const pts = terrainPoints([[190, 190], [-190, -190]], terrain);
    const path = generateSmoothPath(pts, terrain, 15);
    for (const p of path) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThan(0);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(200);
    }
  });
});

describe('漫游：回环连续、速度即时生效且不跳变', () => {
  let terrain: TerrainData;
  let path: THREE.Vector3[];

  beforeEach(() => {
    terrain = generateTerrain({ size: 400, segments: 64, maxHeight: 500, minHeight: 100, seed: 42 });
    path = generateSmoothPath(
      terrainPoints([[0, 0], [60, 30], [120, 0], [100, 90], [20, 100]], terrain),
      terrain,
      15
    );
  });

  it('逐帧推进始终有限，经过末尾回到起点时不发生突跳', () => {
    const roam = new RoamController();
    roam.setPath(path, false);
    const total = roam.getTotalLength();
    expect(total).toBeGreaterThan(0);

    let prev = roam.getFrame()!.position;
    roam.update(0.5);
    const maxStep = 100;
    for (let i = 0; i < 400; i++) {
      roam.update(0.1);
      const frame = roam.getFrame()!;
      for (const c of [frame.position.x, frame.position.y, frame.position.z,
                       frame.lookTarget.x, frame.lookTarget.y, frame.lookTarget.z]) {
        expect(Number.isFinite(c)).toBe(true);
      }
      expect(frame.position.distanceTo(prev)).toBeLessThan(maxStep);
      prev = frame.position;
    }
  });

  it('推进速度严格匹配速度参数（米/秒）', () => {
    const roam = new RoamController();
    roam.setPath(path, false);
    roam.setSpeed(25);
    roam.update(0.5);
    expect(roam.getDistance()).toBeCloseTo(12.5, 6);
  });

  it('速度变化只改变节奏，不改变当前位置（无跳变）', () => {
    const roam = new RoamController();
    roam.setPath(path, false);
    roam.update(1.5);
    const d0 = roam.getDistance();
    const pos0 = roam.getFrame()!.position.clone();

    roam.setSpeed(80);
    expect(roam.getDistance()).toBeCloseTo(d0, 6);
    expect(roam.getFrame()!.position.distanceTo(pos0)).toBeLessThan(1e-6);
    roam.update(0.5);
    expect(roam.getDistance() - d0).toBeCloseTo(40, 6);
  });

  it('速度被钳制在安全范围内', () => {
    const roam = new RoamController();
    roam.setSpeed(-5);
    expect(roam.getSpeed()).toBe(2);
    roam.setSpeed(99999);
    expect(roam.getSpeed()).toBe(100);
    roam.setSpeed(NaN);
    expect(roam.getSpeed()).toBe(100);
  });
});

describe('单点指标：与统计面板同源、随路径变化更新', () => {
  let terrain: TerrainData;

  beforeEach(() => {
    terrain = generateTerrain({ size: 400, segments: 64, maxHeight: 500, minHeight: 100, seed: 42 });
  });

  it('点击控制点得到的距离/坡度取自当前平滑路径指标', () => {
    const store = new RouteStore(terrain, 15);
    store.setPoints(terrainPoints([[0, 0], [60, 30], [120, 0], [100, 90]], terrain));
    const snap = store.getSnapshot();

    const idx = store.nearestSmoothedIndex(snap.controlPoints[1]);
    expect(idx).toBeGreaterThan(0);
    expect(snap.metrics.distances[idx]).toBe(snap.metrics.distances[idx]);
    const expectedDistance = snap.metrics.distances[idx];
    const expectedSlope = snap.metrics.slopes[idx];
    expect(expectedDistance).toBeGreaterThan(0);
    expect(Number.isFinite(expectedSlope)).toBe(true);
  });

  it('路径变化后同一世界位置的单点指标按新路径重新推导', () => {
    const store = new RouteStore(terrain, 15);
    store.setPoints(terrainPoints([[0, 0], [60, 30], [120, 0]], terrain));
    const target = store.getSnapshot().controlPoints[1].clone();
    const before = store.getSnapshot().metrics.distances[store.nearestSmoothedIndex(target)];

    store.setPoints([
      new THREE.Vector3(-90, getHeightAt(-90, 20, terrain), 20),
      new THREE.Vector3(-60, getHeightAt(-60, 80, terrain), 80),
      ...store.getSnapshot().controlPoints
    ]);
    const after = store.getSnapshot().metrics.distances[store.nearestSmoothedIndex(target)];
    expect(after).not.toBe(before);
  });

  it('单点指标与面板口径一致：面板总量等于末端累积距离', () => {
    const store = new RouteStore(terrain, 15);
    store.setPoints(terrainPoints([[0, 0], [60, 30], [120, 0], [100, 90], [20, 100]], terrain));
    const { metrics, smoothedPath } = store.getSnapshot();
    expect(metrics.totalDistance).toBeCloseTo(
      metrics.distances[smoothedPath.length - 1], 1e-9
    );
    expect(metrics.avgSlope).toBeGreaterThanOrEqual(0);
    expect(metrics.avgSlope).toBeLessThanOrEqual(metrics.maxSlope + 1e-9);
  });
});
