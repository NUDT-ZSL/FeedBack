import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpError } from '../src/whiteboard/errors.ts';
import { applyOp } from '../src/whiteboard/ops.ts';
import { createBoard } from '../src/whiteboard/state.ts';
import { hashState } from '../src/whiteboard/serialize.ts';
import { ROOT_ID } from '../src/whiteboard/types.ts';
import { makeCircle, makeGroup, makeRect, makeSticky } from './helpers/factory.ts';

function freshBoard() {
  const board = createBoard();
  applyOp(board, { kind: 'add', element: makeRect('r1') });
  applyOp(board, { kind: 'add', element: makeCircle('c1') });
  applyOp(board, { kind: 'add', element: makeGroup('g1') });
  applyOp(board, { kind: 'add', element: makeSticky('s1'), parentId: 'g1' });
  return board;
}

function expectReject(board: ReturnType<typeof createBoard>, op: Parameters<typeof applyOp>[1], code: OpError['code']) {
  const before = hashState(board);
  assert.throws(
    () => applyOp(board, op),
    (error: unknown) => error instanceof OpError && error.code === code,
    `expected ${code}`,
  );
  assert.equal(hashState(board), before, 'state changed despite rejected operation');
}

test('add appends to the end of the target container (top of z-order)', () => {
  const board = freshBoard();
  assert.deepEqual(board.children[ROOT_ID], ['r1', 'c1', 'g1']);
  assert.deepEqual(board.children.g1, ['s1']);
});

test('add at an explicit index inserts at that position', () => {
  const board = freshBoard();
  applyOp(board, { kind: 'add', element: makeRect('r0'), index: 0 });
  assert.deepEqual(board.children[ROOT_ID], ['r0', 'r1', 'c1', 'g1']);
});

test('update changes only the patched fields and inverse restores them', () => {
  const board = freshBoard();
  const inverse = applyOp(board, { kind: 'update', id: 'r1', patch: { x: 30, y: 40 } });
  assert.equal(board.nodes.r1.x, 30);
  assert.equal(board.nodes.r1.y, 40);
  applyOp(board, inverse[0]);
  assert.equal(board.nodes.r1.x, 0);
  assert.equal(board.nodes.r1.y, 0);
});

test('move reorders siblings and updates parent links', () => {
  const board = freshBoard();
  applyOp(board, { kind: 'move', id: 'r1', parentId: ROOT_ID, index: 2 });
  assert.deepEqual(board.children[ROOT_ID], ['c1', 'g1', 'r1']);
  assert.equal(board.parent.r1, ROOT_ID);
});

test('remove cascades descendants and inverse restores the subtree', () => {
  const board = freshBoard();
  const inverse = applyOp(board, { kind: 'remove', id: 'g1' });
  assert.ok(board.nodes.g1 === undefined);
  assert.ok(board.nodes.s1 === undefined);
  assert.ok(board.children.g1 === undefined);
  for (const op of inverse) applyOp(board, op);
  assert.deepEqual(board.children[ROOT_ID], ['r1', 'c1', 'g1']);
  assert.deepEqual(board.children.g1, ['s1']);
  assert.equal(board.parent.s1, 'g1');
});

test('reject: update unknown element leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'update', id: 'nope', patch: { x: 1 } }, 'UNKNOWN_ELEMENT');
});

test('reject: remove unknown element leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'remove', id: 'nope' }, 'UNKNOWN_ELEMENT');
});

test('reject: move unknown element leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'move', id: 'nope', parentId: ROOT_ID }, 'UNKNOWN_ELEMENT');
});

test('reject: add duplicate id leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'add', element: makeRect('r1') }, 'DUPLICATE_ID');
});

test('reject: add under a non-container element leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'add', element: makeRect('r2'), parentId: 'r1' }, 'NOT_A_GROUP');
});

test('reject: add under unknown parent leaves state unchanged', () => {
  expectReject(freshBoard(), { kind: 'add', element: makeRect('r2'), parentId: 'g9' }, 'UNKNOWN_ELEMENT');
});

test('reject: out-of-range indexes leave state unchanged', () => {
  const board = freshBoard();
  expectReject(board, { kind: 'add', element: makeRect('r2'), index: -1 }, 'BAD_INDEX');
  expectReject(board, { kind: 'add', element: makeRect('r2'), index: 99 }, 'BAD_INDEX');
  expectReject(board, { kind: 'move', id: 'r1', parentId: ROOT_ID, index: 99 }, 'BAD_INDEX');
});

test('reject: unknown, immutable and empty fields leave state unchanged', () => {
  const board = freshBoard();
  expectReject(board, { kind: 'update', id: 'r1', patch: { radius: 5 } }, 'UNKNOWN_FIELD');
  expectReject(board, { kind: 'update', id: 's1', patch: { points: [] } }, 'UNKNOWN_FIELD');
  expectReject(board, { kind: 'update', id: 'r1', patch: { id: 'r9' } }, 'IMMUTABLE_FIELD');
  expectReject(board, { kind: 'update', id: 'r1', patch: { type: 'circle' } }, 'IMMUTABLE_FIELD');
  expectReject(board, { kind: 'update', id: 'r1', patch: {} }, 'EMPTY_PATCH');
});

test('reject: operations on root are refused', () => {
  const board = freshBoard();
  expectReject(board, { kind: 'remove', id: ROOT_ID }, 'ROOT_OPERATION');
  expectReject(board, { kind: 'move', id: ROOT_ID, parentId: 'g1' }, 'ROOT_OPERATION');
});
