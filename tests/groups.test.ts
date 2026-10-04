import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpError } from '../src/whiteboard/errors.ts';
import { applyOp } from '../src/whiteboard/ops.ts';
import { createBoard, visibleOrder } from '../src/whiteboard/state.ts';
import { hashState } from '../src/whiteboard/serialize.ts';
import { ROOT_ID } from '../src/whiteboard/types.ts';
import { makeCircle, makeGroup, makeRect, makeSticky } from './helpers/factory.ts';

test('nested groups expose parent links and a depth-first visible order', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeRect('d') });
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeGroup('g2'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeSticky('a'), parentId: 'g2' });
  applyOp(board, { kind: 'add', element: makeSticky('b'), parentId: 'g2' });
  applyOp(board, { kind: 'add', element: makeCircle('c'), parentId: 'g1' });

  assert.deepEqual(board.children[ROOT_ID], ['d', 'g1']);
  assert.deepEqual(board.children.g1, ['g2', 'c']);
  assert.deepEqual(board.children.g2, ['a', 'b']);
  assert.deepEqual(visibleOrder(board), ['d', 'g1', 'g2', 'a', 'b', 'c']);
});

test('cross-group move detaches from the old parent and inserts at the target index', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeGroup('g2') });
  applyOp(board, { kind: 'add', element: makeRect('a'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeRect('b'), parentId: 'g2' });

  applyOp(board, { kind: 'move', id: 'a', parentId: 'g2', index: 0 });
  assert.deepEqual(board.children.g1, []);
  assert.deepEqual(board.children.g2, ['a', 'b']);
  assert.equal(board.parent.a, 'g2');

  applyOp(board, { kind: 'move', id: 'b', parentId: ROOT_ID, index: 0 });
  assert.deepEqual(board.children.g2, ['a']);
  assert.deepEqual(board.children[ROOT_ID], ['b', 'g1', 'g2']);
});

test('reordering within a group changes z-order without changing parent links', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeRect('a'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeRect('b'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeRect('c'), parentId: 'g1' });

  applyOp(board, { kind: 'move', id: 'a', parentId: 'g1', index: 2 });
  assert.deepEqual(board.children.g1, ['b', 'c', 'a']);
  assert.equal(board.parent.a, 'g1');
});

test('deleting a group removes the whole subtree and fixes z-order', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeGroup('g2'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeRect('a'), parentId: 'g2' });
  applyOp(board, { kind: 'add', element: makeRect('b'), parentId: 'g1' });
  applyOp(board, { kind: 'add', element: makeRect('c') });

  applyOp(board, { kind: 'remove', id: 'g1' });
  assert.deepEqual(board.children[ROOT_ID], ['c']);
  assert.deepEqual(visibleOrder(board), ['c']);
  for (const id of ['g1', 'g2', 'a', 'b']) {
    assert.ok(board.nodes[id] === undefined);
    assert.ok(board.parent[id] === undefined);
  }
});

test('reject: moving a group into itself or a descendant leaves state unchanged', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeGroup('g2'), parentId: 'g1' });

  const before = hashState(board);
  assert.throws(
    () => applyOp(board, { kind: 'move', id: 'g1', parentId: 'g1' }),
    (error: unknown) => error instanceof OpError && error.code === 'CYCLE',
  );
  assert.throws(
    () => applyOp(board, { kind: 'move', id: 'g1', parentId: 'g2' }),
    (error: unknown) => error instanceof OpError && error.code === 'CYCLE',
  );
  assert.equal(hashState(board), before);
});

test('reject: deleting a child already removed by a cascading delete leaves state unchanged', () => {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeRect('a'), parentId: 'g1' });
  applyOp(board, { kind: 'remove', id: 'g1' });

  const before = hashState(board);
  assert.throws(
    () => applyOp(board, { kind: 'remove', id: 'a' }),
    (error: unknown) => error instanceof OpError && error.code === 'UNKNOWN_ELEMENT',
  );
  assert.equal(hashState(board), before);
});
