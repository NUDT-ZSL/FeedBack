import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/whiteboard/history.ts';
import { createElement, emptyState } from '../src/whiteboard/types.ts';
import { visibleOrder } from '../src/whiteboard/serialize.ts';
import { checkInvariants } from '../src/whiteboard/invariants.ts';
import type { Op } from '../src/whiteboard/ops.ts';

interface Checkpoint {
  label: string;
  run: (board: Board) => void;
  expectVisible: string[];
}

const SCRIPT: Checkpoint[] = [
  {
    label: 'add a',
    run: (b) => b.dispatch({ type: 'add', element: createElement({ id: 'a' }) }),
    expectVisible: ['a'],
  },
  {
    label: 'add b',
    run: (b) => b.dispatch({ type: 'add', element: createElement({ id: 'b' }) }),
    expectVisible: ['a', 'b'],
  },
  {
    label: 'add c',
    run: (b) => b.dispatch({ type: 'add', element: createElement({ id: 'c' }) }),
    expectVisible: ['a', 'b', 'c'],
  },
  {
    label: 'add d',
    run: (b) => b.dispatch({ type: 'add', element: createElement({ id: 'd' }) }),
    expectVisible: ['a', 'b', 'c', 'd'],
  },
  {
    label: 'group b,c into g1',
    run: (b) => b.dispatch({ type: 'group', ids: ['b', 'c'], groupId: 'g1' }),
    expectVisible: ['a', 'g1', 'b', 'c', 'd'],
  },
  {
    label: 'group g1,d into g2',
    run: (b) => b.dispatch({ type: 'group', ids: ['g1', 'd'], groupId: 'g2' }),
    expectVisible: ['a', 'g2', 'g1', 'b', 'c', 'd'],
  },
  {
    label: 'move b out of g1 to root front',
    run: (b) => b.dispatch({ type: 'move', id: 'b', newParentId: null, toIndex: 0 }),
    expectVisible: ['b', 'a', 'g2', 'g1', 'c', 'd'],
  },
  {
    label: 'reorder a to the top of root',
    run: (b) => b.dispatch({ type: 'reorder', id: 'a', toIndex: 2 }),
    expectVisible: ['b', 'g2', 'g1', 'c', 'd', 'a'],
  },
  {
    label: 'update c fill (order unchanged)',
    run: (b) => b.dispatch({ type: 'update', id: 'c', patch: { fill: '#123456' } }),
    expectVisible: ['b', 'g2', 'g1', 'c', 'd', 'a'],
  },
  {
    label: 'ungroup g1 lifts c into g2',
    run: (b) => b.dispatch({ type: 'ungroup', groupId: 'g1' }),
    expectVisible: ['b', 'g2', 'c', 'd', 'a'],
  },
  {
    label: 'remove g2 deletes its whole subtree',
    run: (b) => b.dispatch({ type: 'remove', id: 'g2' }),
    expectVisible: ['b', 'a'],
  },
  {
    label: 'undo remove restores g2 subtree',
    run: (b) => {
      assert.equal(b.undo(), true);
    },
    expectVisible: ['b', 'g2', 'c', 'd', 'a'],
  },
  {
    label: 'undo ungroup restores g1 nesting',
    run: (b) => {
      assert.equal(b.undo(), true);
    },
    expectVisible: ['b', 'g2', 'g1', 'c', 'd', 'a'],
  },
  {
    label: 'redo ungroup flattens g1 again',
    run: (b) => {
      assert.equal(b.redo(), true);
    },
    expectVisible: ['b', 'g2', 'c', 'd', 'a'],
  },
];

test('scripted scenario matches expected visible order at every step', () => {
  const board = new Board(emptyState());
  SCRIPT.forEach((checkpoint, index) => {
    checkpoint.run(board);
    assert.deepEqual(
      visibleOrder(board.state),
      checkpoint.expectVisible,
      `step ${index} (${checkpoint.label}): visible order diverged`,
    );
    const problems = checkInvariants(board.state);
    assert.deepEqual(
      problems,
      [],
      `step ${index} (${checkpoint.label}): invariants violated: ${problems.join('; ')}`,
    );
  });
});
