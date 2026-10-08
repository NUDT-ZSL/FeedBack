import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_CAPACITY,
  clearBoard,
  createInitialState,
  exportSnapshot,
  placeFromRack,
  setFontSize,
  setInkColor,
  takeBack
} from '../src/state/composition.ts';
import {
  assertConsistent,
  emptyPositionsOf,
  occupancyOf
} from './helpers/invariants.ts';

describe('印样导出', () => {
  it('边界路径：空版盘导出得到空快照', () => {
    const state = createInitialState();
    const snapshot = exportSnapshot(state);

    assert.equal(snapshot.placedCount, 0);
    assert.equal(snapshot.cells.length, BOARD_CAPACITY);
    assert.ok(snapshot.cells.every((cell) => cell === null));
    assertConsistent(state);
  });

  it('导出是纯只读操作：连续导出不改变任何状态', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 2);
    state = placeFromRack(state, state.rack[0].id, 5);
    const stateBeforeExport = structuredClone(state);

    const first = exportSnapshot(state);
    const second = exportSnapshot(state);
    const third = exportSnapshot(state);

    assert.deepEqual(first, second, '连续导出结果应一致');
    assert.deepEqual(second, third);
    assert.deepEqual(state, stateBeforeExport, '导出后字架、版盘、设置均不得变化');
    assertConsistent(state);
  });

  it('导出快照携带导当次全局设置，修改设置后旧快照不被篡改', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    const before = exportSnapshot(state);

    state = setInkColor(state, '#666666');
    state = setFontSize(state, 44);
    const after = exportSnapshot(state);

    assert.equal(before.inkColor, '#1a1a1a');
    assert.equal(before.fontSize, 36);
    assert.equal(after.inkColor, '#666666');
    assert.equal(after.fontSize, 44);
    assert.deepEqual(before.cells, after.cells, '设置变化不影响已记录字符');
  });

  it('导出后清空：导出快照仍可读，版盘回到空态', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    state = placeFromRack(state, state.rack[0].id, 1);
    const saved = exportSnapshot(state);

    state = clearBoard(state);
    const emptySnapshot = exportSnapshot(state);

    assert.equal(saved.placedCount, 2);
    assert.equal(emptySnapshot.placedCount, 0);
    assert.deepEqual([...occupancyOf(state).keys()], []);
    assert.equal(emptyPositionsOf(state).length, BOARD_CAPACITY);
    assertConsistent(state);
  });

  it('导出 → 清空 → 再排样：不残留旧版盘内容或旧位置占用', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 8);
    state = placeFromRack(state, state.rack[0].id, 44);
    exportSnapshot(state);
    state = clearBoard(state);

    const idA = state.rack.find((item) => item.char === '诗')!.id;
    const idB = state.rack.find((item) => item.char === '书')!.id;
    state = placeFromRack(state, idA, 0);
    state = placeFromRack(state, idB, 44);

    assertConsistent(state);
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.placedCount, 2);
    assert.equal(snapshot.cells[8], null, '旧排样位置不应残留字符');
    assert.equal(snapshot.cells[0], '诗');
    assert.equal(snapshot.cells[44], '书');
  });

  it('导出 → 取回 → 再放回：占用位置与导出内容同步更新', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 3);
    exportSnapshot(state);
    state = takeBack(state, id);

    assert.equal(exportSnapshot(state).cells[3], null);
    state = placeFromRack(state, id, 6);
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.cells[3], null);
    assert.equal(snapshot.cells[6], '天');
    assert.equal(snapshot.placedCount, 1);
    assertConsistent(state);
  });

  it('连续导出 → 连续清空 → 连续导出保持稳定', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    exportSnapshot(state);
    exportSnapshot(state);
    state = clearBoard(state);
    state = clearBoard(state);
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.placedCount, 0);
    assertConsistent(state);
  });
});
