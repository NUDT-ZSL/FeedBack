import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpError } from '../src/whiteboard/errors.ts';
import { Client, mergeClients, type MergeResult } from '../src/whiteboard/merge.ts';
import { applyOp } from '../src/whiteboard/ops.ts';
import { cloneBoard, createBoard, visibleOrder } from '../src/whiteboard/state.ts';
import { hashState } from '../src/whiteboard/serialize.ts';
import { ROOT_ID, type BoardState } from '../src/whiteboard/types.ts';
import { makeGroup, makeRect, makeSticky } from './helpers/factory.ts';

function sharedBase(): BoardState {
  const base = createBoard();
  applyOp(base, { kind: 'add', element: makeRect('r1', { x: 1, y: 2 }) });
  applyOp(base, { kind: 'add', element: makeSticky('s1', { text: 'seed' }) });
  applyOp(base, { kind: 'add', element: makeGroup('g1') });
  applyOp(base, { kind: 'add', element: makeRect('inner'), parentId: 'g1' });
  return base;
}

function fork(base: BoardState): { a: Client; b: Client } {
  return { a: new Client('client-a', cloneBoard(base)), b: new Client('client-b', cloneBoard(base)) };
}

function mergeBothWays(base: BoardState, a: Client, b: Client): { ab: MergeResult; ba: MergeResult } {
  return { ab: mergeClients(base, [a, b]), ba: mergeClients(base, [b, a]) };
}

test('concurrent edits to different fields of the same element are both preserved', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'update', id: 'r1', patch: { x: 100 } });
  b.dispatch({ kind: 'update', id: 'r1', patch: { color: '#ff0000' } });

  const { ab, ba } = mergeBothWays(base, a, b);
  const merged = ab.state.nodes.r1;
  assert.equal(merged.x, 100);
  assert.equal((merged as { color: string }).color, '#ff0000');
  assert.equal(ab.report.conflicts.length, 0, 'no conflict expected for disjoint fields');
  assert.equal(hashState(ab.state), hashState(ba.state), 'merge must be commutative');
});

test('concurrent edits to the same field resolve deterministically with a conflict note', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'update', id: 's1', patch: { text: 'from-a' } });
  b.dispatch({ kind: 'update', id: 's1', patch: { text: 'from-b' } });

  const { ab, ba } = mergeBothWays(base, a, b);
  assert.equal(hashState(ab.state), hashState(ba.state));
  const text = (ab.state.nodes.s1 as { text: string }).text;
  assert.ok(text === 'from-a' || text === 'from-b');
  assert.equal(ab.report.conflicts.length, 1);
  const conflict = ab.report.conflicts[0];
  assert.equal(conflict.type, 'field');
  assert.equal(conflict.elementId, 's1');
  assert.equal(conflict.field, 'text');
  assert.deepEqual(ab.report.conflicts, ba.report.conflicts, 'conflict report must be order-independent');
});

test('concurrent moves of the same element resolve deterministically with a conflict note', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'move', id: 's1', parentId: 'g1', index: 0 });
  b.dispatch({ kind: 'move', id: 's1', parentId: ROOT_ID, index: 0 });

  const { ab, ba } = mergeBothWays(base, a, b);
  assert.equal(hashState(ab.state), hashState(ba.state));
  assert.equal(ab.report.conflicts.filter((c) => c.type === 'move').length, 1);
  assert.ok(ab.state.nodes.s1, 'element must survive the merge');
});

test('delete vs concurrent update: delete wins and the update is reported, not silently lost', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'remove', id: 's1' });
  b.dispatch({ kind: 'update', id: 's1', patch: { text: 'late edit' } });

  const { ab, ba } = mergeBothWays(base, a, b);
  assert.ok(ab.state.nodes.s1 === undefined);
  assert.equal(hashState(ab.state), hashState(ba.state));

  const conflict = ab.report.conflicts.find((c) => c.type === 'delete-wins');
  assert.ok(conflict, 'delete-wins conflict must be reported');
  assert.equal(conflict.elementId, 's1');
  const dropped = ab.report.dropped.find((d) => d.reason === 'target-deleted');
  assert.ok(dropped, 'discarded update must appear in the dropped list');
  assert.deepEqual(
    (dropped.record.op as { patch: unknown }).patch,
    { text: 'late edit' },
    'dropped op payload is preserved for manual recovery',
  );
});

test('delete group vs concurrent move-into: moved element survives at root', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'remove', id: 'g1' });
  b.dispatch({ kind: 'move', id: 's1', parentId: 'g1', index: 0 });

  const { ab, ba } = mergeBothWays(base, a, b);
  assert.ok(ab.state.nodes.g1 === undefined, 'group stays deleted');
  assert.ok(ab.state.nodes.inner === undefined, 'original subtree stays deleted');
  assert.ok(ab.state.nodes.s1, 'concurrently moved element must not be lost');
  assert.equal(ab.state.parent.s1, ROOT_ID, 'surviving element is re-attached to root');
  assert.equal(hashState(ab.state), hashState(ba.state));
  assert.ok(ab.report.conflicts.some((c) => c.type === 'delete-vs-move-into'));
});

test('adds from both sides are all preserved in the merged state', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'add', element: makeRect('a-new') });
  a.dispatch({ kind: 'add', element: makeSticky('a-note'), parentId: 'g1' });
  b.dispatch({ kind: 'add', element: makeRect('b-new') });

  const { ab } = mergeBothWays(base, a, b);
  for (const id of ['a-new', 'a-note', 'b-new']) {
    assert.ok(ab.state.nodes[id], `missing ${id} after merge`);
  }
  const order = visibleOrder(ab.state);
  assert.equal(order.length, Object.keys(ab.state.nodes).length, 'every node appears exactly once in z-order');
  for (const id of ['a-new', 'a-note', 'b-new']) {
    assert.ok(order.includes(id), `${id} missing from visible order`);
  }
});

test('merge is deterministic: repeated runs produce identical state and report', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'update', id: 'r1', patch: { x: 7 } });
  b.dispatch({ kind: 'update', id: 'r1', patch: { x: 9 } });
  b.dispatch({ kind: 'move', id: 'r1', parentId: 'g1', index: 0 });
  a.dispatch({ kind: 'remove', id: 's1' });

  const first = mergeClients(base, [a, b]);
  const second = mergeClients(base, [a, b]);
  assert.equal(hashState(first.state), hashState(second.state));
  assert.equal(JSON.stringify(first.report), JSON.stringify(second.report));
});

test('convergence: both clients adopt the merged state and continue from it', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  a.dispatch({ kind: 'update', id: 'r1', patch: { x: 50 } });
  b.dispatch({ kind: 'add', element: makeRect('b-shape') });

  const merged = mergeClients(base, [a, b]);
  a.adopt(merged.state);
  b.adopt(merged.state);
  assert.equal(hashState(a.state), hashState(b.state));

  a.dispatch({ kind: 'update', id: 'b-shape', patch: { x: 3 } });
  const remerged = mergeClients(merged.state, [a, b]);
  assert.equal((remerged.state.nodes['b-shape'] as { x: number }).x, 3);
});

test('locally rejected ops never enter the shared log and leave the client untouched', () => {
  const base = sharedBase();
  const { a, b } = fork(base);
  const before = hashState(a.state);

  assert.throws(
    () => a.dispatch({ kind: 'move', id: 'g1', parentId: 'g1' }),
    (error: unknown) => error instanceof OpError && error.code === 'CYCLE',
  );
  assert.equal(hashState(a.state), before);
  assert.equal(a.log.length, 0);

  b.dispatch({ kind: 'update', id: 'r1', patch: { y: 8 } });
  const merged = mergeClients(base, [a, b]);
  assert.equal(merged.report.dropped.length, 0);
  assert.equal(merged.state.nodes.r1.y, 8);
});

test('concurrent moves that would create a cycle are rejected during merge with a report entry', () => {
  const base = createBoard();
  applyOp(base, { kind: 'add', element: makeGroup('g1') });
  applyOp(base, { kind: 'add', element: makeGroup('g2') });
  const { a, b } = fork(base);
  a.dispatch({ kind: 'move', id: 'g1', parentId: 'g2' });
  b.dispatch({ kind: 'move', id: 'g2', parentId: 'g1' });

  const { ab, ba } = mergeBothWays(base, a, b);
  assert.equal(hashState(ab.state), hashState(ba.state));
  assert.ok(ab.report.dropped.some((d) => d.reason === 'CYCLE'), 'cycle-forming move must be rejected');
  assert.ok(ab.report.conflicts.some((c) => c.type === 'cycle'));
  // Exactly one of the two moves survived; the structure is still a valid tree
  const g1Parent = ab.state.parent.g1;
  const g2Parent = ab.state.parent.g2;
  assert.ok(
    (g1Parent === 'g2' && g2Parent === ROOT_ID) || (g2Parent === 'g1' && g1Parent === ROOT_ID),
    `invalid nesting after merge: g1->${g1Parent}, g2->${g2Parent}`,
  );
});
