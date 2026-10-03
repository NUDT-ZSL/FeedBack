import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentTarget } from '../src/trajectory/segment.ts';
import {
  DEFAULT_PARAMS,
  MIN,
  T0,
  baseTripPoints,
  clonePoints,
  stayPoints,
  HOME,
} from './fixtures.ts';

test('分段: 基础行程按时间顺序划分为 停留-移动-停留-移动-停留 [target=A]', () => {
  const points = baseTripPoints('A');
  const { segments, anomalies } = segmentTarget('A', points, DEFAULT_PARAMS);
  assert.deepEqual(anomalies, []);
  assert.deepEqual(
    segments.map((s) => s.type),
    ['stay', 'move', 'stay', 'move', 'stay'],
  );
  for (let i = 1; i < segments.length; i += 1) {
    assert.ok(segments[i].startTime >= segments[i - 1].endTime, '分段时间应单调不减');
  }
  const covered = segments.flatMap((s) => s.pointIds);
  assert.deepEqual(covered, points.map((p) => p.id), '所有有效点应被分段完整覆盖且保持时间顺序');
  const homeStay = segments[0];
  assert.equal(homeStay.startTime, T0);
  assert.equal(homeStay.endTime, T0 + 30 * MIN);
  assert.ok(Math.abs((homeStay.centroid?.lat ?? 0) - HOME.lat) < 0.0005, '停留质心应接近住所');
});

test('分段: 采样抖动在停留半径内仍判定为停留 [stayRadiusMeters=60, jitter=8m]', () => {
  const points = stayPoints('J', 'jit', HOME, 0, 9, 2, 8, 7);
  const { segments, anomalies } = segmentTarget('J', points, DEFAULT_PARAMS);
  assert.deepEqual(anomalies, []);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'stay');
  assert.equal(segments[0].pointIds.length, 9);
});

test('分段: 采样间隔超过 maxGapMs 时断开分段 [maxGapMs=20min]', () => {
  const morning = stayPoints('G', 'am', HOME, 0, 4, 5);
  const evening = stayPoints('G', 'pm', HOME, 200, 4, 5);
  const { segments } = segmentTarget('G', [...morning, ...evening], DEFAULT_PARAMS);
  assert.deepEqual(
    segments.map((s) => s.type),
    ['stay', 'stay'],
  );
  assert.ok(segments[1].startTime - segments[0].endTime > DEFAULT_PARAMS.maxGapMs);
});

test('异常: 时间倒序的点被显式暴露而非静默跳过 [point=A-m1-3]', () => {
  const points = baseTripPoints('A');
  const i1 = points.findIndex((p) => p.id === 'A-m1-2');
  const i2 = points.findIndex((p) => p.id === 'A-m1-3');
  [points[i1], points[i2]] = [points[i2], points[i1]];
  const { segments, anomalies } = segmentTarget('A', points, DEFAULT_PARAMS);
  const outOfOrder = anomalies.filter((a) => a.kind === 'out-of-order');
  assert.equal(outOfOrder.length, 1);
  assert.equal(outOfOrder[0].pointId, 'A-m1-2');
  assert.equal(outOfOrder[0].targetId, 'A');
  const sorted = segmentTarget('A', clonePoints(points), DEFAULT_PARAMS);
  assert.deepEqual(segments, sorted.segments, '倒序输入的分段结果应可复现');
});

test('异常: 坐标缺失的点被显式暴露且不参与分段 [point=A-cafe-2]', () => {
  const points = baseTripPoints('A').map((p) =>
    p.id === 'A-cafe-2' ? { ...p, lat: null } : p,
  );
  const { segments, anomalies } = segmentTarget('A', points, DEFAULT_PARAMS);
  const missing = anomalies.filter((a) => a.kind === 'missing-coordinate');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].pointId, 'A-cafe-2');
  const covered = segments.flatMap((s) => s.pointIds);
  assert.ok(!covered.includes('A-cafe-2'), '缺失坐标的点不应出现在任何分段中');
  const cafeStay = segments.find((s) => s.id === 'seg:A:A-cafe-1');
  assert.equal(cafeStay?.type, 'stay');
  assert.deepEqual(cafeStay?.pointIds, ['A-cafe-1', 'A-cafe-3']);
});

test('异常: 非法时间戳被显式暴露 [point=A-bad-ts]', () => {
  const points = [
    ...stayPoints('A', 'ok', HOME, 0, 3, 5),
    { id: 'A-bad-ts', targetId: 'A', timestamp: Number.NaN, lat: HOME.lat, lng: HOME.lng },
  ];
  const { segments, anomalies } = segmentTarget('A', points, DEFAULT_PARAMS);
  const invalid = anomalies.filter((a) => a.kind === 'invalid-timestamp');
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].pointId, 'A-bad-ts');
  assert.equal(segments.flatMap((s) => s.pointIds).includes('A-bad-ts'), false);
});

test('可复现: 同一输入与参数两次分段结果完全一致 [params=DEFAULT]', () => {
  const points = baseTripPoints('A');
  const first = segmentTarget('A', clonePoints(points), DEFAULT_PARAMS);
  const second = segmentTarget('A', clonePoints(points), DEFAULT_PARAMS);
  assert.deepEqual(first, second);
});
