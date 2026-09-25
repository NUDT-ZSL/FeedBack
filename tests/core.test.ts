import test from 'node:test';
import assert from 'node:assert/strict';
import { replayLog } from '../src/core.ts';
import { makeCore, makeDeck } from './helpers.ts';

test('错误提示期间的新点击入队，判定结束后按顺序处理', () => {
  const { core, scheduler, recorder } = makeCore(4);
  core.clickCard(0);
  core.clickCard(2); // 不匹配，进入错误提示
  let state = core.getState();
  assert.equal(state.isProcessing, true);
  assert.equal(state.flippedIds.length, 2);

  core.clickCard(4);
  core.clickCard(5);
  state = core.getState();
  // 任意时刻至多两张未匹配牌翻开，新点击排队不生效
  assert.equal(state.flippedIds.length, 2);
  assert.equal(state.queuedClicks, 2);
  assert.equal(state.cards[4].isFlipped, false);
  assert.equal(state.moves, 2);

  scheduler.advance(1000);
  state = core.getState();
  // 前两张翻回后，排队的点击按顺序生效：4、5 依次翻开并匹配
  assert.equal(state.cards[0].isFlipped, false);
  assert.equal(state.cards[2].isFlipped, false);
  assert.equal(state.cards[4].isMatched, true);
  assert.equal(state.cards[5].isMatched, true);
  assert.equal(state.moves, 4);
  assert.equal(state.matchedPairs, 1);
  assert.equal(state.queuedClicks, 0);

  // 事件顺序：先翻回前两张，再处理排队的点击
  const unflipIdx = recorder.calls.findIndex(
    (c) => c.name === 'onCardFlip' && c.args[0] === 0 && c.args[1] === false
  );
  const flip4Idx = recorder.calls.findIndex(
    (c) => c.name === 'onCardFlip' && c.args[0] === 4 && c.args[1] === true
  );
  assert.ok(unflipIdx !== -1 && flip4Idx !== -1);
  assert.ok(unflipIdx < flip4Idx);
});

test('错误提示期间点击正在提示的牌，翻回后该点击仍会生效', () => {
  const { core, scheduler } = makeCore(4);
  core.clickCard(0);
  core.clickCard(2);
  core.clickCard(0); // 点击正在错误提示的牌 -> 入队
  assert.equal(core.getState().queuedClicks, 1);
  scheduler.advance(1000);
  const state = core.getState();
  assert.equal(state.cards[0].isFlipped, true);
  assert.equal(state.moves, 3);
});

test('错误提示期间重复点击同一张牌只产生一次有效翻开', () => {
  const { core, scheduler } = makeCore(4);
  core.clickCard(0);
  core.clickCard(2);
  core.clickCard(4);
  core.clickCard(4);
  scheduler.advance(1000);
  const state = core.getState();
  assert.equal(state.moves, 3);
  assert.equal(state.cards[4].isFlipped, true);
  assert.equal(state.flippedIds.length, 1);
});

test('反馈期间重置后，残留的翻回回调不再生效', () => {
  const { core, scheduler } = makeCore(4);
  core.clickCard(0);
  core.clickCard(2);
  scheduler.advance(500);
  core.reset(makeDeck(4), { pairs: 4, mismatchDelayMs: 1000 });
  scheduler.advance(2000);
  const state = core.getState();
  assert.equal(state.moves, 0);
  assert.equal(state.flippedIds.length, 0);
  assert.equal(state.logLength, 0);
  assert.equal(state.cards.every((c) => !c.isFlipped), true);
  assert.equal(state.isGameStarted, false);
  assert.equal(scheduler.pendingTimeoutCount, 0);
});

test('重置后计时归零且不再走动，第一次点击才重新计时', () => {
  const { core, scheduler, recorder } = makeCore(2);
  core.clickCard(0);
  scheduler.advance(700);
  core.reset(makeDeck(2), { pairs: 2, mismatchDelayMs: 1000 });
  const timerCalls = recorder.calls.filter((c) => c.name === 'onTimer');
  assert.equal(timerCalls[timerCalls.length - 1].args[0], 0);
  scheduler.advance(500);
  assert.equal(
    recorder.calls.filter((c) => c.name === 'onTimer').length,
    timerCalls.length
  );
  assert.equal(core.getState().elapsedMs, 0);
  core.clickCard(1);
  scheduler.advance(300);
  assert.equal(core.getState().elapsedMs, 300);
});

test('撤销/重做逐步回到历史状态，棋盘、统计与计时一致', () => {
  const { core, scheduler } = makeCore(2);
  core.clickCard(0); // t=0，计时开始
  scheduler.advance(200);
  core.clickCard(1); // t=200，匹配
  let s = core.getState();
  assert.equal(s.matchedPairs, 1);
  assert.equal(s.moves, 2);
  assert.equal(s.elapsedMs, 200);

  assert.ok(core.undo()); // 撤销 match
  s = core.getState();
  assert.equal(s.matchedPairs, 0);
  assert.equal(s.moves, 2);
  assert.deepEqual([...s.flippedIds].sort(), [0, 1]);
  assert.equal(s.cards[0].isMatched, false);
  assert.equal(s.elapsedMs, 200);

  assert.ok(core.undo()); // 撤销 flip(1)
  s = core.getState();
  assert.equal(s.moves, 1);
  assert.deepEqual(s.flippedIds, [0]);

  assert.ok(core.undo()); // 撤销 flip(0)，回到未开始
  s = core.getState();
  assert.equal(s.moves, 0);
  assert.equal(s.isGameStarted, false);
  assert.equal(s.elapsedMs, 0);
  scheduler.advance(500);
  assert.equal(core.getState().elapsedMs, 0); // 计时已停

  assert.ok(core.redo()); // 重做 flip(0)
  scheduler.advance(300);
  assert.ok(core.redo()); // 重做 flip(1)，恢复当时的 200ms 读数
  s = core.getState();
  assert.equal(s.elapsedMs, 200);
  assert.ok(core.redo()); // 重做 match
  s = core.getState();
  assert.equal(s.matchedPairs, 1);
  assert.equal(s.moves, 2);
  assert.equal(s.elapsedMs, 200);
  assert.equal(core.getState().canRedo, false);
});

test('回退后新动作接在回退点之后，不覆盖原始记录，回放与实时一致', () => {
  const { core, scheduler } = makeCore(2);
  core.clickCard(0);
  core.clickCard(1); // 匹配，log: [flip0, flip1, match]
  assert.equal(core.getState().logLength, 3);
  core.undo();
  core.undo(); // log 追加两条 undo；当前 card0 翻开，moves=1
  const logBefore = core.getLog().slice();
  assert.equal(logBefore.length, 5);

  core.clickCard(3); // 新动作：与 card0 不匹配
  scheduler.advance(1000); // 翻回
  const log = core.getLog();
  assert.equal(log.length, 7); // 追加 flip3 与 unflip，而非覆盖
  for (let i = 0; i < logBefore.length; i++) {
    assert.deepEqual(log[i], logBefore[i]);
  }
  assert.equal(core.getState().canRedo, false);

  // 从记录回放得到的终态与实时状态一致
  const replay = replayLog(core.getInitialLayout(), log);
  const s = core.getState();
  assert.equal(replay.stats.moves, s.moves);
  assert.equal(replay.stats.matchedPairs, s.matchedPairs);
  assert.equal(replay.stats.elapsedMs, s.elapsedMs);
  assert.deepEqual(replay.flippedIds, s.flippedIds);
  assert.deepEqual(
    replay.cards.map((c) => [c.isFlipped, c.isMatched]),
    s.cards.map((c) => [c.isFlipped, c.isMatched])
  );
});

test('回放可复现任意历史位置的状态', () => {
  const { core, scheduler } = makeCore(2);
  core.clickCard(0);
  const afterFirst = core.getState();
  core.clickCard(2); // 不匹配
  scheduler.advance(1000); // 翻回
  const afterUnflip = core.getState();
  const afterUnflipCards = afterUnflip.cards.map((c) => [
    c.isFlipped,
    c.isMatched,
  ]);
  core.clickCard(1);

  const log = core.getLog();
  const layout = core.getInitialLayout();
  const r1 = replayLog(layout, log, 1);
  assert.equal(r1.stats.moves, afterFirst.moves);
  assert.deepEqual(r1.flippedIds, afterFirst.flippedIds);
  const r3 = replayLog(layout, log, 3);
  assert.equal(r3.stats.moves, afterUnflip.moves);
  assert.deepEqual(r3.flippedIds, afterUnflip.flippedIds);
  assert.deepEqual(
    r3.cards.map((c) => [c.isFlipped, c.isMatched]),
    afterUnflipCards
  );
});

test('通关结算只触发一次，结算后操作不再改变最终用时与操作数', () => {
  const { core, scheduler, recorder } = makeCore(1);
  scheduler.advance(100); // 未开始时流逝的时间不计入
  core.clickCard(0);
  scheduler.advance(400);
  core.clickCard(1); // 匹配唯一一对 -> 通关
  const s = core.getState();
  assert.equal(s.isGameOver, true);
  assert.equal(s.moves, 2);
  assert.equal(s.elapsedMs, 400);
  const gameOverCalls = recorder.calls.filter((c) => c.name === 'onGameOver');
  assert.equal(gameOverCalls.length, 1);
  assert.deepEqual(gameOverCalls[0].args, [400, 2]);

  // 结算后继续点击不再改变最终统计
  scheduler.advance(2000);
  core.clickCard(0);
  core.clickCard(1);
  core.clickCard(99);
  const s2 = core.getState();
  assert.equal(s2.moves, 2);
  assert.equal(s2.elapsedMs, 400);
  assert.equal(recorder.calls.filter((c) => c.name === 'onGameOver').length, 1);

  // 撤销最后一步匹配可回到未通关状态继续，重做则以相同结果再次结算
  assert.ok(core.undo());
  assert.equal(core.getState().isGameOver, false);
  assert.equal(
    recorder.calls.filter((c) => c.name === 'onGameContinued').length,
    1
  );
  assert.ok(core.redo());
  assert.equal(core.getState().isGameOver, true);
  assert.equal(core.getState().elapsedMs, 400);
  assert.equal(core.getState().moves, 2);
});

test('撤销留下的两张翻开牌会在下次点击前被显式翻回并记录', () => {
  const { core } = makeCore(2);
  core.clickCard(0);
  core.clickCard(1); // 匹配
  core.undo(); // 0、1 重新翻开（未匹配瞬态）
  assert.equal(core.getState().flippedIds.length, 2);
  core.clickCard(2); // 先翻回 0、1，再翻开 2
  const s = core.getState();
  assert.deepEqual(s.flippedIds, [2]);
  assert.equal(s.cards[0].isFlipped, false);
  assert.equal(s.cards[1].isFlipped, false);
  const kinds = core
    .getLog()
    .map((e) => (e.type === 'action' ? e.action.kind : e.type));
  assert.deepEqual(kinds, ['flip', 'flip', 'match', 'undo', 'unflip', 'flip']);
});

test('判定反馈期间不可撤销，结束后恢复', () => {
  const { core, scheduler } = makeCore(2);
  core.clickCard(0);
  core.clickCard(2); // 不匹配，反馈期
  assert.equal(core.getState().canUndo, false);
  assert.equal(core.undo(), false);
  scheduler.advance(1000);
  assert.equal(core.getState().canUndo, true);
  assert.ok(core.undo());
});
