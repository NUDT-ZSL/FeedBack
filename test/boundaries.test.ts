import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_CAPACITY,
  CompositionError,
  clearBoard,
  createInitialState,
  exportSnapshot,
  movePlaced,
  placeFromRack,
  takeBack
} from '../src/state/composition.ts';
import {
  assertConsistent,
  emptyPositionsOf,
  occupiedPositionsOf
} from './helpers/invariants.ts';

function fillBoard(state: ReturnType<typeof createInitialState>) {
  let current = state;
  for (let position = 0; position < BOARD_CAPACITY; position += 1) {
    current = placeFromRack(current, current.rack[0].id, position);
  }
  return current;
}

describe('版盘满格边界', () => {
  it(`版盘容量为 ${BOARD_CAPACITY} 格，填满后占用与位置完全同步`, () => {
    const state = fillBoard(createInitialState());
    assertConsistent(state);
    assert.equal(occupiedPositionsOf(state).length, BOARD_CAPACITY);
    assert.equal(emptyPositionsOf(state).length, 0);
    assert.equal(state.rack.length, 100 - BOARD_CAPACITY);
    state.board.forEach((cell, index) => {
      assert.equal(cell?.position, index);
    });
  });

  it('满格后继续落位被拒绝，版盘内容不变', () => {
    const state = fillBoard(createInitialState());
    const before = structuredClone(state);

    assert.throws(
      () => placeFromRack(state, state.rack[0].id, 0),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'BOARD_FULL'
    );
    assert.throws(
      () => placeFromRack(state, state.rack[0].id, BOARD_CAPACITY - 1),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'BOARD_FULL'
    );
    assert.deepEqual(state, before);
  });

  it('满格后取回一格即可再次落位', () => {
    let state = fillBoard(createInitialState());
    const removedId = state.board[10]!.id;
    state = takeBack(state, removedId);
    assert.equal(state.board[10], null);

    const nextId = state.rack[0].id;
    state = placeFromRack(state, nextId, 10);
    assertConsistent(state);
    assert.equal(state.board[10]?.id, nextId);
    assert.equal(occupiedPositionsOf(state).length, BOARD_CAPACITY);
  });

  it('满格版盘导出包含全部字符，清空后导出为空', () => {
    let state = fillBoard(createInitialState());
    const full = exportSnapshot(state);
    assert.equal(full.placedCount, BOARD_CAPACITY);
    assert.ok(full.cells.every((cell) => cell !== null));

    state = clearBoard(state);
    const empty = exportSnapshot(state);
    assert.equal(empty.placedCount, 0);
    assert.ok(empty.cells.every((cell) => cell === null));
    assertConsistent(state);
  });

  it('满格版盘内移动与交换仍然一致', () => {
    let state = fillBoard(createInitialState());
    const idA = state.board[0]!.id;
    const idB = state.board[BOARD_CAPACITY - 1]!.id;
    state = movePlaced(state, 0, BOARD_CAPACITY - 1);

    assertConsistent(state);
    assert.equal(state.board[0]?.id, idB);
    assert.equal(state.board[BOARD_CAPACITY - 1]?.id, idA);
  });
});

describe('取回-放回循环边界', () => {
  it('同一字模反复取回放回 N 次后归属与占用仍一致', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    for (let round = 0; round < 20; round += 1) {
      state = placeFromRack(state, id, round % BOARD_CAPACITY);
      state = takeBack(state, id);
    }
    assertConsistent(state);
    assert.equal(state.rack.length, 100);
    assert.equal(occupiedPositionsOf(state).length, 0);
  });

  it('取回后立即放回同一格，导出内容与从未取回一致', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 7);
    const baseline = exportSnapshot(state);

    state = takeBack(state, id);
    state = placeFromRack(state, id, 7);
    const restored = exportSnapshot(state);

    assert.deepEqual(restored, baseline);
    assertConsistent(state);
  });
});
