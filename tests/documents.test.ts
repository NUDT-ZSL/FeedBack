import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimContext,
  dispatchDocument,
  updateMovingHorses,
  advance,
} from '../src/simulation.ts';
import {
  makeState,
  makeStation,
  makeDoc,
  makeClock,
  assertInvariants,
  findDoc,
  findLog,
  type FakeClock,
} from './helpers.ts';

const stepBy = (
  state: ReturnType<typeof makeState>,
  clock: FakeClock,
  totalMs: number,
  stepMs = 100
) => {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clock.advanceBy(stepMs);
    state = advance(state, clock.current);
    assertInvariants(state);
  }
  return state;
};

test('文书生命周期：pending → in-transit → delivered，状态与日志逐拍一致', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  assert.equal(findDoc(state, 'doc-1').status, 'pending');

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  assert.equal(findDoc(state, 'doc-1').status, 'in-transit');
  assert.equal(findDoc(state, 'doc-1').dispatchTime, clock.current);
  assert.equal(findLog(state, 'doc-1').status, 'in-transit');
  assert.equal(findLog(state, 'doc-1').arrivalTime, undefined);
  assertInvariants(state);

  state = stepBy(state, clock, 900);
  assert.equal(findDoc(state, 'doc-1').status, 'in-transit');
  assert.equal(findLog(state, 'doc-1').status, 'in-transit');
  assert.ok(state.movingHorses.some(mh => mh.documentId === 'doc-1'));

  state = stepBy(state, clock, 200);
  assert.equal(findDoc(state, 'doc-1').status, 'delivered');
  assert.equal(findLog(state, 'doc-1').status, 'delivered');
  assert.equal(state.movingHorses.length, 0);
});

test('送达日志：到达时间与耗时与发送时间对得上', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-2' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  const dispatchTime = clock.current;
  const duration = state.movingHorses[0].duration;

  state = stepBy(state, clock, duration);
  const arrivedDoc = findDoc(state, 'doc-1');
  const log = findLog(state, 'doc-1');
  assert.equal(arrivedDoc.arrivalTime, dispatchTime + duration);
  assert.equal(log.arrivalTime, dispatchTime + duration);
  assert.equal(log.duration, duration / 1000);
});

test('唯一性：同一份文书不会同时出现在在途与已送达，且不可重复发送', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  const redispatch = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-1');
  assert.equal(redispatch, state, '已在途的文书不应允许再次发送');
  assert.equal(redispatch.movingHorses.length, 1);

  state = stepBy(state, clock, 1000);
  const targetDoc = findDoc(state, 'doc-1');
  assert.equal(targetDoc.status, 'delivered');
  assert.ok(!state.movingHorses.some(mh => mh.documentId === 'doc-1'));

  const dispatchDelivered = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  assert.equal(dispatchDelivered, state, '已送达的文书不应允许再次发送');
});

test('进度迁移：在途进度从 0 单调推进到 1，到达后记录移除', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });
  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');

  clock.advanceBy(500);
  state = updateMovingHorses(state, clock.current);
  const midProgress = state.movingHorses[0].progress;
  assert.ok(midProgress > 0 && midProgress < 1, `中途进度异常: ${midProgress}`);

  clock.advanceBy(500);
  state = updateMovingHorses(state, clock.current);
  assert.equal(state.movingHorses.length, 0);
  assertInvariants(state);
});

test('多文书：不同行程时长的文书各自完成迁移，互不串状态', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const docs = [
    makeDoc({ id: 'doc-a', fromStation: 'station-0', toStation: 'station-1' }),
    makeDoc({ id: 'doc-b', fromStation: 'station-0', toStation: 'station-2' }),
  ];
  let state = makeState({
    stations: [makeStation(0, docs), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-a');
  state = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-b');
  assert.equal(state.movingHorses.length, 2);

  state = stepBy(state, clock, 1000);
  assert.equal(findDoc(state, 'doc-a').status, 'delivered');
  assert.equal(findDoc(state, 'doc-b').status, 'in-transit');
  assert.equal(findLog(state, 'doc-a').status, 'delivered');
  assert.equal(findLog(state, 'doc-b').status, 'in-transit');

  state = stepBy(state, clock, 1000);
  assert.equal(findDoc(state, 'doc-b').status, 'delivered');
  assert.equal(findLog(state, 'doc-b').status, 'delivered');
});
