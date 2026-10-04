import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOp as apply } from '../src/whiteboard/ops.ts';
import { hashState, snapshot } from '../src/whiteboard/serialize.ts';
import { createBoard } from '../src/whiteboard/state.ts';
import { ROOT_ID } from '../src/whiteboard/types.ts';
import { makeCircle, makeGroup, makeRect, makeSticky } from './helpers/factory.ts';
import { assertTracesEqual, runScenario, type ScenarioStep } from './helpers/scenario.ts';

const SCENARIO: ScenarioStep[] = [
  { name: 'add r1', signal: { type: 'op', op: { kind: 'add', element: makeRect('r1') } } },
  { name: 'add c1', signal: { type: 'op', op: { kind: 'add', element: makeCircle('c1') } } },
  { name: 'add group g1', signal: { type: 'op', op: { kind: 'add', element: makeGroup('g1') } } },
  { name: 'add s1 into g1', signal: { type: 'op', op: { kind: 'add', element: makeSticky('s1'), parentId: 'g1' } } },
  { name: 'move s1 to root bottom', signal: { type: 'op', op: { kind: 'move', id: 's1', parentId: ROOT_ID, index: 0 } } },
  { name: 'update r1 position', signal: { type: 'op', op: { kind: 'update', id: 'r1', patch: { x: 12, y: 34 } } } },
  { name: 'add nested group g2', signal: { type: 'op', op: { kind: 'add', element: makeGroup('g2'), parentId: 'g1' } } },
  { name: 'move c1 into g2', signal: { type: 'op', op: { kind: 'move', id: 'c1', parentId: 'g2', index: 0 } } },
  { name: 'illegal cycle g1 into g2', signal: { type: 'op', op: { kind: 'move', id: 'g1', parentId: 'g2' } } },
  { name: 'illegal update of missing id', signal: { type: 'op', op: { kind: 'update', id: 'zzz', patch: { x: 1 } } } },
  { name: 'delete g1 cascade', signal: { type: 'op', op: { kind: 'remove', id: 'g1' } } },
  { name: 'undo delete', signal: { type: 'undo' } },
  { name: 'update s1 text', signal: { type: 'op', op: { kind: 'update', id: 's1', patch: { text: 'hello' } } } },
  { name: 'undo text edit', signal: { type: 'undo' } },
  { name: 'redo text edit', signal: { type: 'redo' } },
  { name: 'add r2 on top', signal: { type: 'op', op: { kind: 'add', element: makeRect('r2', { color: '#cc0000' }) } } },
  { name: 'undo r2', signal: { type: 'undo' } },
  { name: 'redo r2', signal: { type: 'redo' } },
  { name: 'illegal add under leaf', signal: { type: 'op', op: { kind: 'add', element: makeRect('r3'), parentId: 'r1' } } },
  { name: 'illegal bad index', signal: { type: 'op', op: { kind: 'move', id: 'r1', parentId: ROOT_ID, index: 99 } } },
];

test('same initial set + same op sequence produces identical traces across runs', () => {
  const first = runScenario(SCENARIO);
  const second = runScenario(SCENARIO);
  const third = runScenario(SCENARIO);

  assertTracesEqual(first.trace, second.trace);
  assertTracesEqual(second.trace, third.trace);
});

test('rejected steps are recorded with error codes and do not change the hash', () => {
  const { trace } = runScenario(SCENARIO);
  const rejected = trace.filter((entry) => entry.rejected !== null);
  assert.deepEqual(
    rejected.map((entry) => ({ index: entry.index, name: entry.name, code: entry.rejected })),
    [
      { index: 8, name: 'illegal cycle g1 into g2', code: 'CYCLE' },
      { index: 9, name: 'illegal update of missing id', code: 'UNKNOWN_ELEMENT' },
      { index: 18, name: 'illegal add under leaf', code: 'NOT_A_GROUP' },
      { index: 19, name: 'illegal bad index', code: 'BAD_INDEX' },
    ],
  );
  for (const entry of rejected) {
    assert.equal(entry.hash, trace[entry.index - 1].hash, `rejected step ${entry.name} changed state`);
  }
});

test('golden final state hash anchors the whole pipeline against silent drift', () => {
  const { state, trace } = runScenario(SCENARIO);
  const GOLDEN = '526b407681444a98';
  assert.equal(hashState(state), GOLDEN, () => `final hash ${hashState(state)}; full trace:\n${trace
    .map((entry) => `${entry.index}: ${entry.hash} ${entry.rejected ?? ''} ${entry.name}`)
    .join('\n')}`);
});

test('canonical serialization ignores insertion order and clones byte-for-byte', () => {
  const a = createBoard();
  const b = createBoard();
  const ops = [
    { kind: 'add', element: makeRect('r1', { x: 5 }) },
    { kind: 'add', element: makeSticky('s1', { text: 'note' }) },
    { kind: 'add', element: makeGroup('g1') },
  ] as const;
  for (const op of ops) apply(a, op);
  for (const op of [...ops].reverse()) apply(b, op);

  // Same membership, different sibling order -> different hash (order is observable)
  assert.notEqual(hashState(a), hashState(b));

  // A re-built state with the same sibling order serializes identically
  const c = createBoard();
  for (const op of ops) apply(c, op);
  assert.equal(snapshot(a), snapshot(c));
});
