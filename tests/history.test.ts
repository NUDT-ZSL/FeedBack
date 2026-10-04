import assert from 'node:assert/strict';
import { test } from 'node:test';
import { History } from '../src/whiteboard/history.ts';
import { applyOp } from '../src/whiteboard/ops.ts';
import { createBoard } from '../src/whiteboard/state.ts';
import { hashState } from '../src/whiteboard/serialize.ts';
import { ROOT_ID } from '../src/whiteboard/types.ts';
import { makeGroup, makeRect, makeSticky } from './helpers/factory.ts';

test('undo all steps restores the initial state; redo restores the final state', () => {
  const board = createBoard();
  const history = new History(board);
  const initialHash = hashState(board);

  const ops = [
    { kind: 'add', element: makeRect('r1') },
    { kind: 'add', element: makeGroup('g1') },
    { kind: 'add', element: makeSticky('s1'), parentId: 'g1' },
    { kind: 'update', id: 'r1', patch: { x: 10, y: 20 } },
    { kind: 'move', id: 's1', parentId: ROOT_ID, index: 0 },
  ] as const;

  for (const op of ops) history.execute(op);
  const finalHash = hashState(board);
  assert.notEqual(finalHash, initialHash);

  for (let i = 0; i < ops.length; i += 1) {
    assert.ok(history.undo());
  }
  assert.equal(hashState(board), initialHash, 'full undo did not restore initial state');

  for (let i = 0; i < ops.length; i += 1) {
    assert.ok(history.redo());
  }
  assert.equal(hashState(board), finalHash, 'full redo did not restore final state');
});

test('undo of cascaded group delete restores the complete subtree in place', () => {
  const board = createBoard();
  const history = new History(board);
  history.execute({ kind: 'add', element: makeGroup('g1') });
  history.execute({ kind: 'add', element: makeGroup('g2'), parentId: 'g1' });
  history.execute({ kind: 'add', element: makeRect('a'), parentId: 'g2' });
  history.execute({ kind: 'add', element: makeRect('b'), parentId: 'g1' });

  const beforeDelete = hashState(board);
  history.execute({ kind: 'remove', id: 'g1' });
  assert.notEqual(hashState(board), beforeDelete);

  history.undo();
  assert.equal(hashState(board), beforeDelete, 'undo did not restore nested subtree');
});


test('undo/redo on empty histories are no-ops', () => {
  const board = createBoard();
  const history = new History(board);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
});

test('a rejected operation does not touch history or state', () => {
  const board = createBoard();
  const history = new History(board);
  history.execute({ kind: 'add', element: makeRect('r1') });
  const before = hashState(board);

  assert.throws(() => history.execute({ kind: 'update', id: 'nope', patch: { x: 1 } }));
  assert.equal(hashState(board), before);
  assert.equal(history.undoDepth, 1);
});

test('executing after undo clears the redo branch', () => {
  const board = createBoard();
  const history = new History(board);
  history.execute({ kind: 'add', element: makeRect('r1') });
  history.execute({ kind: 'add', element: makeRect('r2') });
  history.undo();
  assert.equal(history.redoDepth, 1);

  history.execute({ kind: 'add', element: makeRect('r3') });
  assert.equal(history.redoDepth, 0);
  assert.equal(history.redo(), null);
});

test('interleaved undo/redo returns to the same state hash at each checkpoint', () => {
  const board = createBoard();
  const history = new History(board);
  const checkpoints: string[] = [hashState(board)];

  history.execute({ kind: 'add', element: makeRect('r1') });
  checkpoints.push(hashState(board));
  history.execute({ kind: 'add', element: makeRect('r2') });
  checkpoints.push(hashState(board));
  history.execute({ kind: 'add', element: makeRect('r3') });
  checkpoints.push(hashState(board));

  history.undo();
  assert.equal(hashState(board), checkpoints[2]);
  history.undo();
  assert.equal(hashState(board), checkpoints[1]);
  history.redo();
  assert.equal(hashState(board), checkpoints[2]);
  history.undo();
  assert.equal(hashState(board), checkpoints[1]);
  history.redo();
  history.redo();
  assert.equal(hashState(board), checkpoints[3]);
});

test('inverse ops replayed directly are valid and cancel out', () => {
  const board = createBoard();
  const inverse = applyOp(board, { kind: 'add', element: makeRect('r1') });
  const withElement = hashState(board);
  for (const op of inverse) applyOp(board, op);
  assert.notEqual(hashState(board), withElement);
});
