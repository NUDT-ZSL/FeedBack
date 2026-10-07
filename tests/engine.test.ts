import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SimulationEngine,
  DEFAULT_CONFIG,
  computeOcclusion,
  buildRingFrames,
  buildViewBasis,
  computeBodyPosition,
  bodyWorldPosition,
  orbitAngleDeg,
  angleDiffDeg,
  ringFrame,
  normalizeDeg,
  RING_KEYS,
  type ObserverView,
  type OrbitalBodyParams,
  type SimulationConfig
} from '../src/engine/index.ts';

const OBSERVER: ObserverView = { position: [0, 0, 14], target: [0, 0, 0] };

function makeBody(over: Partial<OrbitalBodyParams> = {}): OrbitalBodyParams {
  return {
    id: over.id ?? 'a',
    name: over.name ?? '甲',
    homeRing: over.homeRing ?? 'equator',
    radius: over.radius ?? 4,
    phase0: over.phase0 ?? 90,
    period: over.period ?? 40000,
    inclination: over.inclination ?? 0,
    azimuth: over.azimuth ?? 0,
    depthOrder: over.depthOrder ?? 0,
    magnitude: over.magnitude ?? 2,
    revision: over.revision ?? 0
  };
}

test('角度工具：normalizeDeg 与环带角距', () => {
  assert.equal(normalizeDeg(-10), 350);
  assert.equal(angleDiffDeg(359, 1), 2);
  assert.equal(angleDiffDeg(90, 270), 180);
});

test('环带坐标系为右手正交单位基底', () => {
  const f = ringFrame(37, 123);
  const eps = 1e-12;
  assert.ok(Math.abs(f.u[0] * f.u[0] + f.u[1] * f.u[1] + f.u[2] * f.u[2] - 1) < eps);
  assert.ok(Math.abs(f.w[0] * f.w[0] + f.w[1] * f.w[1] + f.w[2] * f.w[2] - 1) < eps);
  const dotUW = f.u[0] * f.w[0] + f.u[1] * f.w[1] + f.u[2] * f.w[2];
  assert.ok(Math.abs(dotUW) < eps);
});

test('轨道：周期运动、初相与三条环带角度', () => {
  const body = makeBody({ phase0: 30, period: 1000 });
  assert.equal(orbitAngleDeg(body, 0), 30);
  assert.equal(orbitAngleDeg(body, 1000), 30);
  const frames = buildRingFrames();
  const p0 = bodyWorldPosition(body, 0, frames);
  const pos = computeBodyPosition(body, 0, frames, buildViewBasis(OBSERVER));
  assert.ok(Math.abs((pos.angles.equator ?? 0) - 30) < 1e-9);
  const r = Math.hypot(p0[0], p0[1], p0[2]);
  assert.ok(Math.abs(r - 4) < 1e-9);
});

function frameFor(bodies: OrbitalBodyParams[], config: SimulationConfig = DEFAULT_CONFIG, time = 0) {
  const frames = buildRingFrames();
  const view = buildViewBasis(OBSERVER);
  const positions = bodies.map((b) => computeBodyPosition(b, time, frames, view));
  return computeOcclusion(positions, bodies, config);
}

test('遮挡：深度不同按观测者视角（远者被遮挡，与传入顺序无关）', () => {
  const near = makeBody({ id: 'near', radius: 4.4, depthOrder: 9 });
  const far = makeBody({ id: 'far', radius: 4.0, depthOrder: 0 });
  for (const pair of [[near, far], [far, near]]) {
    const { relations } = frameFor(pair);
    assert.equal(relations.length, 1);
    assert.equal(relations[0].visibleId, 'near');
    assert.equal(relations[0].hiddenId, 'far');
    assert.equal(relations[0].evidence.tieBreak, 'depth');
    assert.ok(relations[0].evidence.depthVisible < relations[0].evidence.depthHidden);
  }
});

test('遮挡：深度相同看视星等（亮者可见）', () => {
  const dim = makeBody({ id: 'dim', magnitude: 3, depthOrder: 0 });
  const bright = makeBody({ id: 'bright', magnitude: 1, depthOrder: 9 });
  const { relations } = frameFor([dim, bright]);
  assert.equal(relations[0].visibleId, 'bright');
  assert.equal(relations[0].evidence.tieBreak, 'magnitude');
});

test('遮挡：深度与亮度都相同按稳定序号，结论唯一', () => {
  const b0 = makeBody({ id: 'b0', magnitude: 2, depthOrder: 5 });
  const b1 = makeBody({ id: 'b1', magnitude: 2, depthOrder: 2 });
  const { relations, visibilities } = frameFor([b0, b1]);
  assert.equal(relations[0].visibleId, 'b1');
  assert.equal(relations[0].evidence.tieBreak, 'order');
  const hidden = visibilities.find((v) => v.id === 'b0')!;
  assert.equal(hidden.state, 'occluded');
  assert.equal(hidden.hiddenBy, 'b1');
});

test('角度差超过阈值不构成遮挡', () => {
  const a = makeBody({ id: 'a', phase0: 0 });
  const b = makeBody({ id: 'b', phase0: 20 });
  const { relations } = frameFor([a, b]);
  assert.equal(relations.length, 0);
});

function manualPosition(id: string, over: Partial<import('../src/engine/index.ts').BodyPosition> = {}) {
  return {
    id,
    angles: { ecliptic: 10, equator: 10, galactic: 10 },
    position: [0, 0, 4] as [number, number, number],
    viewAngle: 0.1,
    viewDepth: 10,
    viewX: 0,
    viewY: 0,
    revision: 0,
    ...over
  };
}

test('阈值边界：角度差与视位置角距双条件缺一不可', () => {
  const bodies = [makeBody({ id: 'a' }), makeBody({ id: 'b' })];
  const t = DEFAULT_CONFIG.angleThresholdDeg;
  const sep = DEFAULT_CONFIG.angularSeparationRad;

  // 角差在阈值内 + 投影重叠 → 遮挡
  const inside = computeOcclusion(
    [manualPosition('a'), manualPosition('b', { angles: { ecliptic: 10 + t - 0.5, equator: 10, galactic: 10 }, viewDepth: 11 })],
    bodies,
    DEFAULT_CONFIG
  );
  assert.equal(inside.relations.length, 1);

  // 角差超阈值 → 不遮挡
  const outside = computeOcclusion(
    [manualPosition('a'), manualPosition('b', { angles: { ecliptic: 10 + t + 0.5, equator: 10 + t + 0.5, galactic: 10 + t + 0.5 }, viewDepth: 11 })],
    bodies,
    DEFAULT_CONFIG
  );
  assert.equal(outside.relations.length, 0);

  // 角差在阈值内但投影分离 → 不遮挡
  const separated = computeOcclusion(
    [manualPosition('a'), manualPosition('b', { viewX: sep + 0.01, viewDepth: 11 })],
    bodies,
    DEFAULT_CONFIG
  );
  assert.equal(separated.relations.length, 0);
});

test('引擎：同帧重复推演返回同一结果（引用与指纹）', () => {
  const engine = new SimulationEngine([makeBody({ id: 'a' }), makeBody({ id: 'b', phase0: 200 })], OBSERVER);
  const f1 = engine.getFrame(1234);
  const f2 = engine.getFrame(1234);
  const f3 = engine.getFrame(1234 + DEFAULT_CONFIG.timeQuantumMs * 0.4);
  assert.equal(f1, f2);
  assert.equal(f1, f3);
  assert.equal(f1.hash, f2.hash);
  assert.equal(engine.stats.frameHits, 2);
});

test('引擎：量化桶外产生新帧，三条环带角度确定不漂移', () => {
  const engine = new SimulationEngine([makeBody({ id: 'a' })], OBSERVER);
  const f1 = engine.getFrame(0);
  const f2 = engine.getFrame(DEFAULT_CONFIG.timeQuantumMs);
  assert.notEqual(f1, f2);
  for (const key of RING_KEYS) {
    const a = f1.bodies[0].angles[key];
    const b = new SimulationEngine([makeBody({ id: 'a' })], OBSERVER).getFrame(0).bodies[0].angles[key];
    assert.equal(a, b);
  }
});

test('引擎：参数修正只影响生效区间之后，且增量与整体重推一致', () => {
  const bodies = [makeBody({ id: 'a', period: 40000 }), makeBody({ id: 'b', phase0: 92 })];
  const engine = new SimulationEngine(bodies, OBSERVER);
  for (let t = 0; t <= 10000; t += 100) engine.getFrame(t);
  const untouched = engine.getFrame(900).hash;

  const fresh = new SimulationEngine(bodies, OBSERVER);
  engine.updateBody({ id: 'a', patch: { period: 20000 }, effectiveFrom: 5000 });
  fresh.updateBody({ id: 'a', patch: { period: 20000 }, effectiveFrom: 5000 });

  assert.equal(engine.getFrame(900).hash, untouched);
  for (let t = 0; t <= 10000; t += 100) {
    assert.equal(engine.getFrame(t).hash, fresh.getFrame(t).hash, `t=${t}`);
  }
  assert.equal(engine.getFrame(900).bodies[0].revision, 0);
  assert.equal(engine.getFrame(5000).bodies[0].revision, 1);
});

test('引擎：未推演过的旧时刻在修正后仍取旧参数', () => {
  const bodies = [makeBody({ id: 'a', period: 40000 }), makeBody({ id: 'b', phase0: 92 })];
  const engine = new SimulationEngine(bodies, OBSERVER);
  engine.getFrame(5000);
  engine.updateBody({ id: 'a', patch: { period: 20000 }, effectiveFrom: 5000 });
  const fresh = new SimulationEngine(bodies, OBSERVER);
  assert.equal(engine.getFrame(0).hash, fresh.getFrame(0).hash);
  assert.equal(engine.getFrame(0).bodies[0].revision, 0);
});

test('引擎：拖拽环带倾角后全部帧失效并重算，输入顺序不影响结果', () => {
  const bodies = [makeBody({ id: 'a' }), makeBody({ id: 'b', phase0: 100 })];
  const engine = new SimulationEngine(bodies, OBSERVER);
  engine.getFrame(0);
  const beforeStats = engine.stats.framesInvalidated;
  engine.setRingTilt({ equator: 45 });
  assert.ok(engine.stats.framesInvalidated > beforeStats);
  const engine2 = new SimulationEngine([bodies[1], bodies[0]], OBSERVER);
  engine2.setRingTilt({ equator: 45 });
  assert.equal(engine.getFrame(0).hash, engine2.getFrame(0).hash);
});

test('引擎：runRange 批量结果帧数与时刻正确', () => {
  const engine = new SimulationEngine([makeBody({ id: 'a' })], OBSERVER);
  const batch = engine.runRange({ start: 0, end: 500, step: 100 });
  assert.deepEqual(batch.frames.map((f) => f.time), [0, 100, 200, 300, 400, 500]);
  assert.deepEqual(batch.bodyIds, ['a']);
});

test('引擎：新增星体只影响生效时刻之后的集合与遮挡', () => {
  const engine = new SimulationEngine([makeBody({ id: 'a' })], OBSERVER);
  const before = engine.getFrame(0);
  assert.equal(before.bodies.length, 1);
  engine.addBody(makeBody({ id: 'new', phase0: 90.5 }), 5000);
  assert.equal(engine.getFrame(0).bodies.length, 1);
  assert.equal(engine.getFrame(0).hash, before.hash);
  assert.equal(engine.getFrame(5000).bodies.length, 2);
});
