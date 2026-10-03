import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrajectoryEngine } from '../src/trajectory/engine.ts';
import {
  DEFAULT_PARAMS,
  MIN,
  T0,
  baseTripPoints,
  clonePoints,
  companionPoints,
  offsetMeters,
  patchPointInList,
  HOME,
} from './fixtures.ts';
import { assertStateEqual, fullRecomputeState } from './helpers.ts';

function loadTwoTargetEngine() {
  const points = [...baseTripPoints('A'), ...companionPoints('B')];
  const engine = new TrajectoryEngine(DEFAULT_PARAMS);
  engine.load(points);
  return { engine, points };
}

test('增量: 修正停留内离群点只重推受影响窗口 [point=A-home-4, window=[+0,+30]]', () => {
  const { points } = loadTwoTargetEngine();
  const outlierIndex = points.findIndex((p) => p.id === 'A-home-4');
  points[outlierIndex] = {
    ...points[outlierIndex],
    ...offsetMeters(HOME, 150, 130),
  };
  const outlierEngine = new TrajectoryEngine(DEFAULT_PARAMS);
  outlierEngine.load(clonePoints(points));

  const cafeBefore = outlierEngine.getSegments('A').find((s) => s.id === 'seg:A:A-cafe-1');
  const officeBefore = outlierEngine.getSegments('A').find((s) => s.id === 'seg:A:A-off-1');
  const coBefore = outlierEngine.getCoTravelIntervals('A', 'B')[0];

  const fixed = offsetMeters(HOME, 2, -2);
  const report = outlierEngine.correctPoint('A', 'A-home-4', fixed);

  assert.equal(report.reason, 'correctPoint:A/A-home-4');
  assert.ok(report.window, '应返回受影响时间窗口');
  assert.equal(report.window?.start, T0 + 0 * MIN);
  assert.equal(report.window?.end, T0 + 30 * MIN);
  assert.deepEqual(report.recomputedSegmentIds, ['seg:A:A-home-1'], '仅停留分段被重推');

  const cafeAfter = outlierEngine.getSegments('A').find((s) => s.id === 'seg:A:A-cafe-1');
  const officeAfter = outlierEngine.getSegments('A').find((s) => s.id === 'seg:A:A-off-1');
  const coAfter = outlierEngine.getCoTravelIntervals('A', 'B')[0];
  assert.equal(cafeAfter, cafeBefore, '窗口外的咖啡停留应保持对象稳定');
  assert.equal(officeAfter, officeBefore, '窗口外的办公室停留应保持对象稳定');
  assert.equal(coAfter, coBefore, '窗口外的同行区间应保持对象稳定');

  assert.deepEqual(
    outlierEngine.getSegments('A').map((s) => s.type),
    ['stay', 'move', 'stay', 'move', 'stay'],
  );

  const expectedInput = patchPointInList(clonePoints(points), 'A-home-4', fixed);
  assertStateEqual(
    outlierEngine.getState(),
    fullRecomputeState(expectedInput, DEFAULT_PARAMS),
    'correctPoint A-home-4',
  );
});

test('增量: 修正时间戳只重推相关同行区间 [point=B-off-1, +100→+95]', () => {
  const { engine } = loadTwoTargetEngine();
  const aSegsBefore = engine.getSegments('A');
  const patch = { timestamp: T0 + 95 * MIN };
  const report = engine.correctPoint('B', 'B-off-1', patch);

  assert.deepEqual(report.targetIds, ['B']);
  assert.equal(report.recomputedPairKeys.includes('A|B'), true);
  const intervals = engine.getCoTravelIntervals('A', 'B');
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].startTime, T0 + 95 * MIN, '同行区间应扩展到+95');
  assert.equal(intervals[0].endTime, T0 + 150 * MIN);
  for (const seg of aSegsBefore) {
    assert.ok(
      engine.getSegments('A').includes(seg),
      `目标A的分段 ${seg.id} 不应被重推`,
    );
  }

  const expectedPoints = [
    ...baseTripPoints('A'),
    ...patchPointInList(companionPoints('B'), 'B-off-1', patch),
  ];
  assertStateEqual(
    engine.getState(),
    fullRecomputeState(expectedPoints, DEFAULT_PARAMS),
    'correctPoint B-off-1 timestamp',
  );
});

test('增量: 调整判定参数只重推翻转的边界停留 [minStayDurationMs 10min→15min]', () => {
  const { engine } = loadTwoTargetEngine();
  const homeBefore = engine.getSegments('A').find((s) => s.id === 'seg:A:A-home-1');
  const cafeBefore = engine.getSegments('A').find((s) => s.id === 'seg:A:A-cafe-1');
  const officeBefore = engine.getSegments('A').find((s) => s.id === 'seg:A:A-off-1');
  const coBefore = engine.getCoTravelIntervals('A', 'B')[0];

  const report = engine.setParams({ minStayDurationMs: 15 * MIN });
  assert.deepEqual(report.recomputedSegmentIds, ['seg:A:A-m1-1'], '仅12分钟边界停留并入移动段');
  assert.equal(report.recomputedPairKeys.includes('A|B'), false, '办公室同行不受参数调整影响');
  assert.deepEqual(
    engine.getSegments('A').map((s) => s.type),
    ['stay', 'move', 'stay'],
  );

  const homeAfter = engine.getSegments('A').find((s) => s.id === 'seg:A:A-home-1');
  const officeAfter = engine.getSegments('A').find((s) => s.id === 'seg:A:A-off-1');
  const coAfter = engine.getCoTravelIntervals('A', 'B')[0];
  assert.equal(homeAfter, homeBefore, '30分钟停留不受参数调整影响');
  assert.equal(officeAfter, officeBefore, '60分钟停留不受参数调整影响');
  assert.equal(coAfter, coBefore, '未变化的同行区间应保持对象稳定');
  assert.equal(cafeBefore?.type, 'stay');

  const changedParams = { ...DEFAULT_PARAMS, minStayDurationMs: 15 * MIN };
  assertStateEqual(
    engine.getState(),
    fullRecomputeState([...baseTripPoints('A'), ...companionPoints('B')], changedParams),
    'setParams minStayDurationMs=15min',
  );
});

test('增量: 修正缺失坐标后异常消除且与全量重推一致 [point=A-cafe-2]', () => {
  const points = [...baseTripPoints('A'), ...companionPoints('B')].map((p) =>
    p.id === 'A-cafe-2' ? { ...p, lat: null } : p,
  );
  const engine = new TrajectoryEngine(DEFAULT_PARAMS);
  engine.load(clonePoints(points));
  assert.equal(
    engine.getAnomalies('A').some((a) => a.pointId === 'A-cafe-2'),
    true,
  );

  const fixed = offsetMeters({ lat: 31.2445, lng: 121.491 }, 1, 1);
  const report = engine.correctPoint('A', 'A-cafe-2', { lat: fixed.lat, lng: fixed.lng });
  assert.ok(report.recomputedSegmentIds.includes('seg:A:A-cafe-1'));
  assert.deepEqual(engine.getAnomalies('A'), []);

  const expectedPoints = patchPointInList(clonePoints(points), 'A-cafe-2', {
    lat: fixed.lat,
    lng: fixed.lng,
  });
  assertStateEqual(
    engine.getState(),
    fullRecomputeState(expectedPoints, DEFAULT_PARAMS),
    'correctPoint A-cafe-2 missing coordinate fixed',
  );
});

test('增量: 重推日志可追溯，序号与输入序列一致 [load→correct→setParams]', () => {
  const { engine } = loadTwoTargetEngine();
  engine.correctPoint('A', 'A-home-4', offsetMeters(HOME, 1, 1));
  engine.setParams({ stayRadiusMeters: 80 });
  assert.equal(engine.recomputeLog.length, 3);
  assert.deepEqual(
    engine.recomputeLog.map((r) => r.seq),
    [1, 2, 3],
  );
  assert.equal(engine.recomputeLog[1].reason, 'correctPoint:A/A-home-4');
  assert.equal(engine.recomputeLog[2].reason, 'setParams');
});
