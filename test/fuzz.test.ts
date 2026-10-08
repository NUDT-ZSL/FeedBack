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
  setFontSize,
  setInkColor,
  setInkMix,
  takeBack,
  type CompositionState
} from '../src/state/composition.ts';
import { FONT_SIZES, INK_COLORS } from '../src/data/characters.ts';
import {
  assertConsistent,
  mulberry32,
  pickInt,
  placedCountOf
} from './helpers/invariants.ts';

const ACCEPTED_ERRORS = new Set([
  'CELL_OCCUPIED',
  'CELL_OUT_OF_RANGE',
  'BOARD_FULL',
  'CHAR_NOT_IN_RACK',
  'CHAR_NOT_ON_BOARD',
  'INVALID_INK_COLOR',
  'INVALID_FONT_SIZE',
  'INVALID_INK_MIX'
]);

function runRandomSequence(seed: number, operationCount: number): CompositionState {
  const random = mulberry32(seed);
  let state = createInitialState();

  const apply = (operation: () => CompositionState): void => {
    try {
      const next = operation();
      assertConsistent(next);
      state = next;
    } catch (error) {
      if (error instanceof CompositionError) {
        assert.ok(
          ACCEPTED_ERRORS.has(error.code),
          `意外的错误码: ${error.code}`
        );
        assertConsistent(state);
      } else {
        throw error;
      }
    }
  };

  for (let step = 0; step < operationCount; step += 1) {
    const roll = random();
    const placedCount = placedCountOf(state);

    if (roll < 0.4) {
      if (state.rack.length > 0) {
        const charId = state.rack[pickInt(random, 0, state.rack.length - 1)].id;
        const position = pickInt(random, 0, BOARD_CAPACITY);
        apply(() => placeFromRack(state, charId, position));
      }
    } else if (roll < 0.65) {
      if (placedCount > 0) {
        const occupied = state.board
          .map((cell, index) => (cell === null ? -1 : index))
          .filter((index) => index !== -1);
        const position = occupied[pickInt(random, 0, occupied.length - 1)];
        apply(() => takeBack(state, state.board[position]!.id));
      }
    } else if (roll < 0.82) {
      if (placedCount > 0) {
        const from = pickInt(random, 0, BOARD_CAPACITY - 1);
        const to = pickInt(random, 0, BOARD_CAPACITY - 1);
        apply(() => movePlaced(state, from, to));
      }
    } else if (roll < 0.88) {
      apply(() => clearBoard(state));
    } else if (roll < 0.93) {
      const color = INK_COLORS[pickInt(random, -1, INK_COLORS.length - 1)];
      apply(() => setInkColor(state, color === undefined ? '#abcdef' : color.value));
    } else if (roll < 0.97) {
      const size = FONT_SIZES[pickInt(random, -1, FONT_SIZES.length - 1)];
      apply(() => setFontSize(state, size === undefined ? 12 : size.value));
    } else {
      apply(() => setInkMix(state, pickInt(random, -5, 105)));
    }

    if (step % 17 === 0) {
      const first = exportSnapshot(state);
      const second = exportSnapshot(state);
      assert.deepEqual(first, second, '相同状态连续导出必须得到相同快照');
    }
  }

  return state;
}

describe('随机批量序列：快速/连续操作下的状态一致性', () => {
  const seeds = [20260208, 42, 9527, 316265, 7777];

  for (const seed of seeds) {
    it(`种子 ${seed}：500 步混合操作后全程通过不变量校验`, () => {
      const state = runRandomSequence(seed, 500);
      assertConsistent(state);
    });
  }

  it('固定种子结果可复现（同一种子两次运行终态一致）', () => {
    const first = runRandomSequence(20260208, 200);
    const second = runRandomSequence(20260208, 200);
    assert.deepEqual(first, second);
  });

  it('高强度序列后清空可恢复到空版盘且字模一个不少', () => {
    let state = runRandomSequence(9527, 800);
    state = clearBoard(state);
    assertConsistent(state);
    assert.equal(placedCountOf(state), 0);
    assert.equal(state.rack.length, 100);
    assert.equal(exportSnapshot(state).placedCount, 0);
  });
});
