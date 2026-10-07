/**
 * 脱离渲染层的推演一致性批量校验。
 *
 * 用法：
 *   node <bundle> [t0] [t1] [step]
 *
 * 校验项：
 *   1. 同一时刻重复推演（模拟不同帧率/拖动顺序）结果逐字节一致；
 *   2. 角距小于阈值时给出明确遮挡结论与依据，且按观测者视深判定而非先后顺序；
 *   3. 时间轴来回拖动后已推演时刻命中缓存且结果不变；
 *   4. 修正单个星体参数后，增量重推结果与全新引擎整体重推一致，
 *      且未受影响星体的星历被复用；区间化修正时区间外缓存被复用；
 *   5. 批量导出指定区间内每个时刻的角度与遮挡结论（JSON）；
 *   6. 大体量性能抽样。
 */
import {
  DeductionEngine,
  snapshotsEqual,
  stableStringify,
  type DeductionSnapshot,
  type OrbitalParams,
  type RingConfig
} from '../src/engine/index';

const RINGS: RingConfig[] = [
  { type: 'ecliptic', radius: 5.6, inclinationDeg: 23.5, nodeAngleDeg: 0 },
  { type: 'equator', radius: 5.2, inclinationDeg: 0, nodeAngleDeg: 0 },
  { type: 'galactic', radius: 6.0, inclinationDeg: 60, nodeAngleDeg: 30 }
];
const OBSERVER = { position: [0, 0, 10] as [number, number, number] };
const THRESHOLD = 2;

function makeEngine(): DeductionEngine {
  return new DeductionEngine({
    rings: RINGS,
    observer: OBSERVER,
    occlusionThresholdDeg: THRESHOLD,
    timeStep: 0.05
  });
}

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

function body(
  bodyId: number,
  ring: OrbitalParams['ring'],
  baseAngleDeg: number,
  angularVelocityDegPerSec = 0,
  radialOffset = 0
): OrbitalParams {
  return { bodyId, ring, baseAngleDeg, angularVelocityDegPerSec, radialOffset };
}

function expect<T>(value: T): asserts value {
  if (!value) {
    throw new Error('expected value');
  }
}

// ---------- 1. 确定性 ----------
function testDeterminism(): void {
  console.log('[1] 确定性：同刻重演与帧率/拖动顺序无关');
  const a = makeEngine();
  const b = makeEngine();
  const params = [
    body(1, 'ecliptic', 10, 12),
    body(2, 'equator', 200, -7),
    body(3, 'galactic', 95, 3.5),
    body(4, 'ecliptic', 40, -18),
    body(5, 'equator', 12, 22)
  ];
  a.setBodies(params);
  b.setBodies(params);

  const first = a.getSnapshot(12.3);
  // 模拟高帧率：在目标时刻之间插入大量其它时刻的查询
  for (let t = 0; t < 30; t += 0.013) {
    a.getSnapshot(t);
  }
  const again = a.getSnapshot(12.3);
  check('同一引擎同一时刻重复推演一致', snapshotsEqual(first, again));
  check('另一引擎整体重推一致', stableStringify(again) === stableStringify(b.getSnapshot(12.3)));
  check(
    '观测时刻被量化且写入快照',
    first.time === Math.round(12.3 / 0.05) * 0.05 && first.time === again.time
  );
}

// ---------- 2. 遮挡判定 ----------
function testOcclusion(): void {
  console.log('[2] 遮挡判定：阈值 + 观测者视深，附依据');
  const engine = makeEngine();
  // 赤道环位于 XZ 平面，观测者在 +Z。角度越大（正方向）离观测者越近。
  engine.setBodies([
    body(1, 'equator', 0),
    body(2, 'equator', 1),
    body(3, 'equator', 1.5)
  ]);
  const snap = engine.getSnapshot(0);
  expect(snap.occlusions.length >= 2);
  const byPair = new Map(snap.occlusions.map((v) => [`${v.occludedId}<-${v.occluderId}`, v]));
  check('#2 遮挡 #1（角距 1°）', !!byPair.get('1<-2'));
  check('#3 遮挡 #2（角距 0.5°）', !!byPair.get('2<-3'));
  check('#3 遮挡 #1（角距 1.5°）', !!byPair.get('1<-3'));
  const state1 = snap.bodies.find((x) => x.bodyId === 1)!;
  check('#1 的直接遮挡者取最近的 #3 而非先匹配的 #2', state1.occludedBy === 3);
  check('被遮挡星体 visible=false，遮挡者 visible=true', state1.visible === false &&
    snap.bodies.find((x) => x.bodyId === 3)!.visible === true);
  const verdict = byPair.get('1<-2')!;
  check(
    '结论附角距/阈值/双方视深作为依据',
    verdict.angularSeparationDeg < THRESHOLD &&
      verdict.thresholdDeg === THRESHOLD &&
      verdict.occluderDepth < verdict.occludedDepth &&
      verdict.rationale.includes('视深') &&
      verdict.rationale.includes('遮挡')
  );

  // 角距达到阈值时不得给出遮挡结论
  const wide = makeEngine();
  wide.setBodies([body(10, 'ecliptic', 0), body(11, 'ecliptic', 5)]);
  check('角距 5°（≥阈值）不判遮挡', wide.getSnapshot(0).occlusions.length === 0);

  // 反序注册（1.5° 的星先加入）也必须得到同样结论，排除"先后顺序覆盖"
  const reversed = makeEngine();
  reversed.setBodies([
    body(3, 'equator', 1.5),
    body(2, 'equator', 1),
    body(1, 'equator', 0)
  ]);
  const reversedSnap = reversed.getSnapshot(0);
  const r1 = reversedSnap.bodies.find((x) => x.bodyId === 1)!;
  check('注册顺序颠倒后结论不变', r1.occludedBy === 3 && reversedSnap.occlusions.length >= 2);
}

// ---------- 3. 缓存复用 ----------
function testCacheReuse(): void {
  console.log('[3] 时间轴来回拖动：已推演时刻复用结果');
  const engine = makeEngine();
  engine.setBodies([body(1, 'ecliptic', 0, 9), body(2, 'galactic', 50, -4)]);
  const target = engine.getSnapshot(5);
  for (let t = 0; t <= 10; t += 0.1) {
    engine.getSnapshot(t);
  }
  engine.resetStats();
  const revisited = engine.getSnapshot(5);
  const stats = engine.getStats();
  check('回到已推演时刻命中快照缓存', snapshotsEqual(target, revisited) && stats.snapshotHits === 1);
  check('快照命中时直接返回，不触发任何星历重算', stats.ephemerisMisses === 0);
  // 快速来回拖动多次
  for (let i = 0; i < 50; i += 1) {
    engine.getSnapshot(i % 2 === 0 ? 5 : 2.5);
  }
  check('反复拖动结果始终恒定', snapshotsEqual(engine.getSnapshot(5), target));
}

// ---------- 4. 增量重推 ----------
function testIncremental(): void {
  console.log('[4] 参数修正：仅受影响星体/时刻重推，且与整体重推一致');
  const params = [
    body(1, 'ecliptic', 12, 6),
    body(2, 'equator', 80, -9),
    body(3, 'galactic', 45, 3),
    body(4, 'ecliptic', 200, -11),
    body(5, 'equator', 300, 14)
  ];

  // 增量引擎：先跑满缓存，再修正 #2
  const incremental = makeEngine();
  incremental.setBodies(params);
  incremental.batchDeduce(-10, 10, 0.1);
  incremental.resetStats();
  incremental.updateOrbitalParams(2, { baseAngleDeg: 80 + 13.7 });
  const incResults = incremental.batchDeduce(-10, 10, 0.1);
  const stats = incremental.getStats();

  // 全新引擎：从一开始就使用修正后的参数，整体重推
  const freshParams = params.map((p) =>
    p.bodyId === 2 ? { ...p, baseAngleDeg: 80 + 13.7 } : p
  );
  const fresh = makeEngine();
  fresh.setBodies(freshParams);
  const freshResults = fresh.batchDeduce(-10, 10, 0.1);

  let allEqual = incResults.length === freshResults.length;
  for (let i = 0; allEqual && i < incResults.length; i += 1) {
    if (!snapshotsEqual(incResults[i], freshResults[i])) {
      allEqual = false;
    }
  }
  check('增量重推与整体重推逐刻一致', allEqual, `n=${incResults.length}/${freshResults.length}`);

  // 201 个抽样时刻 × 5 星体；只有 #2 需要重算 201 条星历，其余 804 条命中
  check(
    '仅受影响星体的星历被重算（201 miss / 804 hit）',
    stats.ephemerisMisses === 201 && stats.ephemerisHits === 804,
    `miss=${stats.ephemerisMisses} hit=${stats.ephemerisHits}`
  );

  // 区间化修正：[-5, 5] 外的时刻缓存被信任复用
  const ranged = makeEngine();
  ranged.setBodies(params);
  ranged.batchDeduce(-10, 10, 0.5);
  const outsideBefore = ranged.getSnapshot(-8);
  const insideBefore = ranged.getSnapshot(0);
  ranged.updateOrbitalParams(2, { baseAngleDeg: 80 + 13.7 }, [-5, 5]);
  ranged.resetStats();
  const outsideAfter = ranged.getSnapshot(-8);
  ranged.getSnapshot(0);
  const rangedStats = ranged.getStats();
  check('区间外时刻复用旧缓存（frozen hit）', snapshotsEqual(outsideBefore, outsideAfter) &&
    rangedStats.snapshotHits === 1);
  const rangedFresh = makeEngine();
  rangedFresh.setBodies(
    params.map((p) => (p.bodyId === 2 ? { ...p, baseAngleDeg: 80 + 13.7 } : p))
  );
  check('区间内时刻按新参数重推且与整体重推一致', snapshotsEqual(
    ranged.getSnapshot(0),
    rangedFresh.getSnapshot(0)
  ));
  check('区间内确实发生了重推', !snapshotsEqual(insideBefore, ranged.getSnapshot(0)));
}

// ---------- 5. 批量导出 ----------
function testBatchExport(t0: number, t1: number, step: number): void {
  console.log(`[5] 批量导出区间 [${t0}, ${t1}] 步长 ${step}s`);
  const engine = makeEngine();
  engine.setBodies([
    body(1, 'ecliptic', 0, 18),
    body(2, 'equator', 0, 17.5),
    body(3, 'galactic', 0, 24)
  ]);
  const snapshots = engine.batchDeduce(t0, t1, step);
  const exportRows = snapshots.map((s) => ({
    time: Number(s.time.toFixed(3)),
    angles: Object.fromEntries(s.bodies.map((b) => [b.bodyId, Number(b.angleDeg.toFixed(6))])),
    occlusions: s.occlusions.map((v) => ({
      ring: v.ring,
      occluder: v.occluderId,
      occluded: v.occludedId,
      separationDeg: Number(v.angularSeparationDeg.toFixed(4))
    }))
  }));
  console.log(`  导出时刻数: ${exportRows.length}`);
  console.log('  样例（前 3 个时刻）:');
  for (const row of exportRows.slice(0, 3)) {
    console.log(`    ${JSON.stringify(row)}`);
  }

  // 第二次批量推演必须与第一次逐刻一致
  const second = makeEngine();
  second.setBodies([
    body(1, 'ecliptic', 0, 18),
    body(2, 'equator', 0, 17.5),
    body(3, 'galactic', 0, 24)
  ]);
  const rerun = second.batchDeduce(t0, t1, step);
  let consistent = rerun.length === snapshots.length;
  for (let i = 0; consistent && i < rerun.length; i += 1) {
    if (!snapshotsEqual(rerun[i], snapshots[i])) {
      consistent = false;
    }
  }
  check('批量结果跨引擎重跑完全一致', consistent);
}

// ---------- 6. 性能 ----------
function testPerformance(): void {
  console.log('[6] 大体量性能抽样');
  const bodyCount = 300;
  const params: OrbitalParams[] = Array.from({ length: bodyCount }, (_, i) => {
    const rings = ['ecliptic', 'equator', 'galactic'] as const;
    const seed = (Math.sin(i * 127.1 + 311.7) + 1) / 2;
    return body(i + 1, rings[i % 3], seed * 360, (seed - 0.5) * 40, 0);
  });
  const engine = makeEngine();
  engine.setBodies(params);
  const started = Date.now();
  let sumAngles = 0;
  for (let t = 0; t < 200; t += 1) {
    const snap = engine.getSnapshot(t);
    sumAngles += snap.bodies[0].angleDeg;
  }
  const elapsed = Date.now() - started;
  console.log(`  300 星体 × 200 时刻: ${elapsed}ms（校验和 ${sumAngles.toFixed(3)}）`);
  check('单时刻平均推演耗时 < 5ms', elapsed / 200 < 5, `avg=${elapsed / 200}ms`);
}

const t0 = Number(process.argv[2] ?? -10);
const t1 = Number(process.argv[3] ?? 10);
const step = Number(process.argv[4] ?? 0.5);

testDeterminism();
testOcclusion();
testCacheReuse();
testIncremental();
testBatchExport(t0, t1, step);
testPerformance();

console.log(failures === 0 ? '\n全部通过：推演层可脱离渲染层独立验证。' : `\n存在 ${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
