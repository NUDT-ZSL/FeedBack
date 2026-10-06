import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameStore } from '../src/store/gameStore';
import { assignGuestSeats } from '../src/utils/guestLogic';
import { TOTAL_PITCHES } from '../src/utils/gameLogic';

function resetToSeed(seed: number) {
  useGameStore.getState().resetGame(seed);
}

test('settlePitch 结算积分、连中并给出全体宾客反应', () => {
  resetToSeed(42);
  const store = useGameStore.getState();
  store.settlePitch({ result: 'hit', score: 10, label: '投中' });

  const state = useGameStore.getState();
  assert.equal(state.totalScore, 10);
  assert.equal(state.pitchesRemaining, TOTAL_PITCHES - 1);
  assert.equal(state.consecutiveSuccesses, 1);
  assert.equal(state.guestReactions.length, state.guests.length);
  state.guests.forEach((guest, index) => {
    const reaction = state.guestReactions[index];
    if (guest.favored === 'hit') {
      assert.equal(reaction.type, 'cheer');
    } else {
      assert.notEqual(reaction.type, 'cheer');
    }
  });
});

test('落空会中断连中计数', () => {
  resetToSeed(42);
  const store = useGameStore.getState();
  store.settlePitch({ result: 'hit', score: 10, label: '投中' });
  store.settlePitch({ result: 'hit', score: 10, label: '投中' });
  assert.equal(useGameStore.getState().consecutiveSuccesses, 2);
  store.settlePitch({ result: 'miss', score: 0, label: '落空' });
  assert.equal(useGameStore.getState().consecutiveSuccesses, 0);
});

test('clearReactions 将全体宾客反应归位', () => {
  resetToSeed(42);
  const store = useGameStore.getState();
  store.settlePitch({ result: 'hit', score: 10, label: '投中' });
  store.clearReactions();
  useGameStore.getState().guestReactions.forEach((reaction) => {
    assert.equal(reaction.type, 'idle');
    assert.equal(reaction.intensity, 0);
  });
});

test('resetGame 重新分配席次且清空上一局反应', () => {
  resetToSeed(42);
  const store = useGameStore.getState();
  store.settlePitch({ result: 'hit', score: 10, label: '投中' });

  store.resetGame(777);
  const state = useGameStore.getState();
  assert.equal(state.gameSeed, 777);
  assert.equal(state.totalScore, 0);
  assert.equal(state.pitchesRemaining, TOTAL_PITCHES);
  assert.equal(state.pitchHistory.length, 0);
  assert.equal(state.consecutiveSuccesses, 0);
  assert.deepEqual(state.guests, assignGuestSeats(777));
  state.guestReactions.forEach((reaction) => {
    assert.equal(reaction.type, 'idle');
  });
});

test('同一局种子重开后席次与偏好完全一致', () => {
  resetToSeed(20261007);
  const first = useGameStore.getState().guests;
  useGameStore.getState().settlePitch({ result: 'ear', score: 5, label: '卡耳' });
  useGameStore.getState().resetGame(20261007);
  const second = useGameStore.getState().guests;
  assert.deepEqual(first, second);
});

test('打完规定次数后对局结束', () => {
  resetToSeed(9);
  const store = useGameStore.getState();
  for (let i = 0; i < TOTAL_PITCHES; i += 1) {
    store.settlePitch({ result: 'hit', score: 10, label: '投中' });
  }
  const state = useGameStore.getState();
  assert.equal(state.gameOver, true);
  assert.equal(state.totalScore, 80);
});
