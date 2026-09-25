import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { FakeScheduler } from './helpers.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

async function setup() {
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.MouseEvent = dom.window.MouseEvent;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.__MEMORY_GAME_DISABLE_AUTOBOOT__ = true;
  const { MemoryGame } = await import('../src/game.ts');
  const scheduler = new FakeScheduler();
  const game = new MemoryGame(scheduler);
  return { dom, game, scheduler, document: dom.window.document };
}

function clickCard(document: Document, id: number): void {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  assert.ok(el, `card ${id} should exist`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function clickButton(document: Document, id: string): void {
  const el = document.getElementById(id);
  assert.ok(el, `button ${id} should exist`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function switchDifficulty(document: Document, value: string): void {
  const select = document.getElementById('difficultySelect') as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

function flippedCount(document: Document): number {
  return document.querySelectorAll('.card--flipped').length;
}

test('快速连点：错误提示期间第三张牌排队，反馈结束后才翻开', async () => {
  const { document, game, scheduler } = await setup();
  const core = game.getCore();
  const cards = core.getState().cards;
  const a = cards[0].id;
  const b = cards.find((c) => c.symbol !== cards[0].symbol)!.id;
  const c = cards.find((x) => x.id !== a && x.id !== b)!.id;

  clickCard(document, a);
  clickCard(document, b); // 不匹配，进入错误提示
  assert.equal(flippedCount(document), 2);

  clickCard(document, c); // 提示期间的点击：排队，不立即翻开
  assert.equal(flippedCount(document), 2);
  assert.equal(core.getState().queuedClicks, 1);
  assert.equal(core.getState().moves, 2);

  scheduler.advance(1000); // 错误提示结束
  assert.equal(flippedCount(document), 1);
  assert.equal(core.getState().flippedIds[0], c);
  assert.equal(
    document
      .querySelector(`[data-card-id="${c}"]`)!
      .classList.contains('card--flipped'),
    true
  );
  assert.equal(document.getElementById('movesDisplay')!.textContent, '3');
});

test('难度来回切换后计时、匹配数、操作数都回到初始快照', async () => {
  const { document, game, scheduler } = await setup();
  switchDifficulty(document, 'hard');
  assert.equal(document.querySelectorAll('.card').length, 30);
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '0 / 15');

  const someId = game.getCore().getState().cards[0].id;
  clickCard(document, someId); // 开始计时
  scheduler.advance(800);
  assert.notEqual(document.getElementById('timerDisplay')!.textContent, '0.0s');

  switchDifficulty(document, 'easy');
  assert.equal(document.getElementById('timerDisplay')!.textContent, '0.0s');
  assert.equal(document.getElementById('movesDisplay')!.textContent, '0');
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '0 / 4');
  assert.equal(document.querySelectorAll('.card').length, 8);

  switchDifficulty(document, 'hard');
  assert.equal(document.getElementById('timerDisplay')!.textContent, '0.0s');
  assert.equal(document.getElementById('movesDisplay')!.textContent, '0');
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '0 / 15');
  assert.equal(document.querySelectorAll('.card').length, 30);

  // 切换后不点击，计时不应自己走动
  scheduler.advance(1000);
  assert.equal(document.getElementById('timerDisplay')!.textContent, '0.0s');
});

function winCurrentGame(document: Document, game: unknown, scheduler: FakeScheduler): void {
  const core = (game as { getCore(): unknown }).getCore() as {
    getState(): {
      isGameOver: boolean;
      cards: Array<{ id: number; symbol: string; isMatched: boolean }>;
    };
  };
  for (let guard = 0; guard < 100 && !core.getState().isGameOver; guard++) {
    const unmatched = core.getState().cards.filter((c) => !c.isMatched);
    const bySymbol = new Map<string, number[]>();
    for (const card of unmatched) {
      const list = bySymbol.get(card.symbol) ?? [];
      list.push(card.id);
      bySymbol.set(card.symbol, list);
    }
    const pair = [...bySymbol.values()][0];
    clickCard(document, pair[0]);
    clickCard(document, pair[1]);
    scheduler.advance(1000);
  }
}

test('通关结算只弹一次，弹窗内立即重新开始不会重复结算', async () => {
  const { document, game, scheduler } = await setup();
  switchDifficulty(document, 'easy');
  winCurrentGame(document, game, scheduler);
  assert.equal(game.getCore().getState().isGameOver, true);

  scheduler.advance(600); // 弹窗延迟
  const modal = document.getElementById('gameOverModal')!;
  assert.equal(modal.classList.contains('hidden'), false);
  const finalMoves = document.getElementById('finalMoves')!.textContent;
  const finalTime = document.getElementById('finalTime')!.textContent;
  assert.equal(finalMoves, '8'); // 简单难度 4 对，每对 2 次操作
  assert.equal(finalTime, document.getElementById('timerDisplay')!.textContent);

  // 弹窗出现后立刻重新开始
  clickButton(document, 'playAgainBtn');
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(document.getElementById('movesDisplay')!.textContent, '0');
  assert.equal(document.getElementById('timerDisplay')!.textContent, '0.0s');
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '0 / 4');

  // 等待更久也不会再次弹出结算
  scheduler.advance(5000);
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(game.getCore().getState().moves, 0);
});

test('结算后点击棋盘不再改变最终统计', async () => {
  const { document, game, scheduler } = await setup();
  switchDifficulty(document, 'easy');
  winCurrentGame(document, game, scheduler);
  scheduler.advance(600);
  const finalMoves = document.getElementById('finalMoves')!.textContent;
  const finalTime = document.getElementById('finalTime')!.textContent;

  scheduler.advance(3000);
  const firstCard = game.getCore().getState().cards[0].id;
  clickCard(document, firstCard);
  assert.equal(document.getElementById('finalMoves')!.textContent, finalMoves);
  assert.equal(document.getElementById('finalTime')!.textContent, finalTime);
  assert.equal(game.getCore().getState().moves, 8);
});

test('撤销/重做按钮驱动棋盘与统计回到历史状态', async () => {
  const { document, game } = await setup();
  switchDifficulty(document, 'easy');
  const core = game.getCore();
  const cards = core.getState().cards;
  const symbol = cards[0].symbol;
  const pairIds = cards.filter((c) => c.symbol === symbol).map((c) => c.id);

  clickCard(document, pairIds[0]);
  clickCard(document, pairIds[1]); // 匹配
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '1 / 4');
  assert.equal(
    document.querySelectorAll('.card--matched').length,
    2
  );

  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
  assert.equal(undoBtn.disabled, false);

  clickButton(document, 'undoBtn'); // 撤销匹配：两张牌重新翻开但未匹配
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '0 / 4');
  assert.equal(document.querySelectorAll('.card--matched').length, 0);
  assert.equal(flippedCount(document), 2);
  assert.equal(document.getElementById('movesDisplay')!.textContent, '2');

  clickButton(document, 'undoBtn'); // 撤销第二次翻开
  assert.equal(flippedCount(document), 1);
  assert.equal(document.getElementById('movesDisplay')!.textContent, '1');

  clickButton(document, 'undoBtn'); // 撤销第一次翻开：回到未开始
  assert.equal(flippedCount(document), 0);
  assert.equal(document.getElementById('movesDisplay')!.textContent, '0');
  assert.equal(document.getElementById('timerDisplay')!.textContent, '0.0s');
  assert.equal(undoBtn.disabled, true);
  assert.equal(redoBtn.disabled, false);

  clickButton(document, 'redoBtn');
  clickButton(document, 'redoBtn');
  clickButton(document, 'redoBtn'); // 重做到匹配完成
  assert.equal(document.getElementById('matchesDisplay')!.textContent, '1 / 4');
  assert.equal(document.querySelectorAll('.card--matched').length, 2);
  assert.equal(core.getState().matchedPairs, 1);
});

test('错误提示期间撤销按钮禁用，反馈结束后恢复', async () => {
  const { document, game, scheduler } = await setup();
  const cards = game.getCore().getState().cards;
  const a = cards[0].id;
  const b = cards.find((c) => c.symbol !== cards[0].symbol)!.id;
  clickCard(document, a);
  clickCard(document, b);
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  assert.equal(undoBtn.disabled, true);
  scheduler.advance(1000);
  assert.equal(undoBtn.disabled, false);
});
