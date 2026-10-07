/**
 * 风险三：路线上存在无法通行或指向缺失的节点时，
 * 推演必须给出可追溯的失败结论，而不是静默跳过或误报到达。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, traverseRoute } from '../../src/escort/index.ts';
import { blockedRoute, missingNodeRoute, healthyRoute } from './fixtures.ts';

test('无法通行的节点导致推演失败，并给出节点与原因', () => {
  const outcome = traverseRoute(createInitialState('team-gamma'), blockedRoute, 'gate');

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') return;
  assert.equal(outcome.failure.code, 'ROUTE_NODE_IMPASSABLE');
  assert.equal(outcome.failure.nodeId, 'broken_bridge');
  assert.match(outcome.failure.reason, /断桥/);
});

test('失败结论包含失败前已途经的完整路径，可回溯', () => {
  const outcome = traverseRoute(createInitialState('team-gamma'), blockedRoute, 'gate');

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') return;
  assert.deepEqual(outcome.failure.path, ['gate', 'broken_bridge']);
});

test('指向缺失节点的路线导致推演失败，而不是静默跳过', () => {
  const outcome = traverseRoute(createInitialState('team-gamma'), missingNodeRoute, 'gate');

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') return;
  assert.equal(outcome.failure.code, 'ROUTE_NODE_MISSING');
  assert.equal(outcome.failure.nodeId, 'ghost_node');
  assert.deepEqual(outcome.failure.path, ['gate']);
});

test('失败推演不产生到达结算结果', () => {
  const blocked = traverseRoute(createInitialState('team-gamma'), blockedRoute, 'gate');
  const missing = traverseRoute(createInitialState('team-gamma'), missingNodeRoute, 'gate');

  assert.equal(blocked.status, 'failed');
  assert.equal(missing.status, 'failed');
  assert.equal(blocked.state.settlement, null);
  assert.equal(missing.state.settlement, null);
});

test('失败前已发生的事件损耗仍然保留在状态中，不丢失', () => {
  const outcome = traverseRoute(createInitialState('team-gamma', 100), blockedRoute, 'gate');

  assert.equal(outcome.status, 'failed');
  // gate 节点的山贼伏击已结算入账：100 * 0.9 = 90
  assert.equal(outcome.state.cargo, 90);
  assert.equal(outcome.state.eventLog.length, 1);
});

test('健康路线对照组：正常到达且结算成功', () => {
  const outcome = traverseRoute(createInitialState('team-gamma'), healthyRoute, 'gate');
  assert.equal(outcome.status, 'arrived');
});
