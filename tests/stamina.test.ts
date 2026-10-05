import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimContext,
  dispatchDocument,
  restSoldier,
  updateSoldierRest,
  advance,
  DEFAULT_SIM_CONFIG,
} from '../src/simulation.ts';
import { getEffectiveDuration } from '../src/utils.ts';
import {
  makeState,
  makeStation,
  makeDoc,
  makeHorses,
  makeClock,
  assertInvariants,
  findHorse,
} from './helpers.ts';

const buildReadyState = (stamina = 100, docCount = 6) => {
  const docs = Array.from({ length: docCount }, (_, i) =>
    makeDoc({
      id: `doc-a${i}`,
      fromStation: 'station-0',
      toStation: i % 2 === 0 ? 'station-1' : 'station-2',
    })
  );
  const state = makeState({
    stations: [makeStation(0, docs), makeStation(1), makeStation(2)],
    horses: makeHorses(8),
    soldier: { id: 'soldier-1', stamina, isResting: false },
  });
  return { state, docs };
};

test('驿卒体力：发送一次扣减固定值，连续扣减不越界', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  let { state } = buildReadyState(100);

  for (let i = 0; i < 5; i++) {
    state = dispatchDocument(state, ctx, 'station-0', `horse-${i}`, `doc-a${i}`);
    assert.equal(
      state.soldier.stamina,
      Math.max(0, 100 - DEFAULT_SIM_CONFIG.staminaCostPerDispatch * (i + 1)),
      `第 ${i + 1} 次发送后体力不正确`
    );
    assertInvariants(state);
  }
  assert.equal(state.soldier.stamina, 0);
});

test('驿卒体力：体力耗尽后无法继续发送，状态保持不变', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  let { state } = buildReadyState(100);

  for (let i = 0; i < 5; i++) {
    state = dispatchDocument(state, ctx, 'station-0', `horse-${i}`, `doc-a${i}`);
  }
  const before = state;
  const next = dispatchDocument(state, ctx, 'station-0', 'horse-5', 'doc-a5');
  assert.equal(next, before, '体力耗尽时发送不应产生新状态');
  assert.equal(next.movingHorses.length, 5);
  assert.equal(next.logs.length, 5);
  assert.equal(findHorse(next, 'horse-5').available, true);
  assertInvariants(next);
});

test('驿卒体力：体力恰好为 20 时可发送一次，扣到 0 后被拒绝', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  let { state } = buildReadyState(20, 2);

  state = dispatchDocument(state, ctx, 'station-0', 'horse-0', 'doc-a0');
  assert.equal(state.soldier.stamina, 0);
  const rejected = dispatchDocument(state, ctx, 'station-0', 'horse-1', 'doc-a1');
  assert.equal(rejected, state);
  assertInvariants(state);
});

test('驿卒休息：到点恢复体力，未到点不恢复，恢复不超过上限', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const { state: fresh } = buildReadyState(40, 1);

  let state = restSoldier(fresh, ctx);
  assert.equal(state.soldier.isResting, true);
  assert.equal(state.soldier.restEndTime, clock.current + DEFAULT_SIM_CONFIG.restDurationMs);

  clock.advanceBy(DEFAULT_SIM_CONFIG.restDurationMs - 1);
  const stillResting = updateSoldierRest(state, clock.current, ctx.config);
  assert.equal(stillResting, state, '休息尚未结束时不应产生状态变化');
  assert.equal(stillResting.soldier.stamina, 40);

  clock.advanceBy(1);
  state = updateSoldierRest(state, clock.current, ctx.config);
  assert.equal(state.soldier.isResting, false);
  assert.equal(state.soldier.stamina, 70);
  assertInvariants(state);

  // 再次休息：40 + 30 = 70，再休息一次应为 100 而不是越界
  state = restSoldier(state, ctx);
  clock.advanceBy(DEFAULT_SIM_CONFIG.restDurationMs);
  state = updateSoldierRest(state, clock.current, ctx.config);
  assert.equal(state.soldier.stamina, 100);
  assertInvariants(state);
});

test('驿卒休息：体力已满不能休息，休息中不能重复休息或发送', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const { state: full } = buildReadyState(100, 1);
  assert.equal(restSoldier(full, ctx), full);

  const { state: tiredState } = buildReadyState(40, 1);
  const resting = restSoldier(tiredState, ctx);
  assert.equal(restSoldier(resting, ctx), resting, '休息中重复休息应被拒绝');

  const dispatchWhileResting = dispatchDocument(resting, ctx, 'station-0', 'horse-0', 'doc-a0');
  assert.equal(dispatchWhileResting, resting, '休息中不应允许发送');
  assertInvariants(resting);
});

test('驿卒体力：耗尽 → 休息恢复后可以继续发送', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  let { state } = buildReadyState(100);

  for (let i = 0; i < 5; i++) {
    state = dispatchDocument(state, ctx, 'station-0', `horse-${i}`, `doc-a${i}`);
  }
  assert.equal(state.soldier.stamina, 0);

  state = restSoldier(state, ctx);
  clock.advanceBy(DEFAULT_SIM_CONFIG.restDurationMs);
  state = advance(state, clock.current, ctx.config);
  assert.equal(state.soldier.stamina, 30);

  state = dispatchDocument(state, ctx, 'station-0', 'horse-5', 'doc-a5');
  assert.equal(state.soldier.stamina, 10);
  assertInvariants(state);
});

test('体力口径：低体力（小于30）发送时行程时长按 1/0.7 系数延长', () => {
  const clock = makeClock();
  const ctx = createSimContext({ now: clock.now });
  const { state: stamina20 } = buildReadyState(20, 1);

  const next = dispatchDocument(stamina20, ctx, 'station-0', 'horse-0', 'doc-a0');
  const expected = getEffectiveDuration('normal', 20, 1) * 1000;
  assert.equal(next.movingHorses[0].duration, expected);
  assertInvariants(next);
});
