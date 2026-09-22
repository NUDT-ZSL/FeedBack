const assert = require('assert');
const Engine = require('./engine');

function baseState() {
  const state = Engine.defaultState();
  state.batches = [
    { id: 'b1', name: '第一批', ready: true },
    { id: 'b2', name: '第二批', ready: true },
    { id: 'b3', name: '第三批', ready: false }
  ];
  state.currentBatchId = 'b2';
  state.targets = [
    { id: 't1', name: '目标一', batchId: 'b1', labels: ['edge'], baseConfig: [] },
    { id: 't2', name: '目标二', batchId: 'b2', labels: ['edge'], baseConfig: [] },
    { id: 't3', name: '目标三', batchId: 'b3', labels: ['edge'], baseConfig: [] }
  ];
  return state;
}

function config(result, targetId, key) {
  const target = result.targets.find(item => item.targetId === targetId);
  return target.configs.find(item => item.key === key);
}

function assertPartialEqualsFull(state, affectedTargetIds) {
  const full = Engine.evaluateAll(state);
  const partial = Engine.recomputeAffected(state, affectedTargetIds, state.currentBatchId);
  assert.deepStrictEqual(
    partial.targets.sort((a, b) => a.targetId.localeCompare(b.targetId)),
    affectedTargetIds
      .map(id => full.targets.find(item => item.targetId === id))
      .sort((a, b) => a.targetId.localeCompare(b.targetId))
  );
  return full;
}

function testPriorityBatchAndConflict() {
  const state = baseState();
  Engine.publishRule(state, 'R-A', {
    key: 'timeout', value: 'low', priority: 10, effectiveBatch: 'b1',
    scopeBatches: ['b1', 'b2'], scopeLabels: ['edge']
  });
  Engine.publishRule(state, 'R-B', {
    key: 'timeout', value: 'high', priority: 20, effectiveBatch: 'b2',
    scopeBatches: ['b2'], scopeLabels: ['edge']
  });

  state.currentBatchId = 'b1';
  const atB1 = Engine.evaluateAll(state);
  assert.strictEqual(config(atB1, 't1', 'timeout').status, 'active');
  assert.strictEqual(config(atB1, 't1', 'timeout').effectiveValue, 'low');

  state.currentBatchId = 'b2';
  const atB2 = Engine.evaluateAll(state);
  const t1 = config(atB2, 't1', 'timeout');
  const t2 = config(atB2, 't2', 'timeout');
  assert.strictEqual(t1.status, 'active');
  assert.strictEqual(t1.effectiveValue, 'low');
  assert.strictEqual(t2.status, 'conflict');
  assert.strictEqual(t2.effectiveValue, null);
  assert.strictEqual(t2.candidates.length, 2);
  assert.ok(t2.candidates.every(candidate => candidate.eligible));
  assert.strictEqual(t2.recommendedCandidateId, 'R-B@v1');

  Engine.resolveConflict(state, 't2', 'timeout', 'R-A@v1');
  const resolved = assertPartialEqualsFull(state, ['t2']);
  assert.strictEqual(config(resolved, 't2', 'timeout').effectiveValue, 'low');
  assert.strictEqual(config(resolved, 't2', 'timeout').chosenCandidateId, 'R-A@v1');
}

function testWithdrawIncremental() {
  const state = baseState();
  Engine.publishRule(state, 'R-A', {
    key: 'timeout', value: 'low', priority: 10, effectiveBatch: 'b1',
    scopeBatches: ['b1', 'b2'], scopeLabels: ['edge']
  });
  Engine.publishRule(state, 'R-B', {
    key: 'timeout', value: 'high', priority: 20, effectiveBatch: 'b2',
    scopeBatches: ['b1', 'b2'], scopeLabels: ['edge']
  });
  Engine.resolveConflict(state, 't1', 'timeout', 'R-B@v1');
  Engine.resolveConflict(state, 't2', 'timeout', 'R-A@v1');

  const result = Engine.withdrawRule(state, 'R-B', '回滚高优先级规则');
  const full = assertPartialEqualsFull(state, result.affectedTargetIds);
  assert.deepStrictEqual(result.affectedTargetIds.sort(), ['t1', 't2']);
  assert.strictEqual(config(full, 't1', 'timeout').effectiveValue, 'low');
  assert.strictEqual(config(full, 't2', 'timeout').effectiveValue, 'low');
  assert.strictEqual(config(full, 't2', 'timeout').status, 'active');

  const republished = Engine.publishRule(state, 'R-B', {
    key: 'timeout', value: 'restored', priority: 20, effectiveBatch: 'b2',
    scopeBatches: ['b1', 'b2'], scopeLabels: ['edge']
  });
  assertPartialEqualsFull(state, republished.affectedTargetIds);
  const rule = state.rules.find(item => item.id === 'R-B');
  assert.strictEqual(rule.withdrawReason, undefined);
}

function testScopeChangeIncremental() {
  const state = baseState();
  Engine.publishRule(state, 'R-A', {
    key: 'timeout', value: 'low', priority: 10, effectiveBatch: 'b1',
    scopeBatches: ['b1', 'b2'], scopeLabels: ['edge']
  });
  const result = Engine.publishRule(state, 'R-A', {
    key: 'timeout', value: 'updated', priority: 10, effectiveBatch: 'b1',
    scopeBatches: ['b2'], scopeLabels: ['edge']
  });
  const full = assertPartialEqualsFull(state, result.affectedTargetIds);
  assert.deepStrictEqual(result.affectedTargetIds.sort(), ['t1', 't2']);
  assert.strictEqual(config(full, 't1', 'timeout').status, 'inactive');
  assert.strictEqual(config(full, 't2', 'timeout').effectiveValue, 'updated');
  assert.strictEqual(config(full, 't2', 'timeout').effectiveVersion.version, 2);
}

function testBatchReadinessAndMissingReference() {
  const state = baseState();
  Engine.publishRule(state, 'R-GOOD', {
    key: 'timeout', value: 'low', priority: 10, effectiveBatch: 'b1',
    scopeBatches: ['b1'], scopeLabels: ['edge']
  });
  Engine.publishRule(state, 'R-MISSING', {
    key: 'other', value: 'on', priority: 1, effectiveBatch: 'b9',
    scopeBatches: ['b2', 'b9'], scopeLabels: ['edge']
  });
  Engine.setBatchReady(state, 'b1', false);

  const result = Engine.evaluateAll(state);
  const t1 = result.targets.find(item => item.targetId === 't1');
  const t3 = result.targets.find(item => item.targetId === 't3');
  assert.strictEqual(t1.untrusted, true);
  assert.strictEqual(t3.untrusted, true);
  assert.ok(t1.warnings.some(reason => reason.includes('批次未就绪')));
  const b1 = result.batches.find(batch => batch.id === 'b1');
  const b9 = result.batches.find(batch => batch.id === 'b9');
  assert.strictEqual(b1.trusted, false);
  assert.strictEqual(b9.trusted, false);
  assert.ok(b9.reasons.some(reason => reason.includes('R-MISSING')));
  assert.ok(config(result, 't2', 'other').warnings.length > 0);
}

testPriorityBatchAndConflict();
testWithdrawIncremental();
testScopeChangeIncremental();
testBatchReadinessAndMissingReference();
console.log('engine.test.js: all assertions passed');
