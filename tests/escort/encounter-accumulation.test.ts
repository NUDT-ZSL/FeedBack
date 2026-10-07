/**
 * 风险一：途中多次遭遇同类事件时，
 * 货物损耗与队伍状态必须按预期累积，而不是互相覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEncounter,
  createInitialState,
  traverseRoute,
} from '../../src/escort/index.ts';
import { banditEvent, rainEvent, healthyRoute } from './fixtures.ts';

test('同一事件连续发生 N 次，货物损耗在剩余货物上逐次累积', () => {
  let state = createInitialState('team-alpha', 100);
  for (let i = 0; i < 3; i++) {
    state = applyEncounter(state, 'ridge', banditEvent);
  }
  // 100 * 0.9 * 0.9 * 0.9 = 72.9，而非单次 90 或被覆盖回 100
  assert.equal(state.cargo, 72.9);
  assert.equal(state.eventLog.length, 3);
});

test('同一事件连续发生 N 次，士气与体力逐次累加而非覆盖', () => {
  let state = createInitialState('team-alpha', 100, 80, 100);
  for (let i = 0; i < 3; i++) {
    state = applyEncounter(state, 'ridge', banditEvent);
  }
  // 士气 80 - 5*3 = 65；体力 100 - 10*3 = 70
  assert.equal(state.morale, 65);
  assert.equal(state.stamina, 70);
});

test('事件流水记录每次遭遇后的累积快照，可逐步追溯', () => {
  let state = createInitialState('team-alpha', 100);
  state = applyEncounter(state, 'gate', banditEvent);
  state = applyEncounter(state, 'ridge', banditEvent);

  assert.deepEqual(
    state.eventLog.map((r) => [r.seq, r.nodeId, r.cargoAfter]),
    [
      [1, 'gate', 90],
      [2, 'ridge', 81],
    ],
  );
});

test('不同类型事件交错发生时，各自影响在同一状态上累积', () => {
  let state = createInitialState('team-alpha', 100, 80, 100);
  state = applyEncounter(state, 'gate', banditEvent); // 货 90, 士气 75, 体力 90
  state = applyEncounter(state, 'ridge', rainEvent); // 货 85.5, 士气 75, 体力 82
  state = applyEncounter(state, 'inn', banditEvent); // 货 76.95, 士气 70, 体力 72

  assert.ok(Math.abs(state.cargo - 76.95) < 1e-9);
  assert.equal(state.morale, 70);
  assert.equal(state.stamina, 72);
});

test('整段路线推演后，结算快照反映全部遭遇的累积结果', () => {
  const outcome = traverseRoute(
    createInitialState('team-alpha', 100, 80, 100),
    healthyRoute,
    'gate',
  );
  assert.equal(outcome.status, 'arrived');
  if (outcome.status !== 'arrived') return;

  // 共 3 次山贼伏击：100 * 0.9^3 = 72.9
  assert.equal(outcome.settlement.eventsHandled, 3);
  assert.equal(outcome.settlement.cargoRemaining, 72.9);
  assert.equal(outcome.settlement.morale, 65);
  assert.equal(outcome.settlement.stamina, 70);
});
