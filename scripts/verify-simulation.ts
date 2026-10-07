/**
 * 离线批量验证入口：连续多局推演，核对士气 / 兵力 / 历史记录一致性。
 * 运行：npm run verify
 */
import {
  initializePiecesWithRandom,
  selectAiFormation,
  simulateStep,
  getSimulationResult,
  buildHistoryItem,
  pushHistory,
  createInitialMorale,
  createPiece,
  isSideBroken,
  moraleSpeedFactor,
  moraleCombatFactor,
  clampMorale,
  resultFromHistoryItem,
  HISTORY_LIMIT,
  MORALE_CASUALTY_COST,
} from '../src/GameSimulation';
import type {
  FormationType,
  HistoryItem,
  MoraleState,
  Piece,
  SimulationResult,
} from '../src/types';
import { MORALE_MAX, MORALE_MIN } from '../src/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FORMATION_TYPES: FormationType[] = ['yulin', 'fangyuan', 'heyi'];
const MAX_STEPS = 60 * 60 * 10;

interface GameSummary {
  game: number;
  playerFormation: FormationType;
  aiFormation: FormationType;
  winner: string;
  moraleStart: MoraleState;
  moraleEnd: MoraleState;
  playerRemaining: number;
  aiRemaining: number;
  steps: number;
}

let failures = 0;
function check(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function runGame(
  rng: () => number,
  playerFormation: FormationType,
  aiFormation: FormationType,
  moraleStart: MoraleState
): { result: SimulationResult; steps: number } {
  let pieces = initializePiecesWithRandom(rng);
  let morale: MoraleState = { ...moraleStart };
  let steps = 0;
  while (steps < MAX_STEPS) {
    const outcome = simulateStep(pieces, playerFormation, aiFormation, morale, 1 / 60);
    pieces = outcome.pieces;
    morale = outcome.morale;
    steps += 1;
    if (outcome.complete) break;
  }
  if (steps >= MAX_STEPS) {
    throw new Error(`推演未在 ${MAX_STEPS} 步内结束（${playerFormation} vs ${aiFormation}）`);
  }
  return { result: getSimulationResult(pieces, playerFormation, aiFormation, moraleStart, morale), steps };
}

function runBatch(seed: number, gameCount: number): {
  summaries: GameSummary[];
  history: HistoryItem[];
  finalMorale: MoraleState;
} {
  const rng = mulberry32(seed);
  let morale = createInitialMorale();
  let history: HistoryItem[] = [];
  const summaries: GameSummary[] = [];

  for (let game = 1; game <= gameCount; game += 1) {
    const playerFormation = FORMATION_TYPES[Math.floor(rng() * FORMATION_TYPES.length)];
    const aiFormation = selectAiFormation(rng);
    const moraleStart = { ...morale };
    const { result, steps } = runGame(rng, playerFormation, aiFormation, moraleStart);

    history = pushHistory(history, buildHistoryItem(result, `game-${game}`));
    morale = { player: result.playerMoraleEnd, ai: result.aiMoraleEnd };
    summaries.push({
      game,
      playerFormation,
      aiFormation,
      winner: result.winner,
      moraleStart,
      moraleEnd: { ...morale },
      playerRemaining: result.playerRemaining,
      aiRemaining: result.aiRemaining,
      steps,
    });
  }
  return { summaries, history, finalMorale: morale };
}

function countStanding(pieces: Piece[], side: 'player' | 'ai'): number {
  return pieces.filter((p) => p.side === side && p.status !== 'dead').length;
}

function verifyBatchConsistency(seed: number, gameCount: number): void {
  console.log(`\n[1] 连续 ${gameCount} 局推演一致性（seed=${seed}）`);
  const { summaries, history, finalMorale } = runBatch(seed, gameCount);

  console.log('  局次 | 阵型(我/敌) | 结果 | 士气(我) | 士气(敌) | 剩余兵力(我/敌)');
  summaries.forEach((s) => {
    const w = s.winner === 'player' ? '胜' : s.winner === 'ai' ? '负' : '平';
    console.log(
      `  ${String(s.game).padStart(3)}  | ${s.playerFormation}/${s.aiFormation} | ${w} | ` +
        `${s.moraleStart.player}→${s.moraleEnd.player} | ${s.moraleStart.ai}→${s.moraleEnd.ai} | ` +
        `${s.playerRemaining}/${s.aiRemaining}`
    );
  });

  summaries.forEach((s, i) => {
    check(
      s.moraleEnd.player >= MORALE_MIN && s.moraleEnd.player <= MORALE_MAX &&
        s.moraleEnd.ai >= MORALE_MIN && s.moraleEnd.ai <= MORALE_MAX,
      `第${s.game}局士气越界`
    );
    if (i > 0) {
      const prev = summaries[i - 1];
      check(
        s.moraleStart.player === prev.moraleEnd.player && s.moraleStart.ai === prev.moraleEnd.ai,
        `第${s.game}局士气起点未承接第${prev.game}局结果`
      );
    } else {
      check(
        s.moraleStart.player === MORALE_MAX && s.moraleStart.ai === MORALE_MAX,
        '首局士气应为初始值'
      );
    }
    const playerBroken = s.playerRemaining === 0 || s.moraleEnd.player === 0;
    const aiBroken = s.aiRemaining === 0 || s.moraleEnd.ai === 0;
    if (playerBroken && aiBroken) {
      check(s.winner === 'draw', `第${s.game}局双方同时崩溃应为平局，实际 ${s.winner}`);
    } else if (playerBroken) {
      check(s.winner === 'ai', `第${s.game}局我方崩溃应判负，实际 ${s.winner}`);
    } else if (aiBroken) {
      check(s.winner === 'player', `第${s.game}局敌方崩溃应判胜，实际 ${s.winner}`);
    }
  });

  check(history.length === Math.min(gameCount, HISTORY_LIMIT), `历史记录数量应为 ${Math.min(gameCount, HISTORY_LIMIT)}，实际 ${history.length}`);
  history.forEach((item, idx) => {
    const expectedGame = summaries[summaries.length - 1 - idx].game;
    check(item.id === `game-${expectedGame}`, `历史第${idx}条应对应第${expectedGame}局，实际 ${item.id}`);
  });

  const evictedBoundary = summaries.length - HISTORY_LIMIT;
  if (evictedBoundary > 0) {
    const across = summaries[evictedBoundary];
    const before = summaries[evictedBoundary - 1];
    check(
      across.moraleStart.player === before.moraleEnd.player && across.moraleStart.ai === before.moraleEnd.ai,
      '历史淘汰边界处士气承接断裂'
    );
  }

  const latest = history[0];
  check(
    latest.playerMoraleEnd === finalMorale.player && latest.aiMoraleEnd === finalMorale.ai,
    '最新历史记录的士气应与当前士气一致'
  );

  history.forEach((item) => {
    check(
      countStanding(item.snapshot, 'player') === item.playerRemaining &&
        countStanding(item.snapshot, 'ai') === item.aiRemaining,
      `${item.id} 快照兵力与记录不一致`
    );
    const summary = summaries.find((s) => `game-${s.game}` === item.id)!;
    check(
      item.playerMoraleStart === summary.moraleStart.player &&
        item.playerMoraleEnd === summary.moraleEnd.player &&
        item.aiMoraleStart === summary.moraleStart.ai &&
        item.aiMoraleEnd === summary.moraleEnd.ai,
      `${item.id} 士气区间与对局不符`
    );
  });
}

function verifyDeterminism(seed: number, gameCount: number): void {
  console.log(`\n[2] 可重复性：同一 seed 两次批量推演结果应完全一致`);
  const a = runBatch(seed, gameCount);
  const b = runBatch(seed, gameCount);
  check(
    JSON.stringify(a.summaries) === JSON.stringify(b.summaries),
    '相同 seed 两次推演的逐局摘要不一致'
  );
  console.log(`  两次运行各 ${gameCount} 局摘要比对完成`);
}

function verifyMoraleAffectsBattle(): void {
  console.log(`\n[3] 士气进入移动与交战链路`);
  check(moraleSpeedFactor(MORALE_MAX) > moraleSpeedFactor(50), '士气应提升移动速度系数');
  check(moraleSpeedFactor(50) > moraleSpeedFactor(MORALE_MIN), '速度系数应随士气单调变化');
  check(moraleCombatFactor(MORALE_MAX) > moraleCombatFactor(50), '士气应提升交战攻击系数');
  check(moraleCombatFactor(50) > moraleCombatFactor(MORALE_MIN), '攻击系数应随士气单调变化');

  const seed = 20260609;
  const high = runGame(mulberry32(seed), 'yulin', 'heyi', { player: 100, ai: 100 });
  const low = runGame(mulberry32(seed), 'yulin', 'heyi', { player: 100, ai: 30 });
  const same =
    high.result.winner === low.result.winner &&
    high.result.playerRemaining === low.result.playerRemaining &&
    high.result.aiRemaining === low.result.aiRemaining &&
    high.steps === low.steps;
  check(!same, '初始士气不同但战局完全一致，士气未实际参与推演');
  console.log(
    `  同 seed 对阵：满士气 ${high.result.winner}(${high.result.playerRemaining}/${high.result.aiRemaining},${high.steps}步) vs ` +
      `敌低士气 ${low.result.winner}(${low.result.playerRemaining}/${low.result.aiRemaining},${low.steps}步)`
  );
}

function verifyMoraleTracksCasualties(): void {
  console.log(`\n[4] 局内士气随战损同步推导`);
  const rng = mulberry32(7);
  let pieces = initializePiecesWithRandom(rng);
  let morale = createInitialMorale();
  let steps = 0;
  let violated = false;
  while (steps < MAX_STEPS) {
    const outcome = simulateStep(pieces, 'yulin', 'fangyuan', morale, 1 / 60);
    if (outcome.deaths.length === 0) {
      if (outcome.morale.player !== morale.player || outcome.morale.ai !== morale.ai) {
        violated = true;
      }
    } else {
      const loserDelta =
        outcome.morale.player < morale.player || outcome.morale.ai < morale.ai;
      if (!loserDelta) violated = true;
    }
    pieces = outcome.pieces;
    morale = outcome.morale;
    steps += 1;
    if (outcome.complete) break;
  }
  check(!violated, '存在无战损却士气变化、或有战损但败方士气未下降的步');
  console.log(`  单局 ${steps} 步逐步核对完成`);
}

function verifyZeroMoraleBoundary(): void {
  console.log(`\n[5] 边界：士气归零直接判负且停止结算`);
  const pieces: Piece[] = [
    createPiece('archer', 'player', 5, 5),
    createPiece('cavalry', 'ai', 5, 5),
    createPiece('archer', 'player', 9, 9),
    createPiece('cavalry', 'ai', 9, 9),
  ];
  const start: MoraleState = { player: MORALE_CASUALTY_COST.archer, ai: 100 };
  const outcome = simulateStep(pieces, 'heyi', 'heyi', start, 1 / 60);
  check(outcome.morale.player === 0, `我方士气应归零，实际 ${outcome.morale.player}`);
  check(outcome.deaths.length === 1, `归零后不应继续结算后续交战，实际死亡事件 ${outcome.deaths.length} 起`);
  check(outcome.complete, '士气归零应立即结束推演');
  check(
    countStanding(outcome.pieces, 'player') === 1,
    '归零后未结算的第二对棋子应存活'
  );
  const result = getSimulationResult(outcome.pieces, 'heyi', 'heyi', start, outcome.morale);
  check(result.winner === 'ai', `士气归零方应判负，实际 ${result.winner}`);
}

function verifyDrawBoundaries(): void {
  console.log(`\n[6] 边界：双方同时崩溃按平局处理`);
  // 同一步内：我方弓兵、骑兵相继阵亡（兵力清零），随后敌方弓兵阵亡使敌士气归零。
  // 事件顺序由棋子数组下标决定：P1死 → P2死 → A2死（敌士气 1+2+2-5=0）。
  const pieces: Piece[] = [
    createPiece('archer', 'player', 5, 5),
    createPiece('cavalry', 'player', 5, 5),
    createPiece('cavalry', 'ai', 5, 5),
    createPiece('archer', 'ai', 5, 5),
  ];
  const start: MoraleState = { player: 50, ai: 1 };
  const outcome = simulateStep(pieces, 'heyi', 'heyi', start, 1 / 60);
  check(outcome.complete, '同步崩溃应结束推演');
  check(
    countStanding(outcome.pieces, 'player') === 0 && outcome.morale.ai === 0,
    `应为我方兵力清零且敌方士气归零，实际 我兵${countStanding(outcome.pieces, 'player')} 敌士气${outcome.morale.ai}`
  );
  const result = getSimulationResult(outcome.pieces, 'heyi', 'heyi', start, outcome.morale);
  check(result.winner === 'draw', `双方同时崩溃应为平局，实际 ${result.winner}`);

  const allDead: Piece[] = [
    { ...createPiece('infantry', 'player', 3, 3), status: 'dead' },
    { ...createPiece('infantry', 'ai', 12, 12), status: 'dead' },
  ];
  const bothZero: MoraleState = { player: 0, ai: 0 };
  check(isSideBroken(allDead, bothZero, 'player') && isSideBroken(allDead, bothZero, 'ai'), '双方均应为崩溃状态');
  const drawResult = getSimulationResult(allDead, 'yulin', 'yulin', bothZero, bothZero);
  check(drawResult.winner === 'draw', `双方兵力同时清零应为平局，实际 ${drawResult.winner}`);
}

function verifyRestoreConsistency(): void {
  console.log(`\n[7] 历史恢复一致性`);
  const { history } = runBatch(313, 6);
  const target = history[2];
  const restored = resultFromHistoryItem(target);
  check(
    restored.playerRemaining === target.playerRemaining &&
      restored.aiRemaining === target.aiRemaining &&
      restored.playerMoraleEnd === target.playerMoraleEnd &&
      restored.aiMoraleEnd === target.aiMoraleEnd,
    '恢复的战报与历史记录不一致'
  );
  check(
    countStanding(restored.snapshot, 'player') === restored.playerRemaining &&
      countStanding(restored.snapshot, 'ai') === restored.aiRemaining,
    '恢复的棋盘快照与战报兵力不一致'
  );
  const restoredMorale: MoraleState = { player: target.playerMoraleEnd, ai: target.aiMoraleEnd };
  const next = runGame(mulberry32(555), 'fangyuan', 'yulin', restoredMorale);
  check(
    next.result.playerMoraleStart === restoredMorale.player && next.result.aiMoraleStart === restoredMorale.ai,
    '恢复后开新局士气起点未承接恢复值'
  );
  check(
    clampMorale(120) === MORALE_MAX && clampMorale(-5) === MORALE_MIN,
    '士气钳制边界异常'
  );
  console.log(`  恢复 ${target.id} 后续推一局，士气承接 ${restoredMorale.player}/${restoredMorale.ai} 校验通过`);
}

const GAME_COUNT = 25;
console.log('古代阵法推演 · 士气/战报联动离线验证');
verifyBatchConsistency(20261008, GAME_COUNT);
verifyDeterminism(20261008, GAME_COUNT);
verifyMoraleAffectsBattle();
verifyMoraleTracksCasualties();
verifyZeroMoraleBoundary();
verifyDrawBoundaries();
verifyRestoreConsistency();

if (failures > 0) {
  console.error(`\n验证失败：${failures} 项未通过`);
  process.exit(1);
}
console.log('\n全部验证通过 ✓');
