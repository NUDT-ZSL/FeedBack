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
  occupancyOf,
  ownerOf
} from './helpers/invariants.ts';

describe('字架取字与版盘落位', () => {
  it('正常路径：从字架取字落入空位后字符归属唯一', () => {
    let state = createInitialState();
    const id = state.rack[0].id;

    state = placeFromRack(state, id, 0);
    assertConsistent(state);
    assert.equal(ownerOf(state, id), 'board');
    assert.equal(state.board[0]?.id, id);
    assert.equal(state.board[0]?.position, 0);
    assert.equal(state.rack.length, 99);

    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.cells[0], '天');
    assert.equal(snapshot.placedCount, 1);
  });

  it('同一字符不能重复落位（已在版盘上的字模不在字架中）', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 0);

    assert.throws(
      () => placeFromRack(state, id, 1),
      (error: unknown) =>
        error instanceof CompositionError &&
        error.code === 'CHAR_NOT_IN_RACK'
    );
    assertConsistent(state);
  });

  it('占用格拒绝落位并保持位置与占用不变', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    const before = structuredClone(state);
    const secondId = state.rack.find((item) => item.id !== before.rack[0]?.id)!.id;

    assert.throws(
      () => placeFromRack(state, secondId, 0),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'CELL_OCCUPIED'
    );
    assert.deepEqual(state, before, '拒绝落位后状态应保持不变');
  });

  it('位置越界拒绝落位', () => {
    const state = createInitialState();
    const id = state.rack[0].id;
    assert.throws(
      () => placeFromRack(state, id, BOARD_CAPACITY),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'CELL_OUT_OF_RANGE'
    );
    assert.throws(
      () => placeFromRack(state, id, -1),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'CELL_OUT_OF_RANGE'
    );
    assert.throws(() => placeFromRack(state, id, 1.5));
    assertConsistent(state);
  });

  it('不存在的字模 ID 拒绝落位', () => {
    const state = createInitialState();
    assert.throws(() => placeFromRack(state, 'not-exist', 0), CompositionError);
    assertConsistent(state);
  });
});

describe('从版盘取回', () => {
  it('取回后位置释放、占用同步更新、字模归位字架', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 7);
    assert.deepEqual([...occupancyOf(state).keys()], [7]);

    state = takeBack(state, id);
    assertConsistent(state);
    assert.equal(ownerOf(state, id), 'rack');
    assert.equal(state.board[7], null);
    assert.deepEqual(emptyPositionsOf(state).length, BOARD_CAPACITY);
    assert.equal(state.rack.length, 100);
  });

  it('取回不在版盘上的字模被拒绝', () => {
    const state = createInitialState();
    assert.throws(
      () => takeBack(state, state.rack[0].id),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'CHAR_NOT_ON_BOARD'
    );
    assertConsistent(state);
  });

  it('取回后再放回同一位置：占用与归属正确恢复', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 3);
    state = takeBack(state, id);
    state = placeFromRack(state, id, 3);

    assertConsistent(state);
    assert.equal(ownerOf(state, id), 'board');
    assert.equal(state.board[3]?.id, id);
    assert.equal(state.board[3]?.position, 3);
    assert.equal(state.rack.length, 99);
  });

  it('取回后放入新位置，旧位置保持空闲', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 2);
    state = takeBack(state, id);
    state = placeFromRack(state, id, 5);

    assertConsistent(state);
    assert.equal(state.board[2], null);
    assert.equal(state.board[5]?.id, id);
  });
});

describe('版盘内移动与交换', () => {
  it('移到空位：原位置释放、新位置占用', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 0);
    state = movePlaced(state, 0, 10);

    assertConsistent(state);
    assert.equal(state.board[0], null);
    assert.equal(state.board[10]?.id, id);
    assert.equal(state.board[10]?.position, 10);
    assert.equal(state.rack.length, 99);
  });

  it('两个字模交换位置，位置记录同步更新', () => {
    let state = createInitialState();
    const first = state.rack[0].id;
    const second = state.rack[1].id;
    state = placeFromRack(state, first, 0);
    state = placeFromRack(state, second, 1);
    state = movePlaced(state, 0, 1);

    assertConsistent(state);
    assert.equal(state.board[0]?.id, second);
    assert.equal(state.board[0]?.position, 0);
    assert.equal(state.board[1]?.id, first);
    assert.equal(state.board[1]?.position, 1);
  });

  it('从空位发起移动被拒绝', () => {
    const state = createInitialState();
    assert.throws(() => movePlaced(state, 0, 1), CompositionError);
  });

  it('越界移动被拒绝且状态不变', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    const before = structuredClone(state);
    assert.throws(() => movePlaced(state, 0, BOARD_CAPACITY), CompositionError);
    assert.deepEqual(state, before);
  });
});

describe('清空印版', () => {
  it('清空后所有字模回收字架、版盘全部空闲', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    state = placeFromRack(state, state.rack[0].id, 1);
    state = clearBoard(state);

    assertConsistent(state);
    assert.equal(state.rack.length, 100);
    assert.equal(emptyPositionsOf(state).length, BOARD_CAPACITY);
  });

  it('空版盘清空为无操作', () => {
    const state = createInitialState();
    assert.equal(clearBoard(state), state);
  });
});
