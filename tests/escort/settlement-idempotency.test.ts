/**
 * 风险二：同一镖队被重复提交到达结算时，
 * 最终结果保持一致，不会被二次结算改写。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settleArrival,
  createInitialState,
  applyEncounter,
  traverseRoute,
} from '../../src/escort/index.ts';
import { banditEvent, healthyRoute } from './fixtures.ts';

test('对到达后的队伍重复结算，返回完全相同的结算结果', () => {
  let state = createInitialState('team-beta', 100, 80, 100);
  state = { ...state, distanceTraveled: 2 };
  state = applyEncounter(state, 'ridge', banditEvent);

  const first = settleArrival(state);
  assert.equal(first.repeated, false);

  const second = settleArrival(first.state);
  assert.equal(second.repeated, true);
  assert.deepEqual(second.settlement, first.settlement);
});

test('重复结算不产生额外镖银（不翻倍）也不改写队伍状态', () => {
  const first = settleArrival(createInitialState('team-beta'));
  const silverOnce = first.settlement.silver;

  const second = settleArrival(first.state);
  const third = settleArrival(second.state);

  assert.equal(second.settlement.silver, silverOnce);
  assert.equal(third.settlement.silver, silverOnce);
  assert.equal(third.state.cargo, first.state.cargo);
  assert.equal(third.state.eventLog.length, 0);
});

test('首次结算结果在状态中固化，后续结算引用同一结果对象', () => {
  const first = settleArrival(createInitialState('team-beta'));
  const second = settleArrival(first.state);
  assert.equal(second.settlement, first.state.settlement);
});

test('路线推演到达后再对同一结果重复结算，结论与数值一致', () => {
  const outcome = traverseRoute(createInitialState('team-beta'), healthyRoute, 'gate');
  assert.equal(outcome.status, 'arrived');
  if (outcome.status !== 'arrived') return;

  const resubmitted = settleArrival(outcome.state);
  assert.equal(resubmitted.repeated, true);
  assert.deepEqual(resubmitted.settlement, outcome.settlement);
  assert.equal(resubmitted.settlement.eventsHandled, 3);
});
