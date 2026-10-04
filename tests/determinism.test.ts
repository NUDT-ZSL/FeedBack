import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/whiteboard/history.ts';
import { stateHash } from '../src/whiteboard/serialize.ts';
import { emptyState } from '../src/whiteboard/types.ts';
import { generateScript, runSteps } from './helpers.ts';

test('same initial state + same op sequence yields identical state on every run', () => {
  const { steps } = generateScript(42, 250);
  const hashes: string[] = [];

  for (let run = 0; run < 3; run += 1) {
    const board = new Board();
    runSteps(board, steps, `run-${run}`);
    hashes.push(stateHash(board.state));
  }

  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});

test('two parallel boards stay hash-identical after every single step', () => {
  const { steps } = generateScript(7, 200);
  const a = new Board();
  const b = new Board();

  steps.forEach((step, index) => {
    runSteps(a, [step], `board-a step ${index}`);
    runSteps(b, [step], `board-b step ${index}`);
    assert.equal(
      stateHash(a.state),
      stateHash(b.state),
      `boards diverged at step ${index}: ${JSON.stringify(step.op)}`,
    );
  });
});

test('undo-all returns to the exact initial state; redo-all reproduces the final state', () => {
  const { steps } = generateScript(99, 200);
  const initialHash = stateHash(emptyState());

  for (let run = 0; run < 2; run += 1) {
    const board = new Board();
    runSteps(board, steps, `undo-run-${run}`);
    const finalHash = stateHash(board.state);

    while (board.undo()) {
      // drain
    }
    assert.equal(
      stateHash(board.state),
      initialHash,
      `run ${run}: undo-all did not restore the initial state`,
    );

    while (board.redo()) {
      // drain
    }
    assert.equal(
      stateHash(board.state),
      finalHash,
      `run ${run}: redo-all did not reproduce the final state`,
    );
  }
});

test('interleaved undo/redo is deterministic across runs', () => {
  const { steps } = generateScript(5, 120);
  const snapshots: string[] = [];

  for (let run = 0; run < 2; run += 1) {
    const board = new Board();
    runSteps(board, steps.slice(0, 80), `interleave-${run}`);
    for (let i = 0; i < 30; i += 1) board.undo();
    for (let i = 0; i < 12; i += 1) board.redo();
    for (let i = 0; i < 5; i += 1) board.undo();
    snapshots.push(stateHash(board.state));
  }

  assert.equal(snapshots[0], snapshots[1]);
});

test('different seeds produce different final states (script is not vacuous)', () => {
  const hashes = new Set<string>();
  for (const seed of [1, 2, 3]) {
    const { steps } = generateScript(seed, 150);
    const board = new Board();
    runSteps(board, steps, `seed-${seed}`);
    hashes.add(stateHash(board.state));
  }
  assert.equal(hashes.size, 3);
});
