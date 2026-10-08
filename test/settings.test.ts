import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CompositionError,
  createInitialState,
  exportSnapshot,
  placeFromRack,
  setFontSize,
  setInkColor,
  setInkMix,
  takeBack
} from '../src/state/composition.ts';
import { FONT_SIZES, INK_COLORS } from '../src/data/characters.ts';
import { assertConsistent } from './helpers/invariants.ts';

describe('墨色全局设置', () => {
  it('默认墨色为焦墨，初始混合值为 100', () => {
    const state = createInitialState();
    assert.equal(state.inkColor.value, '#1a1a1a');
    assert.equal(state.inkMix, 100);
  });

  it('切换墨色后已落位字符的导出表现同步变化', () => {
    let state = createInitialState();
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 0);

    state = setInkColor(state, '#808080');
    assertConsistent(state);
    assert.equal(state.inkColor.name, '清');
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.inkColor, '#808080');
    assert.equal(snapshot.cells[0], '天', '切换墨色不应改变已落位字符');
  });

  it('切换墨色后再落位的新字符与已落位字符表现一致', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 0);
    state = setInkColor(state, '#4d4d4d');
    state = placeFromRack(state, state.rack[0].id, 1);

    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.placedCount, 2);
    assert.equal(snapshot.inkColor, '#4d4d4d', '已落位与后续落位共用同一全局墨色');
    assert.deepEqual(snapshot.cells.slice(0, 2), ['天', '地']);
  });

  it('滑块混合值可在 0-100 范围内逐档更新', () => {
    let state = createInitialState();
    for (const value of [100, 75, 50, 25, 0, 33]) {
      state = setInkMix(state, value);
      assert.equal(state.inkMix, value);
    }
    assert.equal(exportSnapshot(state).inkMix, 33);
  });

  it('非法墨色与混合值被拒绝', () => {
    const state = createInitialState();
    assert.throws(
      () => setInkColor(state, '#ffffff'),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'INVALID_INK_COLOR'
    );
    assert.throws(
      () => setInkMix(state, 101),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'INVALID_INK_MIX'
    );
    assert.throws(() => setInkMix(state, -1), CompositionError);
    assert.throws(() => setInkMix(state, 12.5), CompositionError);
    assert.equal(state.inkColor.value, '#1a1a1a', '拒绝非法设置后原设置保留');
    assert.equal(state.inkMix, 100);
  });
});

describe('字号全局设置', () => {
  it('切换字号后导出快照反映新字号，字符归属不变', () => {
    let state = createInitialState();
    state = placeFromRack(state, state.rack[0].id, 4);
    state = setFontSize(state, 52);

    assertConsistent(state);
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.fontSize, 52);
    assert.equal(snapshot.fontSizeName, '特大');
    assert.equal(snapshot.cells[4], '天');
  });

 it('非法字号被拒绝', () => {
    const state = createInitialState();
    assert.throws(
      () => setFontSize(state, 999),
      (error: unknown) =>
        error instanceof CompositionError && error.code === 'INVALID_FONT_SIZE'
    );
  });
});

describe('快速连续切换全局设置', () => {
  it('连续快速切换墨色/字号/混合值后以最后一次为准，无中间值残留', () => {
    let state = createInitialState();
    for (let round = 0; round < 50; round += 1) {
      const color = INK_COLORS[round % INK_COLORS.length];
      const size = FONT_SIZES[round % FONT_SIZES.length];
      state = setInkColor(state, color.value);
      state = setFontSize(state, size.value);
      state = setInkMix(state, round % 101);
    }

    assertConsistent(state);
    assert.equal(state.inkColor.value, INK_COLORS[49 % INK_COLORS.length].value);
    assert.equal(state.fontSize.value, FONT_SIZES[49 % FONT_SIZES.length].value);
    assert.equal(state.inkMix, 49);

    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.inkColor, state.inkColor.value);
    assert.equal(snapshot.fontSize, state.fontSize.value);
    assert.equal(snapshot.inkMix, state.inkMix);
  });

  it('连续切换设置之间穿插取字/取回，字符与设置互不污染', () => {
    let state = createInitialState();
    state = setInkColor(state, '#333333');
    const id = state.rack[0].id;
    state = placeFromRack(state, id, 0);
    state = setFontSize(state, 28);
    state = takeBack(state, id);
    state = setInkMix(state, 10);
    state = placeFromRack(state, id, 0);

    assertConsistent(state);
    const snapshot = exportSnapshot(state);
    assert.equal(snapshot.cells[0], '天');
    assert.equal(snapshot.inkColor, '#333333');
    assert.equal(snapshot.fontSize, 28);
    assert.equal(snapshot.inkMix, 10);
  });
});
