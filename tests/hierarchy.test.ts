import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/whiteboard/history.ts';
import { createElement, emptyState } from '../src/whiteboard/types.ts';
import { visibleOrder } from '../src/whiteboard/serialize.ts';
import { checkInvariants } from '../src/whiteboard/invariants.ts';
import { OpRejection } from '../src/whiteboard/errors.ts';
import type { Op } from '../src/whiteboard/ops.ts';

function add(id: string): Op {
  return { type: 'add', element: createElement({ id, x: 10, y: 10 }) };
}

function parentOf(board: Board, id: string): string | null {
  return board.state.elements[id]?.parentId ?? null;
}

test('group nesting produces correct parent ownership and visible DFS order', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c', 'd']) board.dispatch(add(id));

  board.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' });
  assert.deepEqual(board.state.rootOrder, ['a', 'g1', 'd']);
  assert.deepEqual(board.state.childOrder.g1, ['b', 'c']);
  assert.equal(parentOf(board, 'b'), 'g1');
  assert.equal(parentOf(board, 'g1'), null);
  assert.deepEqual(visibleOrder(board.state), ['a', 'g1', 'b', 'c', 'd']);

  board.dispatch({ type: 'group', ids: ['g1', 'd'], groupId: 'g2' });
  assert.deepEqual(board.state.rootOrder, ['a', 'g2']);
  assert.deepEqual(board.state.childOrder.g2, ['g1', 'd']);
  assert.deepEqual(board.state.childOrder.g1, ['b', 'c']);
  assert.deepEqual(visibleOrder(board.state), [
    'a', 'g2', 'g1', 'b', 'c', 'd',
  ]);
});

test('cross-group move updates parent, both child orders and visible order', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c', 'd', 'e']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' });
  board.dispatch({ type: 'group', ids: ['d', 'e'], groupId: 'g2' });

  board.dispatch({ type: 'move', id: 'b', newParentId: 'g2' });
  assert.equal(parentOf(board, 'b'), 'g2');
  assert.deepEqual(board.state.childOrder.g1, ['c']);
  assert.deepEqual(board.state.childOrder.g2, ['d', 'e', 'b']);
  assert.deepEqual(visibleOrder(board.state), [
    'a', 'g1', 'c', 'g2', 'd', 'e', 'b',
  ]);

  board.dispatch({ type: 'move', id: 'c', newParentId: null, toIndex: 0 });
  assert.equal(parentOf(board, 'c'), null);
  assert.deepEqual(board.state.rootOrder, ['c', 'a', 'g1', 'g2']);
  assert.deepEqual(board.state.childOrder.g1, []);
  assert.deepEqual(visibleOrder(board.state), [
    'c', 'a', 'g1', 'g2', 'd', 'e', 'b',
  ]);
});

test('deleting a group removes the whole subtree and cleans order lists', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c', 'd']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' });
  board.dispatch({ type: 'group', ids: ['g1', 'd'], groupId: 'g2' });

  board.dispatch({ type: 'remove', id: 'g2' });

  assert.deepEqual(Object.keys(board.state.elements), ['a']);
  assert.deepEqual(board.state.rootOrder, ['a']);
  assert.deepEqual(Object.keys(board.state.childOrder), []);
  assert.deepEqual(visibleOrder(board.state), ['a']);
  assert.deepEqual(checkInvariants(board.state), []);
});

test('ungroup lifts children into the parent at the group position', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c', 'd']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' });
  board.dispatch({ type: 'group', ids: ['g1', 'd'], groupId: 'g2' });

  board.dispatch({ type: 'ungroup', groupId: 'g1' });

  assert.equal(board.state.elements.g1, undefined);
  assert.equal(parentOf(board, 'b'), 'g2');
  assert.equal(parentOf(board, 'c'), 'g2');
  assert.deepEqual(board.state.childOrder.g2, ['b', 'c', 'd']);
  assert.deepEqual(visibleOrder(board.state), ['a', 'g2', 'b', 'c', 'd']);
  assert.deepEqual(checkInvariants(board.state), []);
});

test('reorder within a group only changes position inside that group', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['a', 'b'], groupId: 'g1' });
  board.dispatch({ type: 'reorder', id: 'b', toIndex: 0 });

  assert.deepEqual(board.state.childOrder.g1, ['b', 'a']);
  assert.deepEqual(visibleOrder(board.state), ['g1', 'b', 'a', 'c']);
});

test('moving a group into its own descendant is rejected without state change', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['a', 'b'], groupId: 'g1' });
  board.dispatch({ type: 'group', ids: ['g1'], groupId: 'g2' });

  const before = JSON.stringify(board.state);
  assert.throws(
    () => board.dispatch({ type: 'move', id: 'g2', newParentId: 'g1' }),
    (err: unknown) => err instanceof OpRejection && err.code === 'MOVE_INTO_SUBTREE',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(board.state)), JSON.parse(before));
});

test('grouping elements from different parents is rejected', () => {
  const board = new Board(emptyState());
  for (const id of ['a', 'b', 'c']) board.dispatch(add(id));
  board.dispatch({ type: 'group', ids: ['a', 'b'], groupId: 'g1' });

  assert.throws(
    () => board.dispatch({ type: 'group', ids: ['a', 'c'], groupId: 'g2' }),
    (err: unknown) => err instanceof OpRejection && err.code === 'GROUP_MIXED_PARENTS',
  );
  assert.equal(board.state.elements.g2, undefined);
  assert.deepEqual(checkInvariants(board.state), []);
});
