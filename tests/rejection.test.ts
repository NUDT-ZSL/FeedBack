import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/whiteboard/history.ts';
import { createElement, emptyState } from '../src/whiteboard/types.ts';
import { stateHash } from '../src/whiteboard/serialize.ts';
import { checkInvariants } from '../src/whiteboard/invariants.ts';
import { OpRejection } from '../src/whiteboard/errors.ts';
import type { Op } from '../src/whiteboard/ops.ts';
import type { RejectCode } from '../src/whiteboard/errors.ts';

function setupBoard(): Board {
  const board = new Board(emptyState());
  board.dispatch({ type: 'add', element: createElement({ id: 'a' }) });
  board.dispatch({ type: 'add', element: createElement({ id: 'b' }) });
  board.dispatch({ type: 'add', element: createElement({ id: 'c' }) });
  board.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' });
  board.dispatch({ type: 'group', ids: ['g1'], groupId: 'g2' });
  return board;
}

interface RejectCase {
  name: string;
  op: Op;
  code: RejectCode;
}

const CASES: RejectCase[] = [
  {
    name: 'add duplicate id',
    op: { type: 'add', element: createElement({ id: 'a' }) },
    code: 'ADD_DUPLICATE_ID',
  },
  {
    name: 'add under missing parent',
    op: { type: 'add', element: createElement({ id: 'x', parentId: 'nope' }) },
    code: 'ADD_MISSING_PARENT',
  },
  {
    name: 'add at out-of-range index',
    op: { type: 'add', element: createElement({ id: 'x' }), index: 99 },
    code: 'ADD_BAD_INDEX',
  },
  {
    name: 'update missing element',
    op: { type: 'update', id: 'ghost', patch: { x: 1 } },
    code: 'UPDATE_MISSING',
  },
  {
    name: 'update with empty patch',
    op: { type: 'update', id: 'a', patch: {} },
    code: 'UPDATE_NO_FIELDS',
  },
  {
    name: 'remove missing element',
    op: { type: 'remove', id: 'ghost' },
    code: 'REMOVE_MISSING',
  },
  {
    name: 'reorder missing element',
    op: { type: 'reorder', id: 'ghost', toIndex: 0 },
    code: 'REORDER_MISSING',
  },
  {
    name: 'reorder to out-of-range index',
    op: { type: 'reorder', id: 'a', toIndex: 5 },
    code: 'REORDER_BAD_INDEX',
  },
  {
    name: 'move missing element',
    op: { type: 'move', id: 'ghost', newParentId: null },
    code: 'MOVE_MISSING',
  },
  {
    name: 'move into missing group',
    op: { type: 'move', id: 'a', newParentId: 'nope' },
    code: 'MOVE_MISSING_PARENT',
  },
  {
    name: 'move element into a non-group parent',
    op: { type: 'move', id: 'a', newParentId: 'b' },
    code: 'MOVE_MISSING_PARENT',
  },
  {
    name: 'move group into its own descendant',
    op: { type: 'move', id: 'g2', newParentId: 'g1' },
    code: 'MOVE_INTO_SUBTREE',
  },
  {
    name: 'move to out-of-range index',
    op: { type: 'move', id: 'a', newParentId: null, toIndex: 99 },
    code: 'MOVE_BAD_INDEX',
  },
  {
    name: 'group with empty ids',
    op: { type: 'group', ids: [], groupId: 'g2' },
    code: 'GROUP_EMPTY',
  },
  {
    name: 'group with taken group id',
    op: { type: 'group', ids: ['a'], groupId: 'g1' },
    code: 'GROUP_ID_TAKEN',
  },
  {
    name: 'group referencing missing member',
    op: { type: 'group', ids: ['a', 'ghost'], groupId: 'g3' },
    code: 'GROUP_MISSING_ELEMENT',
  },
  {
    name: 'group members from different parents',
    op: { type: 'group', ids: ['a', 'b'], groupId: 'g3' },
    code: 'GROUP_MIXED_PARENTS',
  },
  {
    name: 'ungroup missing group',
    op: { type: 'ungroup', groupId: 'ghost' },
    code: 'UNGROUP_MISSING',
  },
  {
    name: 'ungroup a non-group element',
    op: { type: 'ungroup', groupId: 'a' },
    code: 'UNGROUP_NOT_GROUP',
  },
];

for (const testCase of CASES) {
  test(`rejects ${testCase.name} without changing state`, () => {
    const board = setupBoard();
    const before = stateHash(board.state);
    const depthBefore = board.undoDepth;

    assert.throws(
      () => board.dispatch(testCase.op),
      (err: unknown) =>
        err instanceof OpRejection && err.code === testCase.code,
      `expected rejection code ${testCase.code}`,
    );

    assert.equal(
      stateHash(board.state),
      before,
      'state hash changed after rejected op',
    );
    assert.equal(board.undoDepth, depthBefore, 'rejected op must not enter history');
    assert.deepEqual(checkInvariants(board.state), []);
  });
}

test('undo/redo on empty history are no-ops returning false', () => {
  const board = new Board(emptyState());
  assert.equal(board.undo(), false);
  assert.equal(board.redo(), false);
});

test('dispatching a new op clears the redo stack', () => {
  const board = setupBoard();
  board.undo();
  assert.equal(board.redoDepth, 1);
  board.dispatch({ type: 'add', element: createElement({ id: 'z' }) });
  assert.equal(board.redoDepth, 0);
  assert.equal(board.redo(), false);
});
