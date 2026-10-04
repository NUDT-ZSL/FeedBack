import assert from 'node:assert';
import {
  createGameEngine,
  HINT_COUNTDOWN_MS,
  TOTAL_ROUNDS,
  ROUND_SCORE,
  type GameEngine,
  type GameEvent,
  type GameState
} from '../src/gameEngine';
import { createMemoryHistoryStore, type MemoryHistoryStore } from '../src/historyStore';

let passed = 0;

function scenario(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

interface Clock {
  now: number;
}

interface RoundScript {
  word: string;
  submitAtHint?: number;
  guess?: string;
}

function playRound(engine: GameEngine, clock: Clock, script: RoundScript): void {
  engine.dispatch({ type: 'selectWord', word: script.word });
  clock.now += 10;
  engine.dispatch({ type: 'confirmWord', at: clock.now });
  const hintCount = engine.getState().currentHints.length;
  assert.ok(hintCount > 0, 'hints must be generated');
  for (let i = 0; i < hintCount; i++) {
    clock.now += 100;
    engine.dispatch({ type: 'hintRevealed', at: clock.now });
    assert.strictEqual(engine.getState().phase, 'guessing');
    if (i === script.submitAtHint) {
      clock.now += 500;
      engine.dispatch({ type: 'submitGuess', guess: script.guess ?? script.word, at: clock.now });
      assert.strictEqual(engine.getState().phase, 'result');
      clock.now += 100;
      engine.dispatch({ type: 'advance', at: clock.now });
      return;
    }
    clock.now += HINT_COUNTDOWN_MS;
    engine.dispatch({ type: 'tick', at: clock.now });
  }
  assert.strictEqual(engine.getState().phase, 'result');
  clock.now += 100;
  engine.dispatch({ type: 'advance', at: clock.now });
}

function playFullGame(engine: GameEngine, clock: Clock, scripts: RoundScript[]): void {
  engine.dispatch({ type: 'startGame', at: clock.now });
  for (const script of scripts) {
    playRound(engine, clock, script);
  }
}

const FULL_GAME_SCRIPTS: RoundScript[] = [
  { word: '海豚', submitAtHint: 0 },
  { word: '寿司', submitAtHint: 0, guess: '披萨' },
  { word: '火锅' },
  { word: '冲浪', submitAtHint: 1 },
  { word: '吉他', submitAtHint: 0, guess: '钢琴' }
];

scenario('正常对局：五轮结束后分数、轮次、历史记录全部正确', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 1000 };
  playFullGame(engine, clock, FULL_GAME_SCRIPTS);

  const state = engine.getState();
  assert.strictEqual(state.phase, 'gameOver');
  assert.strictEqual(state.currentRound, TOTAL_ROUNDS);
  assert.strictEqual(state.scoreA, 30);
  assert.strictEqual(state.scoreB, 20);
  assert.strictEqual(state.history.length, TOTAL_ROUNDS);
  assert.deepStrictEqual(state.history.map(r => r.round), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(state.history.map(r => r.picker), ['A', 'B', 'A', 'B', 'A']);
  assert.deepStrictEqual(state.history.map(r => r.correct), [true, false, false, true, false]);
  assert.deepStrictEqual(state.history.map(r => r.word), ['海豚', '寿司', '火锅', '冲浪', '吉他']);
  assert.deepStrictEqual(state.history.map(r => r.scoreA), [0, 0, 10, 20, 30]);
  assert.deepStrictEqual(state.history.map(r => r.scoreB), [10, 20, 20, 20, 20]);
});

scenario('超时：逐条提示耗尽后判定一次，出词方得分', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 0 };
  engine.dispatch({ type: 'startGame', at: clock.now });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord', at: clock.now });

  const hintCount = engine.getState().currentHints.length;
  for (let i = 0; i < hintCount; i++) {
    clock.now += 100;
    engine.dispatch({ type: 'hintRevealed', at: clock.now });
    assert.strictEqual(engine.getState().currentHintIndex, i);
    assert.strictEqual(engine.getRemainingMs(clock.now), HINT_COUNTDOWN_MS);
    assert.strictEqual(engine.getRemainingMs(clock.now + 1000), HINT_COUNTDOWN_MS - 1000);
    engine.dispatch({ type: 'tick', at: clock.now + HINT_COUNTDOWN_MS - 1 });
    assert.strictEqual(engine.getState().phase, 'guessing', 'early tick must not expire the window');
    clock.now += HINT_COUNTDOWN_MS;
    engine.dispatch({ type: 'tick', at: clock.now });
  }

  const state = engine.getState();
  assert.strictEqual(state.phase, 'result');
  assert.strictEqual(state.scoreA, ROUND_SCORE);
  assert.strictEqual(state.scoreB, 0);
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.history[0].correct, false);
  assert.strictEqual(state.history[0].picker, 'A');
  assert.strictEqual(state.history[0].word, '海豚');
});

scenario('重复提交：第二次提交与迟到的倒计时都不再产生判定', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 0 };
  engine.dispatch({ type: 'startGame', at: clock.now });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord', at: clock.now });
  clock.now += 100;
  engine.dispatch({ type: 'hintRevealed', at: clock.now });

  clock.now += 500;
  engine.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now });
  assert.strictEqual(engine.getState().phase, 'result');

  engine.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now + 1 });
  engine.dispatch({ type: 'submitGuess', guess: '鲸鱼', at: clock.now + 2 });
  engine.dispatch({ type: 'tick', at: clock.now + 99999 });

  const state = engine.getState();
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.scoreB, ROUND_SCORE);
  assert.strictEqual(state.scoreA, 0);
  assert.strictEqual(state.phase, 'result');
});

scenario('提示揭示中途提交：立即判定，未揭示的提示不再影响结果', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 0 };
  engine.dispatch({ type: 'startGame', at: clock.now });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord', at: clock.now });

  clock.now += 100;
  engine.dispatch({ type: 'hintRevealed', at: clock.now });
  clock.now += HINT_COUNTDOWN_MS;
  engine.dispatch({ type: 'tick', at: clock.now });
  assert.strictEqual(engine.getState().phase, 'hintRevealing');
  assert.strictEqual(engine.getState().currentHintIndex, 1);

  clock.now += 100;
  engine.dispatch({ type: 'hintRevealed', at: clock.now });
  clock.now += 500;
  engine.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now });

  const state = engine.getState();
  assert.strictEqual(state.phase, 'result');
  assert.strictEqual(state.currentHintIndex, 1);
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.history[0].correct, true);
  assert.strictEqual(state.scoreB, ROUND_SCORE);
});

scenario('打字揭示期间与空猜测的提交被忽略', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 0 };
  engine.dispatch({ type: 'startGame', at: clock.now });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord', at: clock.now });

  engine.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now + 50 });
  assert.strictEqual(engine.getState().phase, 'hintRevealing');
  assert.strictEqual(engine.getState().history.length, 0);

  clock.now += 100;
  engine.dispatch({ type: 'hintRevealed', at: clock.now });
  engine.dispatch({ type: 'submitGuess', guess: '   ', at: clock.now + 10 });
  assert.strictEqual(engine.getState().phase, 'guessing');
  assert.strictEqual(engine.getState().history.length, 0);
});

scenario('提交与超时竞速：先到者生效，判定只发生一次', () => {
  const timeoutFirst = createGameEngine();
  let clock: Clock = { now: 0 };
  timeoutFirst.dispatch({ type: 'startGame', at: clock.now });
  timeoutFirst.dispatch({ type: 'selectWord', word: '海豚' });
  timeoutFirst.dispatch({ type: 'confirmWord', at: clock.now });
  const hintCount = timeoutFirst.getState().currentHints.length;
  for (let i = 0; i < hintCount; i++) {
    clock.now += 100;
    timeoutFirst.dispatch({ type: 'hintRevealed', at: clock.now });
    clock.now += HINT_COUNTDOWN_MS;
    timeoutFirst.dispatch({ type: 'tick', at: clock.now });
  }
  timeoutFirst.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now + 1 });
  let state = timeoutFirst.getState();
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.history[0].correct, false);
  assert.strictEqual(state.scoreA, ROUND_SCORE);
  assert.strictEqual(state.scoreB, 0);

  const submitFirst = createGameEngine();
  clock = { now: 0 };
  submitFirst.dispatch({ type: 'startGame', at: clock.now });
  submitFirst.dispatch({ type: 'selectWord', word: '海豚' });
  submitFirst.dispatch({ type: 'confirmWord', at: clock.now });
  clock.now += 100;
  submitFirst.dispatch({ type: 'hintRevealed', at: clock.now });
  clock.now += HINT_COUNTDOWN_MS;
  submitFirst.dispatch({ type: 'submitGuess', guess: '海豚', at: clock.now });
  submitFirst.dispatch({ type: 'tick', at: clock.now });
  submitFirst.dispatch({ type: 'tick', at: clock.now + 99999 });
  state = submitFirst.getState();
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.history[0].correct, true);
  assert.strictEqual(state.scoreB, ROUND_SCORE);
  assert.strictEqual(state.scoreA, 0);
});

scenario('连续多局：开局重置分数与历史，轮次从 1 重新计数', () => {
  const engine = createGameEngine();
  const clock: Clock = { now: 0 };
  playFullGame(engine, clock, FULL_GAME_SCRIPTS);
  assert.strictEqual(engine.getState().phase, 'gameOver');

  engine.dispatch({ type: 'startGame', at: clock.now });
  let state = engine.getState();
  assert.strictEqual(state.phase, 'wordPicking');
  assert.strictEqual(state.currentRound, 1);
  assert.strictEqual(state.currentPicker, 'A');
  assert.strictEqual(state.scoreA, 0);
  assert.strictEqual(state.scoreB, 0);
  assert.strictEqual(state.history.length, 0);

  playRound(engine, clock, { word: '企鹅', submitAtHint: 0 });
  state = engine.getState();
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(state.history[0].round, 1);
  assert.strictEqual(state.scoreB, ROUND_SCORE);
});

scenario('历史落盘与内存一致，清空后可通过存储恢复', () => {
  const store: MemoryHistoryStore = createMemoryHistoryStore();
  const engine1 = createGameEngine({ store });
  const clock: Clock = { now: 0 };
  engine1.dispatch({ type: 'startGame', at: clock.now });
  playRound(engine1, clock, { word: '海豚', submitAtHint: 0 });
  playRound(engine1, clock, { word: '寿司', submitAtHint: 0, guess: '披萨' });

  assert.deepStrictEqual(store.getStored(), engine1.getState().history);

  const engine2 = createGameEngine({ store });
  assert.deepStrictEqual(engine2.getState().history, engine1.getState().history);

  engine2.dispatch({ type: 'clearHistory' });
  assert.deepStrictEqual(engine2.getState().history, []);
  assert.deepStrictEqual(store.getStored(), []);

  engine2.dispatch({ type: 'startGame', at: clock.now });
  playRound(engine2, clock, { word: '火锅', submitAtHint: 2 });
  assert.deepStrictEqual(store.getStored(), engine2.getState().history);

  const engine3 = createGameEngine({ store });
  assert.deepStrictEqual(engine3.getState().history, engine2.getState().history);
  assert.strictEqual(engine3.getState().history.length, 1);
  assert.strictEqual(engine3.getState().history[0].word, '火锅');
});

scenario('确定性：同一串输入事件在两个引擎实例上产生完全相同的状态', () => {
  const script: GameEvent[] = [];
  const clock: Clock = { now: 0 };
  const engineA = createGameEngine();
  const recorder: GameEngine = {
    dispatch(event: GameEvent): void {
      script.push(event);
      engineA.dispatch(event);
    },
    getState: () => engineA.getState(),
    getRemainingMs: () => engineA.getRemainingMs(clock.now),
    subscribe: () => {
      // no-op
    }
  };
  playFullGame(recorder, clock, FULL_GAME_SCRIPTS);
  recorder.dispatch({ type: 'startGame', at: clock.now });
  recorder.dispatch({ type: 'selectWord', word: '企鹅' });
  recorder.dispatch({ type: 'confirmWord', at: clock.now + 10 });
  recorder.dispatch({ type: 'clearHistory' });

  const engineB = createGameEngine();
  for (const event of script) {
    engineB.dispatch(event);
  }
  assert.strictEqual(JSON.stringify(engineA.getState()), JSON.stringify(engineB.getState()));
  assert.strictEqual(engineA.getState().phase, 'hintRevealing');
  assert.deepStrictEqual(engineA.getState().history, []);
});

console.log(`\n${passed} 个场景全部通过`);
