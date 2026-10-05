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
  makeHorses,
  makeClock,
  assertInvariants,
  findDoc,
  findHorse,
  type FakeClock,
} from './helpers.ts';

/** 以 100ms 为粒度推进到指定时刻，每一步都校验全局不变量。 */
const stepTo = (
  state: ReturnType<typeof makeState>,
  clock: FakeClock,
  target: number,
  tick: (s: typeof state, t: number) => typeof state = advance
) => {
  while (clock.current < target) {
    clock.advanceBy(100);
    state = tick(state, clock.current);
    assertInvariants(state);
  }
  return state;
};

test('驿马释放：文书送达后驿马恢复可用，在途记录清除', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  assert.equal(findHorse(state, 'horse-0').available, false);
  assert.equal(state.movingHorses.length, 1);

  state = stepTo(state, clock, clock.current + 1000);
  assert.equal(findDoc(state, 'doc-1').status, 'delivered');
  assert.equal(findHorse(state, 'horse-0').available, true);
  assert.equal(state.movingHorses.length, 0);
});

test('时间边界：恰好到达 startTime + duration 的时刻判定送达', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const doc = makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' });
  let state = makeState({
    stations: [makeStation(0, [doc]), makeStation(1), makeStation(2)],
  });
  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  const duration = state.movingHorses[0].duration;

  state = updateMovingHorses(state, clock.current + duration);
  assert.equal(findDoc(state, 'doc-1').status, 'delivered');
  assert.equal(findHorse(state, 'horse-0').available, true);
  assertInvariants(state);
});

test('并发占用：同一驿马重复发送第二份文书会被拒绝', () => {
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
  assert.equal(findHorse(state, 'horse-0').available, false);

  const doubleBook = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-b');
  assert.equal(doubleBook, state, '占用中的驿马不应允许再次发送');
  assert.equal(doubleBook.movingHorses.length, 1);
  assert.equal(findDoc(doubleBook, 'doc-b').status, 'pending');

  // 换一匹空闲驿马仍可发送，互不影响
  state = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-b');
  assert.equal(state.movingHorses.length, 2);
  assertInvariants(state);

  state = stepTo(state, clock, clock.current + 3000);
  assert.equal(findDoc(state, 'doc-a').status, 'delivered');
  assert.equal(findDoc(state, 'doc-b').status, 'delivered');
  assert.equal(findHorse(state, 'horse-0').available, true);
  assert.equal(findHorse(state, 'horse-1').available, true);
});

test('并发在途：多匹驿马按各自行程独立释放，不错位', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  // 普通加急、满体力：行程 = 1s / 2s / 3s
  const docs = [
    makeDoc({ id: 'doc-1', fromStation: 'station-0', toStation: 'station-1' }),
    makeDoc({ id: 'doc-2', fromStation: 'station-0', toStation: 'station-2' }),
    makeDoc({ id: 'doc-3', fromStation: 'station-0', toStation: 'station-3' }),
  ];
  let state = makeState({
    stations: [makeStation(0, docs), makeStation(1), makeStation(2), makeStation(3)],
    horses: makeHorses(4),
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-1');
  clock.advanceBy(50);
  state = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-2');
  clock.advanceBy(50);
  state = dispatchDocument(state, ctx, 'station-0', 'horse-2', 'doc-3');
  assertInvariants(state);

  const arrivalOf = (docId: string) => {
    const mh = state.movingHorses.find(m => m.documentId === docId);
    assert.ok(mh, `文书 ${docId} 缺少在途记录`);
    return mh.startTime + mh.duration;
  };
  const arrival1 = arrivalOf('doc-1');
  const arrival2 = arrivalOf('doc-2');
  const arrival3 = arrivalOf('doc-3');
  assert.ok(arrival1 < arrival2 && arrival2 < arrival3, '行程时长应随距离递增');

  state = stepTo(state, clock, arrival1);
  assert.equal(findDoc(state, 'doc-1').status, 'delivered');
  assert.equal(findDoc(state, 'doc-2').status, 'in-transit');
  assert.equal(findDoc(state, 'doc-3').status, 'in-transit');
  assert.equal(findHorse(state, 'horse-0').available, true);
  assert.equal(findHorse(state, 'horse-1').available, false);
  assert.equal(findHorse(state, 'horse-2').available, false);

  state = stepTo(state, clock, arrival2);
  assert.equal(findDoc(state, 'doc-2').status, 'delivered');
  assert.equal(findDoc(state, 'doc-3').status, 'in-transit');
  assert.equal(findHorse(state, 'horse-1').available, true);
  assert.equal(findHorse(state, 'horse-2').available, false);

  state = stepTo(state, clock, arrival3);
  assert.equal(findDoc(state, 'doc-3').status, 'delivered');
  assert.equal(findHorse(state, 'horse-2').available, true);
  assert.equal(state.movingHorses.length, 0);
});

test('送达释放的驿马可以立即再次承担发送', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const docs = [
    makeDoc({ id: 'doc-a', fromStation: 'station-0', toStation: 'station-1' }),
    makeDoc({ id: 'doc-b', fromStation: 'station-0', toStation: 'station-1' }),
  ];
  let state = makeState({
    stations: [makeStation(0, docs), makeStation(1)],
    horses: makeHorses(1),
    soldier: { id: 'soldier-1', stamina: 100, isResting: false },
  });

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-a');
  state = stepTo(state, clock, clock.current + 1000);
  assert.equal(findHorse(state, 'horse-0').available, true);

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-b');
  assert.equal(findHorse(state, 'horse-0').available, false);
  assertInvariants(state);
  state = stepTo(state, clock, clock.current + 1000);
  assert.equal(findDoc(state, 'doc-b').status, 'delivered');
  assert.equal(findHorse(state, 'horse-0').available, true);
});
