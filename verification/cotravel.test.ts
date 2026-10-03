import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentTarget } from '../src/trajectory/segment.ts';
import { detectCoTravelForPair } from '../src/trajectory/cotravel.ts';
import {
  DEFAULT_PARAMS,
  MIN,
  T0,
  baseTripPoints,
  companionPoints,
  movingPairPoints,
  partialOverlapPoints,
  stayPoints,
  FAR_AWAY,
} from './fixtures.ts';

function segmentsOf(targetId: string, points: ReturnType<typeof baseTripPoints>) {
  const { segments, anomalies } = segmentTarget(targetId, points, DEFAULT_PARAMS);
  assert.deepEqual(anomalies, []);
  return segments;
}

test('同行: 时间区间完全包含时识别重叠部分 [B⊂A, coTravelDistanceMeters=100]', () => {
  const aSegs = segmentsOf('A', baseTripPoints('A'));
  const bSegs = segmentsOf('B', companionPoints('B'));
  const intervals = detectCoTravelForPair('A', aSegs, 'B', bSegs, DEFAULT_PARAMS);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].startTime, T0 + 100 * MIN, '同行起点应为被包含区间的起点');
  assert.equal(intervals[0].endTime, T0 + 150 * MIN);
  assert.equal(intervals[0].pairKey, 'A|B');
});

test('同行: 时间区间部分重叠与完全包含判定一致 [B2=[+140,+200]∩A=[+90,+150]]', () => {
  const aSegs = segmentsOf('A', baseTripPoints('A'));
  const b2Segs = segmentsOf('B2', partialOverlapPoints('B2'));
  const intervals = detectCoTravelForPair('A', aSegs, 'B2', b2Segs, DEFAULT_PARAMS);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].startTime, T0 + 140 * MIN, '部分重叠应取交集起点');
  assert.equal(intervals[0].endTime, T0 + 150 * MIN, '部分重叠应取交集终点');
});

test('同行: 移动段平行同行可识别 [C与D间距50m, 重叠[+10,+40]]', () => {
  const { c, d } = movingPairPoints();
  const cSegs = segmentsOf('C', c);
  const dSegs = segmentsOf('D', d);
  const intervals = detectCoTravelForPair('C', cSegs, 'D', dSegs, DEFAULT_PARAMS);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].startTime, T0 + 10 * MIN);
  assert.equal(intervals[0].endTime, T0 + 40 * MIN);
});

test('同行: 空间距离超阈值则无同行 [E在10km外]', () => {
  const aSegs = segmentsOf('A', baseTripPoints('A'));
  const eSegs = segmentsOf('E', stayPoints('E', 'far', FAR_AWAY, 90, 7, 10));
  const intervals = detectCoTravelForPair('A', aSegs, 'E', eSegs, DEFAULT_PARAMS);
  assert.deepEqual(intervals, []);
});

test('同行: 时间区间无重叠则无同行 [F在+300后出现]', () => {
  const aSegs = segmentsOf('A', baseTripPoints('A'));
  const fSegs = segmentsOf('F', stayPoints('F', 'late', FAR_AWAY, 300, 4, 10));
  const intervals = detectCoTravelForPair('A', aSegs, 'F', fSegs, DEFAULT_PARAMS);
  assert.deepEqual(intervals, []);
});

test('同行: 多目标两两组合均可判定 [A,B,B2三目标]', () => {
  const aSegs = segmentsOf('A', baseTripPoints('A'));
  const bSegs = segmentsOf('B', companionPoints('B'));
  const b2Segs = segmentsOf('B2', partialOverlapPoints('B2'));
  const ab = detectCoTravelForPair('A', aSegs, 'B', bSegs, DEFAULT_PARAMS);
  const ab2 = detectCoTravelForPair('A', aSegs, 'B2', b2Segs, DEFAULT_PARAMS);
  const bb2 = detectCoTravelForPair('B', bSegs, 'B2', b2Segs, DEFAULT_PARAMS);
  assert.equal(ab.length, 1);
  assert.equal(ab2.length, 1);
  assert.equal(bb2.length, 1, 'B与B2在办公室附近[+140,+150]也重叠');
  assert.equal(bb2[0].startTime, T0 + 140 * MIN);
  assert.equal(bb2[0].endTime, T0 + 150 * MIN);
});
