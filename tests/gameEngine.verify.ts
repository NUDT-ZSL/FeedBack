import assert from 'node:assert/strict';
import {
  createGameEngine,
  DEFAULT_HINT_COUNTDOWN_MS,
  DEFAULT_TOTAL_ROUNDS,
  ROUND_SCORE,
  type GameEngine,
  type GameStateSnapshot,
  type RoundRecord
} from '../src/gameEngine.ts';

interface ManualClock {
  now: () => number;
  advance: (ms: number) => void;
}

interface MemoryStorage {
  load: () => RoundRecord[];
  save: (records: RoundRecord[]) => void;
  dump: () => RoundRecord[];
}

function createManualClock(start = 1_000_000): ManualClock {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    }
  };
}

function createMemoryStorage(): MemoryStorage {
  let data: RoundRecord[] = [];
  return {
    load: () => data.map(r => ({ ...r })),
    save: (records: RoundRecord[]) => {
      data = records.map(r => ({ ...r }));
    },
    dump: () => data.map(r => ({ ...r }))
  };
}

function assertStorageInSync(engine: GameEngine, storage: MemoryStorage, label: string): void {
  assert.deepEqual(
    storage.dump(),
    engine.getState().history,
    `${label}: 落盘内容与内存历史不一致`
  );
}

function playRound(
  engine: GameEngine,
  clock: ManualClock,
  word: string,
  guess: string,
  options: { timeout?: boolean } = {}
): void {
  engine.dispatch({ type: 'selectWord', word });
  engine.dispatch({ type: 'confirmWord' });
  engine.dispatch({ type: 'hintTypingComplete' });
  if (options.timeout) {
    clock.advance(DEFAULT_HINT_COUNTDOWN_MS);
    engine.dispatch({ type: 'countdownExpired' });
  } else {
    clock.advance(1200);
    engine.dispatch({ type: 'submitGuess', guess });
  }
  clock.advance(1400);
  engine.dispatch({ type: 'resultAcknowledged' });
}

const tests: Array<[string, () => void]> = [];
function test(name: string, fn: () => void): void {
  tests.push([name, fn]);
}

test('正常对局：五轮完整对局从开始到结束，分数与历史一致', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });

  assert.equal(engine.getState().phase, 'idle');
  engine.dispatch({ type: 'startGame' });
  assert.equal(engine.getState().phase, 'wordPicking');
  assert.equal(engine.getState().currentRound, 1);
  assert.equal(engine.getState().currentPicker, 'A');

  // R1: A 出词，B 猜对 -> B +10
  playRound(engine, clock, '海豚', '海豚');
  // R2: B 出词，A 猜错 -> B +10
  playRound(engine, clock, '寿司', '火锅');
  // R3: A 出词，B 超时 -> A +10
  playRound(engine, clock, '宇航员', '', { timeout: true });
  // R4: B 出词，A 猜对 -> A +10
  playRound(engine, clock, '跳水', '跳水');
  // R5: A 出词，B 猜错 -> A +10
  playRound(engine, clock, '望远镜', '指南针');

  const s = engine.getState();
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.scoreA, 3 * ROUND_SCORE);
  assert.equal(s.scoreB, 2 * ROUND_SCORE);
  assert.equal(s.history.length, DEFAULT_TOTAL_ROUNDS);

  const expectedPickers = ['A', 'B', 'A', 'B', 'A'];
  const expectedCorrect = [true, false, false, true, false];
  let runA = 0;
  let runB = 0;
  s.history.forEach((r, i) => {
    assert.equal(r.round, i + 1, `第 ${i + 1} 条历史轮次号错误`);
    assert.equal(r.picker, expectedPickers[i]);
    assert.equal(r.correct, expectedCorrect[i]);
    const scorer = r.correct
      ? r.picker === 'A' ? 'B' : 'A'
      : r.picker;
    if (scorer === 'A') runA += ROUND_SCORE; else runB += ROUND_SCORE;
    assert.equal(r.scoreA, runA, `第 ${i + 1} 条历史 A 分数断裂`);
    assert.equal(r.scoreB, runB, `第 ${i + 1} 条历史 B 分数断裂`);
    assert.equal(typeof r.timestamp, 'number');
  });
  assert.equal(runA, s.scoreA);
  assert.equal(runB, s.scoreB);
  assertStorageInSync(engine, storage, '完整对局');
});

test('超时：倒计时耗尽判出词方得分，且只判定一次', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });
  engine.dispatch({ type: 'startGame' });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord' });
  engine.dispatch({ type: 'hintTypingComplete' });

  clock.advance(DEFAULT_HINT_COUNTDOWN_MS);
  engine.dispatch({ type: 'countdownExpired' });
  let s = engine.getState();
  assert.equal(s.phase, 'result');
  assert.equal(s.scoreA, ROUND_SCORE, '超时应判出词方 A 得分');
  assert.equal(s.scoreB, 0);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].correct, false);
  assert.equal(s.history[0].picker, 'A');

  // 判定后重复的超时/提交事件不得再次计分
  engine.dispatch({ type: 'countdownExpired' });
  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  s = engine.getState();
  assert.equal(s.scoreA, ROUND_SCORE);
  assert.equal(s.history.length, 1, '判定只能发生一次');
  assertStorageInSync(engine, storage, '超时');
});

test('重复提交：第二次提交与迟到的超时都被忽略', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });
  engine.dispatch({ type: 'startGame' });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord' });
  engine.dispatch({ type: 'hintTypingComplete' });

  clock.advance(800);
  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  let s = engine.getState();
  assert.equal(s.phase, 'result');
  assert.equal(s.scoreB, ROUND_SCORE, '猜词方 B 应得分');
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].correct, true);

  engine.dispatch({ type: 'submitGuess', guess: '鲸鱼' });
  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  engine.dispatch({ type: 'countdownExpired' });
  s = engine.getState();
  assert.equal(s.scoreB, ROUND_SCORE);
  assert.equal(s.scoreA, 0);
  assert.equal(s.history.length, 1, '重复提交不得产生新记录');
  assertStorageInSync(engine, storage, '重复提交');
});

test('提示揭示中途提交被拒绝，倒计时与揭示进度严格对齐', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });
  engine.dispatch({ type: 'startGame' });
  engine.dispatch({ type: 'selectWord', word: '海豚' });
  engine.dispatch({ type: 'confirmWord' });

  let s = engine.getState();
  assert.equal(s.phase, 'hintRevealing');
  assert.equal(s.currentHints.length, 4, '提示序列应生成 4 条');
  assert.equal(s.hintsRevealed, 0);
  assert.equal(s.countdownRemainingMs, null, '揭示未完成时不应有倒计时');

  // 揭示中途提交：不产生判定
  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  s = engine.getState();
  assert.equal(s.phase, 'hintRevealing');
  assert.equal(s.guessSubmitted, false);
  assert.equal(s.history.length, 0);
  assert.equal(s.scoreA, 0);
  assert.equal(s.scoreB, 0);

  // 空猜测同样被拒绝
  engine.dispatch({ type: 'hintTypingComplete' });
  engine.dispatch({ type: 'submitGuess', guess: '   ' });
  s = engine.getState();
  assert.equal(s.phase, 'guessing');
  assert.equal(s.guessSubmitted, false);
  assert.equal(s.history.length, 0);

  // 倒计时与揭示完成时刻对齐
  s = engine.getState();
  assert.equal(s.hintsRevealed, 1);
  assert.equal(s.countdownRemainingMs, DEFAULT_HINT_COUNTDOWN_MS);
  clock.advance(1500);
  assert.equal(engine.getState().countdownRemainingMs, 1500);
  clock.advance(1500);
  assert.equal(engine.getState().countdownRemainingMs, 0);
  clock.advance(500);
  assert.equal(engine.getState().countdownRemainingMs, 0, '剩余时间不为负');

  // 倒计时耗尽与提交同时到达：先到的判定生效，只判定一次
  engine.dispatch({ type: 'countdownExpired' });
  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  s = engine.getState();
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].correct, false, '超时先到达，应判错');
  assert.equal(s.scoreA, ROUND_SCORE);
  assertStorageInSync(engine, storage, '揭示中途提交');
});

test('非法输入：未选词确认、非法词、非出词阶段事件均被忽略', () => {
  const clock = createManualClock();
  const engine = createGameEngine({ now: clock.now });
  engine.dispatch({ type: 'startGame' });

  engine.dispatch({ type: 'confirmWord' });
  assert.equal(engine.getState().phase, 'wordPicking', '未选词不得进入揭示');

  engine.dispatch({ type: 'selectWord', word: '!!非法!!' });
  engine.dispatch({ type: 'confirmWord' });
  assert.equal(engine.getState().phase, 'wordPicking', '非法词不得进入揭示');

  engine.dispatch({ type: 'submitGuess', guess: '海豚' });
  engine.dispatch({ type: 'countdownExpired' });
  engine.dispatch({ type: 'hintTypingComplete' });
  engine.dispatch({ type: 'resultAcknowledged' });
  const s = engine.getState();
  assert.equal(s.phase, 'wordPicking');
  assert.equal(s.history.length, 0);
  assert.equal(s.scoreA + s.scoreB, 0);
});

test('连续多局：开局重置分数与历史，局间互不影响', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });

  for (let game = 0; game < 2; game++) {
    engine.dispatch({ type: 'startGame' });
    let s = engine.getState();
    assert.equal(s.currentRound, 1);
    assert.equal(s.scoreA, 0);
    assert.equal(s.scoreB, 0);
    assert.equal(s.history.length, 0, `第 ${game + 1} 局开局历史应清空`);
    assert.equal(storage.dump().length, 0, '开局重置需同步落盘');

    for (let round = 0; round < DEFAULT_TOTAL_ROUNDS; round++) {
      playRound(engine, clock, '海豚', '海豚');
    }
    s = engine.getState();
    assert.equal(s.phase, 'gameOver');
    assert.equal(s.history.length, DEFAULT_TOTAL_ROUNDS);
    assert.equal(s.scoreA + s.scoreB, DEFAULT_TOTAL_ROUNDS * ROUND_SCORE);
    assertStorageInSync(engine, storage, `第 ${game + 1} 局`);
  }
});

test('历史恢复与清空：落盘内容可恢复且与内存不分叉', () => {
  const clock = createManualClock();
  const storage = createMemoryStorage();
  const engine = createGameEngine({ now: clock.now, storage });
  engine.dispatch({ type: 'startGame' });
  playRound(engine, clock, '海豚', '海豚');
  playRound(engine, clock, '寿司', '寿司');

  // 模拟刷新：同一存储新建引擎，历史完整恢复
  const restored = createGameEngine({ now: clock.now, storage });
  assert.deepEqual(restored.getState().history, engine.getState().history);
  assert.equal(restored.getState().history.length, 2);

  // 清空后内存与落盘同时为空，且恢复后仍为空
  engine.dispatch({ type: 'clearHistory' });
  assert.equal(engine.getState().history.length, 0);
  assert.equal(storage.dump().length, 0);
  const afterClear = createGameEngine({ now: clock.now, storage });
  assert.equal(afterClear.getState().history.length, 0);

  // 清空后继续对局，新记录正常追加
  afterClear.dispatch({ type: 'startGame' });
  const clockState = engine.getState();
  assert.equal(clockState.history.length, 0);
  playRound(afterClear, clock, '海豚', '鲸鱼');
  assert.equal(afterClear.getState().history.length, 1);
  assert.deepEqual(storage.dump(), afterClear.getState().history);
});

test('可重复性：相同输入事件序列产生完全相同的结果', () => {
  function runScript(): GameStateSnapshot {
    const clock = createManualClock(42);
    const storage = createMemoryStorage();
    const engine = createGameEngine({ now: clock.now, storage });
    engine.dispatch({ type: 'startGame' });
    playRound(engine, clock, '海豚', '海豚');
    playRound(engine, clock, '寿司', '拉面');
    playRound(engine, clock, '宇航员', '', { timeout: true });
    return engine.getState();
  }
  const first = runScript();
  const second = runScript();
  assert.deepEqual(first, second, '同一事件序列必须得到同一结果');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} 项验证失败`);
  process.exit(1);
}
console.log(`\n全部 ${tests.length} 项验证通过`);
