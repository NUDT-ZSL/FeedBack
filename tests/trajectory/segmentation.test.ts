// seg-* ：停留段/移动段划分与异常输入暴露的批量验证。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  haversineMeters,
  segmentTrajectory,
} from '../../src/trajectory/index.ts';
import {
  COMP,
  mkPath,
  mkPoint,
  mkStay,
  offsetMeters,
  ORIGIN,
  SEG,
  T0,
} from './helpers.ts';

const MIN = SEG.minStayDurationMs;
const STEP = 60_000;

describe('segmentation: stay/move ordering', () => {
  it('seg-01 停留-移动-停留按时间顺序正确划分，点不重不漏', () => {
    const office = offsetMeters(ORIGIN.lng, ORIGIN.lat, 1000, 0);
    const points = [
      ...mkStay('T1', 'home-', T0, 6, STEP, ORIGIN),
      ...mkPath('T1', 'go-', T0 + 6 * STEP, STEP, [
        { dx: 200, dy: 0 },
        { dx: 400, dy: 0 },
        { dx: 600, dy: 0 },
        { dx: 800, dy: 0 },
      ]),
      ...mkStay('T1', 'office-', T0 + 10 * STEP, 6, STEP, office),
    ];

    const result = segmentTrajectory(points, SEG);
    assert.equal(result.issues.length, 0);
    assert.deepEqual(
      result.segments.map((s) => s.kind),
      ['stay', 'move', 'stay'],
    );

    const [stay1, move, stay2] = result.segments;
    assert.deepEqual(stay1.pointIds, ['home-0', 'home-1', 'home-2', 'home-3', 'home-4', 'home-5']);
    assert.deepEqual(move.pointIds, ['go-0', 'go-1', 'go-2', 'go-3']);
    assert.deepEqual(stay2.pointIds, [
      'office-0', 'office-1', 'office-2', 'office-3', 'office-4', 'office-5',
    ]);

    assert.equal(stay1.startMs, T0);
    assert.equal(stay1.endMs, T0 + 5 * STEP);
    assert.equal(stay2.startMs, T0 + 10 * STEP);
    assert.equal(stay2.endMs, T0 + 15 * STEP);
    // 段在时间上首尾相接
    assert.equal(move.startMs, stay1.endMs + STEP);
    assert.equal(move.endMs, stay2.startMs - STEP);
    assert.equal(stay1.anchor?.lng, points[0].lng ?? null);
    assert.equal(stay2.anchor?.lat, points[10].lat ?? null);
    assert.equal(move.anchor, null);

    // 全部点恰好被覆盖一次
    const covered = result.segments.flatMap((s) => s.pointIds).sort();
    assert.deepEqual(covered, points.map((p) => p.id).sort());
  });

  it('seg-02 最短停留时长为闭区间边界：恰好达到判停留，少 1ms 判移动', () => {
    const exact = segmentTrajectory(mkStay('T', 'a-', T0, 6, STEP, ORIGIN), SEG);
    assert.equal(exact.segments.length, 1);
    assert.equal(exact.segments[0].kind, 'stay');
    assert.equal(exact.segments[0].endMs - exact.segments[0].startMs, MIN);

    const shortPoints = mkStay('T', 'b-', T0, 6, STEP - 1, ORIGIN);
    const short = segmentTrajectory(shortPoints, SEG);
    assert.equal(short.segments.length, 1);
    assert.equal(short.segments[0].kind, 'move');
    assert.equal(short.segments[0].pointIds.length, 6);
  });

  it('seg-03 停留半径为闭区间：半径内吸收、超出则另起新段', () => {
    // 锚点 = 聚类首点；这里让首点恰好位于 ORIGIN，边界点相对锚点取 49.9m / 50.1m。
    const head = [mkPoint('h0', 'T', T0, ORIGIN.lng, ORIGIN.lat)];
    const inside = [
      ...head,
      ...mkStay('T', 'in-', T0 + STEP, 5, STEP, ORIGIN),
      (() => {
        const c = offsetMeters(ORIGIN.lng, ORIGIN.lat, 49.9, 0);
        return mkPoint('edge-in', 'T', T0 + 6 * STEP, c.lng, c.lat);
      })(),
    ];
    const r1 = segmentTrajectory(inside, SEG);
    assert.deepEqual(r1.segments.map((s) => s.kind), ['stay']);
    assert.ok(r1.segments[0].pointIds.includes('edge-in'));

    const broken = [
      ...head.map((p) => ({ ...p, id: 'g0' })),
      ...mkStay('T', 'out-', T0 + STEP, 5, STEP, ORIGIN),
      (() => {
        const c = offsetMeters(ORIGIN.lng, ORIGIN.lat, 50.1, 0);
        return mkPoint('edge-out', 'T', T0 + 6 * STEP, c.lng, c.lat);
      })(),
    ];
    const r2 = segmentTrajectory(broken, SEG);
    assert.deepEqual(r2.segments.map((s) => s.kind), ['stay', 'move']);
    assert.deepEqual(r2.segments[1].pointIds, ['edge-out']);
  });

  it('seg-04 采样抖动落在抖动带内时显式告警但保留在停留段中', () => {
    const points = mkStay('T', 'j-', T0, 7, STEP, ORIGIN);
    const shaky = offsetMeters(ORIGIN.lng, ORIGIN.lat, 30, 0);
    points[3] = mkPoint('j-3', 'T', T0 + 3 * STEP, shaky.lng, shaky.lat);

    const result = segmentTrajectory(points, SEG);
    const jitterIssues = result.issues.filter((i) => i.kind === 'jitter');
    assert.equal(jitterIssues.length, 1);
    assert.equal(jitterIssues[0].severity, 'warning');
    assert.equal(jitterIssues[0].pointId, 'j-3');
    assert.match(jitterIssues[0].message, /deviates [\d.]+m/);
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].kind, 'stay');
    assert.ok(result.segments[0].pointIds.includes('j-3'));
  });

  it('seg-05 坐标缺失以 error 显式暴露并排除，其余点仍正常成段', () => {
    const points = mkStay('T', 'm-', T0, 7, STEP, ORIGIN);
    points[3] = mkPoint('m-3', 'T', T0 + 3 * STEP, null, null);

    const result = segmentTrajectory(points, SEG);
    const issue = result.issues.find((i) => i.pointId === 'm-3');
    assert.ok(issue, 'missing-coordinates point must be reported, never silently dropped');
    assert.equal(issue?.kind, 'missing-coordinates');
    assert.equal(issue?.severity, 'error');

    assert.deepEqual(result.segments.map((s) => s.kind), ['stay']);
    assert.ok(!result.segments[0].pointIds.includes('m-3'));
    assert.equal(result.segments[0].pointIds.length, 6);
  });

  it('seg-06 时间倒序以 error 显式暴露并排除，后续正常点不被牵连', () => {
    const points = [
      mkPoint('p0', 'T', T0, ORIGIN.lng, ORIGIN.lat),
      mkPoint('p1', 'T', T0 + STEP, ORIGIN.lng, ORIGIN.lat),
      mkPoint('p2', 'T', T0 + 30_000, ORIGIN.lng, ORIGIN.lat), // 倒序
      mkPoint('p3', 'T', T0 + 2 * STEP, ORIGIN.lng, ORIGIN.lat),
    ];

    const result = segmentTrajectory(points, SEG);
    const issue = result.issues.find((i) => i.pointId === 'p2');
    assert.ok(issue);
    assert.equal(issue?.kind, 'out-of-order');
    assert.equal(issue?.severity, 'error');
    assert.match(issue?.message ?? '', /out of order/);

    const covered = result.segments.flatMap((s) => s.pointIds);
    assert.deepEqual(covered.sort(), ['p0', 'p1', 'p3']);
  });

  it('seg-07 非法时间戳（NaN）显式暴露', () => {
    const points = [
      mkPoint('p0', 'T', T0, ORIGIN.lng, ORIGIN.lat),
      mkPoint('p1', 'T', Number.NaN, ORIGIN.lng, ORIGIN.lat),
      mkPoint('p2', 'T', T0 + STEP, ORIGIN.lng, ORIGIN.lat),
    ];
    const result = segmentTrajectory(points, SEG);
    assert.equal(result.issues.some((i) => i.kind === 'invalid-timestamp' && i.pointId === 'p1'), true);
    const covered = result.segments.flatMap((s) => s.pointIds);
    assert.deepEqual(covered.sort(), ['p0', 'p2']);
  });

  it('seg-08 空输入与单点输入', () => {
    assert.deepEqual(segmentTrajectory([], SEG, 'T').segments, []);
    const single = segmentTrajectory([mkPoint('s0', 'T', T0, ORIGIN.lng, ORIGIN.lat)], SEG);
    assert.equal(single.segments.length, 1);
    assert.equal(single.segments[0].kind, 'move');
    assert.deepEqual(single.segments[0].pointIds, ['s0']);
  });

  it('seg-09 同样输入与参数任意时刻复现（含异常顺序）', () => {
    const points = [
      ...mkStay('T', 'a-', T0, 6, STEP, ORIGIN),
      mkPoint('bad', 'T', T0 + 1000, null, null),
      ...mkStay('T', 'b-', T0 + 8 * STEP, 6, STEP, offsetMeters(ORIGIN.lng, ORIGIN.lat, 800, 0)),
    ];
    const r1 = segmentTrajectory(points, SEG);
    const r2 = segmentTrajectory(points.map((p) => ({ ...p })), { ...SEG });
    assert.deepEqual(r1, r2);
  });

  it('seg-10 两个紧邻停留点（中间无移动点）也划分为两个相邻停留段', () => {
    const far = offsetMeters(ORIGIN.lng, ORIGIN.lat, 500, 0);
    const points = [
      ...mkStay('T', 's1-', T0, 6, STEP, ORIGIN),
      ...mkStay('T', 's2-', T0 + 6 * STEP, 6, STEP, far),
    ];
    const result = segmentTrajectory(points, SEG);
    assert.deepEqual(result.segments.map((s) => s.kind), ['stay', 'stay']);
    assert.notEqual(result.segments[0].id, result.segments[1].id);
  });

  it('seg-11 haversine 距离工具自洽：同点为 0，对称，量级正确', () => {
    assert.equal(haversineMeters(ORIGIN.lng, ORIGIN.lat, ORIGIN.lng, ORIGIN.lat), 0);
    const p = offsetMeters(ORIGIN.lng, ORIGIN.lat, 100, 0);
    const d1 = haversineMeters(ORIGIN.lng, ORIGIN.lat, p.lng, p.lat);
    const d2 = haversineMeters(p.lng, p.lat, ORIGIN.lng, ORIGIN.lat);
    assert.ok(Math.abs(d1 - 100) < 1, `expected ~100m, got ${d1}`);
    assert.equal(d1, d2);
    assert.equal(COMP.minOverlapMs >= 0, true);
  });
});
