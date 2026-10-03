// inc-* ：位置点修正 / 参数调整后的增量重推验证。
// 核心不变量：增量结论 == 全量重推结论（deep-equal），且未受影响部分引用稳定。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrajectoryEngine } from '../../src/trajectory/index.ts';
import type { PositionPoint } from '../../src/trajectory/index.ts';
import {
  COMP,
  mkPath,
  mkStay,
  mulberry32,
  offsetMeters,
  ORIGIN,
  SEG,
  T0,
} from './helpers.ts';

const STEP = 60_000;
const OFFICE = offsetMeters(ORIGIN.lng, ORIGIN.lat, 1000, 0);
const OFFICE_B = offsetMeters(ORIGIN.lng, ORIGIN.lat, 1030, 0);
const FAR_C = offsetMeters(ORIGIN.lng, ORIGIN.lat, 5000, 0);

/** 目标 A：家(停留) → 去程(移动) → 公司(停留) → 回程(移动) → 家(停留) */
function buildTargetA(): PositionPoint[] {
  return [
    ...mkStay('A', 'a-home-', T0, 6, STEP, ORIGIN),
    ...mkPath('A', 'a-go-', T0 + 6 * STEP, STEP, [
      { dx: 200, dy: 0 }, { dx: 400, dy: 0 }, { dx: 600, dy: 0 }, { dx: 800, dy: 0 },
    ]),
    ...mkStay('A', 'a-office-', T0 + 10 * STEP, 6, STEP, OFFICE),
    ...mkPath('A', 'a-back-', T0 + 16 * STEP, STEP, [
      { dx: 800, dy: 0 }, { dx: 600, dy: 0 }, { dx: 400, dy: 0 }, { dx: 200, dy: 0 },
    ]),
    ...mkStay('A', 'a-eve-', T0 + 20 * STEP, 6, STEP, ORIGIN),
  ];
}

/** 目标 B：与 A 在公司附近同时段停留（相距约 30m，同行） */
function buildTargetB(): PositionPoint[] {
  return mkStay('B', 'b-office-', T0 + 10 * STEP, 6, STEP, OFFICE_B);
}

/** 目标 C：5km 外独自停留（与任何人不同行） */
function buildTargetC(): PositionPoint[] {
  return mkStay('C', 'c-far-', T0 + 10 * STEP, 6, STEP, FAR_C);
}

function buildEngine(): TrajectoryEngine {
  const engine = new TrajectoryEngine({ segmentation: SEG, companionship: COMP });
  engine.setPoints('A', buildTargetA());
  engine.setPoints('B', buildTargetB());
  engine.setPoints('C', buildTargetC());
  return engine;
}

function assertConsistent(engine: TrajectoryEngine, context: string): void {
  assert.deepEqual(
    engine.snapshot(),
    engine.fullRecomputeSnapshot(),
    `${context}: incremental result must equal full recompute`,
  );
}

describe('incremental recompute after corrections', () => {
  it('inc-01 停留段内小幅修正：只重推所在段，其余段引用不变，结论与全量一致', () => {
    const engine = buildEngine();
    const before = engine.snapshot();
    const officeStay = before.segmentsByTarget.A.find(
      (s) => s.kind === 'stay' && s.pointIds.includes('a-office-2'),
    );
    assert.ok(officeStay);

    const moved = offsetMeters(OFFICE.lng, OFFICE.lat, 8, 3);
    const report = engine.correctPoint('A', 'a-office-2', {
      lng: moved.lng,
      lat: moved.lat,
    });

    // 只有包含被修正点的旧分段被替换
    assert.deepEqual(report.removedSegmentIds, [officeStay.id]);
    assert.equal(report.changedSegmentIds.length, 1);
    assert.equal(report.reusedSegmentIds.length, before.segmentsByTarget.A.length - 1);

    const after = engine.snapshot();
    // 未受影响分段保持同一对象引用
    for (const oldSeg of before.segmentsByTarget.A) {
      if (oldSeg.id === officeStay.id) continue;
      const reused = after.segmentsByTarget.A.find((s) => s.id === oldSeg.id);
      assert.ok(reused, `segment ${oldSeg.id} must be reused`);
      assert.equal(reused, oldSeg, `segment ${oldSeg.id} must keep object identity`);
    }
    // 其他目标完全未动
    assert.equal(after.segmentsByTarget.B, before.segmentsByTarget.B);
    assert.equal(after.segmentsByTarget.C, before.segmentsByTarget.C);
    assertConsistent(engine, 'inc-01');
  });

  it('inc-02 修正导致停留瓦解：窗口自动扩展，结论仍与全量一致', () => {
    const engine = buildEngine();
    const before = engine.snapshot();
    const farAway = offsetMeters(ORIGIN.lng, ORIGIN.lat, 3000, 0);
    const report = engine.correctPoint('A', 'a-office-3', {
      lng: farAway.lng,
      lat: farAway.lat,
    });

    // 公司停留瓦解为移动：旧的分段序列 5 段 → 3 段
    const after = engine.snapshot();
    assert.deepEqual(
      after.segmentsByTarget.A.map((s) => s.kind),
      ['stay', 'move', 'stay'],
    );
    assert.ok(report.removedSegmentIds.length >= 2);
    // 首尾两个停留段未受影响且引用不变
    const home = before.segmentsByTarget.A[0];
    const eve = before.segmentsByTarget.A[4];
    assert.equal(after.segmentsByTarget.A[0], home);
    assert.equal(after.segmentsByTarget.A[2], eve);
    assertConsistent(engine, 'inc-02');
  });

  it('inc-03 多目标隔离：只重推受影响目标相关的同行对', () => {
    const engine = buildEngine();
    const before = engine.snapshot();
    assert.equal(before.companions['A|B'].length, 1, 'A and B should be companions near the office');
    assert.deepEqual(before.companions['B|C'], []);

    const moved = offsetMeters(OFFICE.lng, OFFICE.lat, 8, 3);
    const report = engine.correctPoint('A', 'a-office-2', {
      lng: moved.lng,
      lat: moved.lat,
    });

    assert.deepEqual(report.recomputedPairs, ['A|B', 'A|C']);
    assert.deepEqual(report.reusedPairs, ['B|C']);

    const after = engine.snapshot();
    // 未受影响的目标对保持同一数组引用
    assert.equal(after.companions['B|C'], before.companions['B|C']);
    // 受影响对结论与全量一致（A 仍在公司附近，同行区间不变）
    assert.deepEqual(after.companions['A|B'], before.companions['A|B']);
    assertConsistent(engine, 'inc-03');
  });

  it('inc-04 参数调整：全体目标重推，结论与全量一致', () => {
    const engine = buildEngine();
    const report = engine.updateParams({
      segmentation: { stayRadiusMeters: 12 },
    });
    assert.deepEqual(report.affectedTargets, ['A', 'B', 'C']);
    assert.deepEqual(report.recomputedPairs, ['A|B', 'A|C', 'B|C']);
    assert.deepEqual(report.reusedPairs, []);

    // 半径收紧到 12m 后，±5m 网格偏移的停留仍然成立（离锚点最远约 11.2m）
    const after = engine.snapshot();
    assert.equal(after.params.segmentation.stayRadiusMeters, 12);
    assert.ok(after.segmentsByTarget.A.some((s) => s.kind === 'stay'));
    assertConsistent(engine, 'inc-04');
  });

  it('inc-05 修正引入时间倒序：异常显式出现在报告中，结论与全量一致', () => {
    const engine = buildEngine();
    const report = engine.correctPoint('A', 'a-go-1', { timestamp: T0 - 1000 });
    const issue = report.issues.find((i) => i.pointId === 'a-go-1');
    assert.ok(issue, 'out-of-order correction must surface in the report');
    assert.equal(issue?.kind, 'out-of-order');
    assert.equal(issue?.severity, 'error');

    const covered = engine.snapshot().segmentsByTarget.A.flatMap((s) => s.pointIds);
    assert.ok(!covered.includes('a-go-1'));
    assertConsistent(engine, 'inc-05');
  });

  it('inc-06 修正引入坐标缺失：异常显式暴露，点被排除，结论与全量一致', () => {
    const engine = buildEngine();
    const report = engine.correctPoint('A', 'a-office-1', { lat: null });
    const issue = report.issues.find((i) => i.pointId === 'a-office-1');
    assert.ok(issue);
    assert.equal(issue?.kind, 'missing-coordinates');

    const covered = engine.snapshot().segmentsByTarget.A.flatMap((s) => s.pointIds);
    assert.ok(!covered.includes('a-office-1'));
    assertConsistent(engine, 'inc-06');
  });

  it('inc-07 随机修正属性化验证：25 个种子下增量 == 全量', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = mulberry32(seed);
      const engine = new TrajectoryEngine({ segmentation: SEG, companionship: COMP });
      const targetIds = ['A', 'B', 'C'].slice(0, 2 + Math.floor(rng() * 2));
      const built: Record<string, PositionPoint[]> = {};
      for (const tid of targetIds) {
        built[tid] = randomTrajectory(rng, tid);
        engine.setPoints(tid, built[tid]);
      }

      const tid = targetIds[Math.floor(rng() * targetIds.length)];
      const victim = built[tid][Math.floor(rng() * built[tid].length)];
      const roll = rng();
      let patch: { timestamp?: number; lng?: number | null; lat?: number | null };
      let desc: string;
      if (roll < 0.4) {
        const c = offsetMeters(ORIGIN.lng, ORIGIN.lat, rng() * 160 - 80, rng() * 160 - 80);
        patch = { lng: c.lng, lat: c.lat };
        desc = `coords->(${c.lng.toFixed(6)},${c.lat.toFixed(6)})`;
      } else if (roll < 0.7) {
        const ts = victim.timestamp + Math.floor((rng() - 0.5) * 360_000);
        patch = { timestamp: ts };
        desc = `timestamp->${ts}`;
      } else {
        patch = { lat: null };
        desc = 'lat->null';
      }

      engine.correctPoint(tid, victim.id, patch);
      assert.deepEqual(
        engine.snapshot(),
        engine.fullRecomputeSnapshot(),
        `inc-07 seed=${seed} target=${tid} point=${victim.id} patch=${desc}`,
      );
    }
  });

  it('inc-08 连续多次修正：每一步都与全量重推一致', () => {
    const engine = buildEngine();
    const corrections: Array<[string, string, Record<string, number | null>]> = [
      ['A', 'a-office-2', (() => { const c = offsetMeters(OFFICE.lng, OFFICE.lat, 8, 3); return { lng: c.lng, lat: c.lat }; })()],
      ['A', 'a-go-1', { timestamp: T0 + 6 * STEP + 500 }],
      ['B', 'b-office-4', (() => { const c = offsetMeters(OFFICE_B.lng, OFFICE_B.lat, 10, 0); return { lng: c.lng, lat: c.lat }; })()],
      ['A', 'a-eve-3', { lat: null }],
      ['C', 'c-far-0', (() => { const c = offsetMeters(FAR_C.lng, FAR_C.lat, 20, 0); return { lng: c.lng, lat: c.lat }; })()],
    ];
    corrections.forEach(([tid, pid, patch], i) => {
      engine.correctPoint(tid, pid, patch);
      assertConsistent(engine, `inc-08 step ${i} (${tid}/${pid})`);
    });
  });

  it('inc-09 长轨迹局部性：修正第 5 段，仅该段重推，其余 18 段引用不变', () => {
    const engine = new TrajectoryEngine({ segmentation: SEG, companionship: COMP });
    const points: PositionPoint[] = [];
    for (let leg = 0; leg < 10; leg++) {
      const center = offsetMeters(ORIGIN.lng, ORIGIN.lat, leg * 1000, 0);
      points.push(...mkStay('L', `stay${leg}-`, T0 + leg * 10 * STEP, 6, STEP, center));
      if (leg < 9) {
        points.push(
          ...mkPath('L', `move${leg}-`, T0 + leg * 10 * STEP + 6 * STEP, STEP, [
            { dx: leg * 1000 + 200, dy: 0 },
            { dx: leg * 1000 + 400, dy: 0 },
            { dx: leg * 1000 + 600, dy: 0 },
            { dx: leg * 1000 + 800, dy: 0 },
          ]),
        );
      }
    }
    engine.setPoints('L', points);
    const before = engine.snapshot();
    assert.equal(before.segmentsByTarget.L.length, 19); // 10 停留 + 9 移动

    const center4 = offsetMeters(ORIGIN.lng, ORIGIN.lat, 4000, 0);
    const moved = offsetMeters(center4.lng, center4.lat, 8, 3);
    const report = engine.correctPoint('L', 'stay4-2', { lng: moved.lng, lat: moved.lat });

    assert.equal(report.changedSegmentIds.length, 1, 'exactly one segment should be recomputed');
    assert.equal(report.removedSegmentIds.length, 1);
    assert.equal(report.reusedSegmentIds.length, 18);

    const after = engine.snapshot();
    let identical = 0;
    for (const oldSeg of before.segmentsByTarget.L) {
      const same = after.segmentsByTarget.L.find((s) => s.id === oldSeg.id);
      if (same !== undefined) {
        assert.equal(same, oldSeg);
        identical++;
      }
    }
    assert.equal(identical, 18);
    assertConsistent(engine, 'inc-09');
  });

  it('inc-10 可复现性：两台引擎喂同样数据，结论逐字节一致', () => {
    const e1 = buildEngine();
    const e2 = buildEngine();
    assert.deepEqual(e1.snapshot(), e2.snapshot());

    const moved = offsetMeters(OFFICE.lng, OFFICE.lat, 8, 3);
    e1.correctPoint('A', 'a-office-2', { lng: moved.lng, lat: moved.lat });
    e2.correctPoint('A', 'a-office-2', { lng: moved.lng, lat: moved.lat });
    assert.deepEqual(e1.snapshot(), e2.snapshot());
  });
});

/** 随机但确定性的轨迹：2-4 次停留，停留间以 3-5 个移动点连接 */
function randomTrajectory(rng: () => number, targetId: string): PositionPoint[] {
  const points: PositionPoint[] = [];
  let ts = T0;
  const stays = 2 + Math.floor(rng() * 3);
  for (let leg = 0; leg < stays; leg++) {
    const center = offsetMeters(
      ORIGIN.lng,
      ORIGIN.lat,
      Math.floor(rng() * 4000),
      Math.floor(rng() * 4000),
    );
    points.push(...mkStay(targetId, `${targetId}-s${leg}-`, ts, 6, STEP, center));
    ts += 6 * STEP;
    if (leg < stays - 1) {
      const hops = 3 + Math.floor(rng() * 3);
      const offsets = Array.from({ length: hops }, (_, i) => ({
        dx: Math.floor(rng() * 4000) + (i + 1) * 150,
        dy: Math.floor(rng() * 200),
      }));
      points.push(...mkPath(targetId, `${targetId}-m${leg}-`, ts, STEP, offsets));
      ts += hops * STEP;
    }
  }
  return points;
}
