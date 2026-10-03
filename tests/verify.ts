import * as THREE from 'three';
import {
  generateTerrain,
  getHeightAt,
  calculatePathMetrics,
  type TerrainData
} from '../src/terrain';
import { RouteStore, RoamSampler, PATH_SEGMENTS_PER_CURVE } from '../src/route';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

function approx(a: number, b: number, eps: number = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function allFinite(values: number[]): boolean {
  return values.every(v => Number.isFinite(v));
}

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function expectedSmoothedLength(controlCount: number): number {
  if (controlCount === 0) return 0;
  if (controlCount === 1) return 1;
  return (controlCount - 1) * PATH_SEGMENTS_PER_CURVE + 1;
}

function verifySnapshotInvariants(store: RouteStore, label: string): boolean {
  const snap = store.getSnapshot();
  const recomputed = calculatePathMetrics(snap.smoothedPath);

  const okLength = snap.smoothedPath.length === expectedSmoothedLength(snap.controlPoints.length);
  const okArrays =
    snap.metrics.distances.length === snap.smoothedPath.length &&
    snap.metrics.slopes.length === snap.smoothedPath.length;
  const okFinite =
    allFinite(snap.metrics.distances) &&
    allFinite(snap.metrics.slopes) &&
    Number.isFinite(snap.metrics.totalDistance) &&
    Number.isFinite(snap.metrics.avgSlope) &&
    snap.smoothedPath.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const okMetrics =
    approx(snap.metrics.totalDistance, recomputed.totalDistance) &&
    approx(snap.metrics.avgSlope, recomputed.avgSlope) &&
    approx(snap.metrics.maxSlope, recomputed.maxSlope);
  let okMonotonic = true;
  for (let i = 1; i < snap.metrics.distances.length; i++) {
    if (snap.metrics.distances[i] < snap.metrics.distances[i - 1]) okMonotonic = false;
  }

  const ok = okLength && okArrays && okFinite && okMetrics && okMonotonic;
  check(
    `${label}: 快照自洽(长度/有限性/统计口径/距离单调)`,
    ok,
    `length=${okLength} arrays=${okArrays} finite=${okFinite} metrics=${okMetrics} monotonic=${okMonotonic}`
  );
  return ok;
}

const SAMPLE_POINTS = [
  [-150, -120], [-80, -60], [-20, -100], [30, -40], [60, 20], [20, 60],
  [-40, 80], [-10, 130], [50, 140], [100, 100], [130, 40], [80, -20]
];

function makeStore(terrain: TerrainData): RouteStore {
  const points = SAMPLE_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new RouteStore(terrain, points);
}

console.log('\n[1] 路线快照一致性（编辑/统计/漫游同源）');
{
  const terrain = generateTerrain({ seed: 42 });
  const store = makeStore(terrain);
  const snap = store.getSnapshot();

  check('初始快照版本号大于 0', snap.version > 0);
  check('控制点数量正确', snap.controlPoints.length === SAMPLE_POINTS.length);
  verifySnapshotInvariants(store, '初始路线');

  const sampler = new RoamSampler();
  sampler.setPath(snap.smoothedPath);
  const frame = sampler.sample();
  check('漫游采样器使用同一份平滑路径', frame.hasPath && frame.moving);
  check(
    '漫游总里程与平滑路径弧长一致',
    approx(frame.totalDistance, snap.smoothedPath.reduce((acc, p, i) => {
      if (i === 0) return 0;
      return acc + p.distanceTo(snap.smoothedPath[i - 1]);
    }, 0), 1e-6)
  );
}

console.log('\n[2] 连续快速增删控制点（200 次随机操作）');
{
  const terrain = generateTerrain({ seed: 42 });
  const store = makeStore(terrain);
  const rng = makeRng(12345);
  let expectedCount = SAMPLE_POINTS.length;
  let lastVersion = store.getSnapshot().version;
  let allOk = true;

  for (let i = 0; i < 200; i++) {
    if (rng() < 0.5 || expectedCount === 0) {
      const x = (rng() * 2 - 1) * 180;
      const z = (rng() * 2 - 1) * 180;
      store.addControlPoint(new THREE.Vector3(x, 0, z));
      expectedCount++;
    } else {
      const index = Math.floor(rng() * expectedCount);
      store.removeControlPointAt(index);
      expectedCount--;
    }

    const snap = store.getSnapshot();
    if (snap.version !== lastVersion + 1) allOk = false;
    lastVersion = snap.version;
    if (snap.controlPoints.length !== expectedCount) allOk = false;
    if (snap.smoothedPath.length !== expectedSmoothedLength(expectedCount)) allOk = false;
    if (!allFinite(snap.metrics.distances) || !allFinite(snap.metrics.slopes)) allOk = false;
    if (!Number.isFinite(snap.metrics.totalDistance) || !Number.isFinite(snap.metrics.avgSlope)) allOk = false;

    const recomputed = calculatePathMetrics(snap.smoothedPath);
    if (!approx(snap.metrics.totalDistance, recomputed.totalDistance)) allOk = false;
    if (!approx(snap.metrics.avgSlope, recomputed.avgSlope)) allOk = false;
  }

  check('200 次增删后快照始终同步（版本/数量/统计）', allOk);
  verifySnapshotInvariants(store, '快速增删后');
}

console.log('\n[3] 漫游推进连续性与速度响应');
{
  const terrain = generateTerrain({ seed: 42 });
  const store = makeStore(terrain);
  const snap = store.getSnapshot();

  const sampler = new RoamSampler();
  sampler.setPath(snap.smoothedPath);
  sampler.setSpeed(30);

  const dt = 1 / 60;
  const frames = 6000;
  let prev = sampler.advance(dt);
  let maxStep = 0;
  let odometer = 0;
  let positionsFinite = true;
  let distanceInRange = true;

  for (let i = 0; i < frames; i++) {
    const frame = sampler.advance(dt);
    const step = frame.position.distanceTo(prev.position);
    maxStep = Math.max(maxStep, step);
    odometer += step;
    if (!Number.isFinite(frame.position.x) || !Number.isFinite(frame.position.y) || !Number.isFinite(frame.position.z)) {
      positionsFinite = false;
    }
    if (frame.distance < -1e-9 || frame.distance > frame.totalDistance + 1e-9) {
      distanceInRange = false;
    }
    prev = frame;
  }

  const total = prev.totalDistance;
  const traveled = 30 * dt * (frames + 1);
  check('覆盖完整往返（里程 > 2 倍路径长）', traveled > 2 * total, `traveled=${traveled.toFixed(1)} total=${total.toFixed(1)}`);
  check('往返衔接无瞬移（最大步长 <= 速度*帧长）', maxStep <= 30 * dt + 1e-6, `maxStep=${maxStep.toFixed(4)} limit=${(30 * dt).toFixed(4)}`);
  check('相机位置始终有限', positionsFinite);
  check('弧长参数始终在 [0, 总长] 内', distanceInRange);
  check(
    '推进节奏与速度参数一致（里程表误差 < 2%）',
    Math.abs(odometer - traveled) / traveled < 0.02,
    `odometer=${odometer.toFixed(1)} expected=${traveled.toFixed(1)}`
  );

  const beforeChange = sampler.sample();
  sampler.setSpeed(90);
  const afterChange = sampler.advance(dt);
  const jump = afterChange.position.distanceTo(beforeChange.position);
  check('速度突变后无跳变（步长随新速度）', jump <= 90 * dt + 1e-6, `jump=${jump.toFixed(4)}`);
  check('速度参数被采纳', approx(sampler.getSpeed(), 90));

  sampler.setSpeed(NaN);
  check('非法速度被拒绝', approx(sampler.getSpeed(), 90));
}

console.log('\n[4] 边界：点数过少 / 控制点重合');
{
  const terrain = generateTerrain({ seed: 42 });

  const empty = new RouteStore(terrain, []);
  const emptySnap = empty.getSnapshot();
  check('0 控制点：平滑路径为空', emptySnap.smoothedPath.length === 0);
  check('0 控制点：统计为零且有限',
    emptySnap.metrics.totalDistance === 0 &&
    emptySnap.metrics.avgSlope === 0 &&
    emptySnap.metrics.distances.length === 0);
  check('0 控制点：单点查询返回 null', empty.getPointInfoAt(new THREE.Vector3()) === null);
  const emptySampler = new RoamSampler();
  emptySampler.setPath(emptySnap.smoothedPath);
  check('0 控制点：漫游采样无路径', !emptySampler.advance(1 / 60).hasPath);

  const single = new RouteStore(terrain, [new THREE.Vector3(10, 0, -20)]);
  const singleSnap = single.getSnapshot();
  check('1 控制点：平滑路径为单点', singleSnap.smoothedPath.length === 1);
  check('1 控制点：单点贴合地形',
    approx(singleSnap.smoothedPath[0].y, getHeightAt(10, -20, terrain), 1e-6));
  check('1 控制点：统计为零且有限',
    singleSnap.metrics.totalDistance === 0 &&
    singleSnap.metrics.avgSlope === 0 &&
    singleSnap.metrics.slopes.length === 1 &&
    singleSnap.metrics.slopes[0] === 0);
  const singleInfo = single.getPointInfoAt(new THREE.Vector3(10, 0, -20));
  check('1 控制点：单点指标可读',
    singleInfo !== null && singleInfo.distance === 0 && singleInfo.slope === 0);
  const singleSampler = new RoamSampler();
  singleSampler.setPath(singleSnap.smoothedPath);
  const singleFrame = singleSampler.advance(1 / 60);
  check('1 控制点：漫游静止于该点',
    singleFrame.hasPath && !singleFrame.moving &&
    approx(singleFrame.position.x, 10) && approx(singleFrame.position.z, -20));

  const two = new RouteStore(terrain, [
    new THREE.Vector3(-50, 0, -50),
    new THREE.Vector3(50, 0, 50)
  ]);
  const twoSnap = two.getSnapshot();
  check('2 控制点：平滑路径点数正确', twoSnap.smoothedPath.length === PATH_SEGMENTS_PER_CURVE + 1);
  check('2 控制点：总距离为正且有限', twoSnap.metrics.totalDistance > 0);
  const twoSampler = new RoamSampler();
  twoSampler.setPath(twoSnap.smoothedPath);
  check('2 控制点：漫游可移动', twoSampler.advance(1 / 60).moving);

  const dup = new THREE.Vector3(30, 0, 40);
  const coincident = new RouteStore(terrain, [dup, dup.clone(), dup.clone()]);
  const coincidentSnap = coincident.getSnapshot();
  check('重合控制点：平滑路径长度正常',
    coincidentSnap.smoothedPath.length === 2 * PATH_SEGMENTS_PER_CURVE + 1);
  check('重合控制点：总距离为 0 且无 NaN',
    coincidentSnap.metrics.totalDistance <= 1e-6 &&
    allFinite(coincidentSnap.metrics.slopes) &&
    coincidentSnap.metrics.avgSlope === 0);
  const coincidentSampler = new RoamSampler();
  coincidentSampler.setPath(coincidentSnap.smoothedPath);
  const coincidentFrame = coincidentSampler.advance(1 / 60);
  check('重合控制点：漫游静止且位置合理',
    coincidentFrame.hasPath && !coincidentFrame.moving &&
    approx(coincidentFrame.position.x, 30, 1e-3) &&
    approx(coincidentFrame.position.z, 40, 1e-3));

  const near = new RouteStore(terrain, [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.001, 0, 0.001)
  ]);
  const nearSnap = near.getSnapshot();
  check('近重合控制点：统计有限',
    Number.isFinite(nearSnap.metrics.totalDistance) &&
    Number.isFinite(nearSnap.metrics.avgSlope) &&
    allFinite(nearSnap.metrics.slopes));
}

console.log('\n[5] 单点指标与统计口径一致');
{
  const terrain = generateTerrain({ seed: 42 });
  const store = makeStore(terrain);
  const snap = store.getSnapshot();

  let allMatch = true;
  for (const cp of snap.controlPoints) {
    const info = store.getPointInfoAt(cp);
    if (!info) { allMatch = false; break; }
    if (!approx(info.distance, snap.metrics.distances[info.pathIndex])) allMatch = false;
    if (!approx(info.slope, snap.metrics.slopes[info.pathIndex])) allMatch = false;
    if (!info.point.equals(snap.smoothedPath[info.pathIndex])) allMatch = false;

    let brute = 0;
    let bruteDist = Infinity;
    for (let i = 0; i < snap.smoothedPath.length; i++) {
      const d = (snap.smoothedPath[i].x - cp.x) ** 2 + (snap.smoothedPath[i].z - cp.z) ** 2;
      if (d < bruteDist) { bruteDist = d; brute = i; }
    }
    if (info.pathIndex !== brute) allMatch = false;
  }
  check('每个控制点的单点指标与统计数组同源', allMatch);

  const midIndex = Math.floor(snap.smoothedPath.length / 2);
  const midInfo = store.getPointInfoAt(snap.smoothedPath[midIndex]);
  check('平滑路径点查询命中自身索引',
    midInfo !== null && midInfo.pathIndex === midIndex &&
    approx(midInfo.distance, snap.metrics.distances[midIndex]) &&
    approx(midInfo.slope, snap.metrics.slopes[midIndex]));

  store.addControlPoint(new THREE.Vector3(-120, 0, 100));
  store.removeControlPointAt(0);
  const snap2 = store.getSnapshot();
  const cp2 = snap2.controlPoints[3];
  const info2 = store.getPointInfoAt(cp2);
  check('路径变化后单点指标跟随新快照',
    info2 !== null &&
    approx(info2.distance, snap2.metrics.distances[info2.pathIndex]) &&
    approx(info2.slope, snap2.metrics.slopes[info2.pathIndex]));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
