import {
  createBattle,
  stepBattle,
  getBattleResult,
  resolveBattleEnd,
  moraleSpeedFactor,
  moraleCombatFactor,
  clampMorale,
  MORALE_INITIAL,
  MORALE_LOSS_PER_DEATH,
  MORALE_GAIN_PER_KILL,
} from '../src/GameSimulation';
import type { BattleState } from '../src/GameSimulation';
import {
  buildHistoryItem,
  appendHistory,
  restoreHistoryState,
  HISTORY_LIMIT,
} from '../src/campaign';
import type { Piece, PieceType, Side, FormationType, HistoryItem } from '../src/types';
import { CELL_SIZE, PIECE_STATS } from '../src/types';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makePiece(
  type: PieceType,
  side: Side,
  gridX: number,
  gridY: number,
  id: string
): Piece {
  const stats = PIECE_STATS[type];
  return {
    id,
    type,
    side,
    x: gridX * CELL_SIZE + CELL_SIZE / 2,
    y: gridY * CELL_SIZE + CELL_SIZE / 2,
    status: 'alive',
    attack: stats.attack,
    defense: stats.defense,
  };
}

function makePieceAt(type: PieceType, side: Side, x: number, y: number, id: string): Piece {
  const stats = PIECE_STATS[type];
  return {
    id,
    type,
    side,
    x,
    y,
    status: 'alive',
    attack: stats.attack,
    defense: stats.defense,
  };
}

function makeArmy(): Piece[] {
  const layout: PieceType[] = [
    'cavalry', 'cavalry', 'cavalry',
    'archer', 'archer', 'archer', 'archer',
    'infantry', 'infantry', 'infantry', 'infantry',
    'infantry', 'infantry', 'infantry', 'infantry',
  ];
  const pieces: Piece[] = [];
  let index = 0;
  for (let col = 2; col <= 6; col++) {
    for (let row = 3; row <= 5; row++) {
      if (index >= layout.length) break;
      const type = layout[index];
      pieces.push(makePiece(type, 'player', col, row, `p-${index + 1}`));
      pieces.push(makePiece(type, 'ai', 15 - col, row, `a-${index + 1}`));
      index += 1;
    }
  }
  return pieces;
}

const FORMATIONS_CYCLE: FormationType[] = ['yulin', 'fangyuan', 'heyi'];

function runBattle(
  pieces: Piece[],
  playerFormation: FormationType,
  aiFormation: FormationType,
  playerMorale: number,
  aiMorale: number,
  maxSteps: number = 30000
): { state: BattleState; steps: number } {
  let state = createBattle(pieces, playerFormation, aiFormation, playerMorale, aiMorale);
  let steps = 0;
  while (!state.finished && steps < maxSteps) {
    state = stepBattle(state, 1 / 60).state;
    steps += 1;
  }
  return { state, steps };
}

console.log('--- 士气机制 ---');
check('士气影响移速', moraleSpeedFactor(MORALE_INITIAL) > moraleSpeedFactor(0));
check('士气影响交战', moraleCombatFactor(MORALE_INITIAL) > moraleCombatFactor(0));
check('士气钳制在区间内', clampMorale(-20) === 0 && clampMorale(260) === 100);

{
  const movePieces = () => [
    makePieceAt('archer', 'player', 100, 100, 'mover-p'),
    makePieceAt('archer', 'ai', 940, 700, 'mover-a'),
  ];
  let highMove = createBattle(movePieces(), 'yulin', 'yulin', 100, 100);
  let lowMove = createBattle(movePieces(), 'yulin', 'yulin', 10, 100);
  for (let i = 0; i < 60; i++) {
    highMove = stepBattle(highMove, 1 / 60).state;
    lowMove = stepBattle(lowMove, 1 / 60).state;
  }
  const highX = highMove.pieces.find((p) => p.id === 'mover-p')!.x;
  const lowX = lowMove.pieces.find((p) => p.id === 'mover-p')!.x;
  check('高士气方移动更快', highX > lowX, `high=${highX.toFixed(1)} low=${lowX.toFixed(1)}`);

  const duelPieces = () => [
    makePieceAt('cavalry', 'player', 100, 100, 'duel-p'),
    makePieceAt('infantry', 'ai', 128, 100, 'duel-a'),
  ];
  const evenDuel = stepBattle(createBattle(duelPieces(), 'yulin', 'yulin', 100, 100), 1 / 60).state;
  check(
    '同士气交战按原规则判定',
    evenDuel.pieces.find((p) => p.id === 'duel-p')!.status === 'dead' &&
      evenDuel.pieces.find((p) => p.id === 'duel-a')!.status === 'alive'
  );
  const moraleDuel = stepBattle(createBattle(duelPieces(), 'yulin', 'yulin', 100, 20), 1 / 60).state;
  check(
    '士气差距改变交战结果',
    moraleDuel.pieces.find((p) => p.id === 'duel-p')!.status === 'alive' &&
      moraleDuel.pieces.find((p) => p.id === 'duel-a')!.status === 'dead'
  );
}

console.log('\n--- 推演可重复 ---');
{
  const runOnce = () =>
    JSON.stringify(getBattleResult(runBattle(makeArmy(), 'fangyuan', 'heyi', 88, 73).state).snapshot);
  check('相同输入批量复现结果一致', runOnce() === runOnce());
}

console.log('\n--- 边界判定（resolveBattleEnd） ---');
{
  const alive = makeArmy();
  const allDead = makeArmy().map((p) => ({ ...p, status: 'dead' as const }));
  check('双方士气归零 -> 平局', resolveBattleEnd(alive, 0, 0)?.winner === 'draw');
  check('双方兵力清零 -> 平局', resolveBattleEnd(allDead, 80, 80)?.winner === 'draw');
  const playerRouted = resolveBattleEnd(alive, 0, 60);
  check('我方士气归零 -> 敌方胜且原因为溃败', playerRouted?.winner === 'ai' && playerRouted.reason === 'rout');
  const aiRouted = resolveBattleEnd(alive, 60, 0);
  check('敌方士气归零 -> 我方胜且原因为溃败', aiRouted?.winner === 'player' && aiRouted.reason === 'rout');
  const playerDead = makeArmy().map((p) => (p.side === 'player' ? { ...p, status: 'dead' as const } : p));
  const annihilation = resolveBattleEnd(playerDead, 60, 60);
  check('一方兵力清零 -> 对方胜且原因为歼灭', annihilation?.winner === 'ai' && annihilation.reason === 'annihilation');
}

console.log('\n--- 士气归零即判负、不再继续结算 ---');
{
  const pieces = [
    makePieceAt('archer', 'player', 100, 100, 'weak-player'),
    makePieceAt('cavalry', 'ai', 128, 100, 'strong-ai'),
  ];
  let state = createBattle(pieces, 'yulin', 'fangyuan', 5, 100);
  state = stepBattle(state, 1 / 60).state;
  check('首个结算帧即溃败判负', state.finished && state.winner === 'ai' && state.endReason === 'rout');
  check('溃败方士气为零', state.playerMorale === 0);
  const snapshotAfterEnd = JSON.stringify(state);
  const again = stepBattle(state, 1 / 60);
  check('已结束对局不再产生事件', again.events.length === 0);
  check('已结束对局状态不再变化', JSON.stringify(again.state) === snapshotAfterEnd);
}

console.log('\n--- 开局士气为零立即判负（承接上局的连锁场景） ---');
{
  const state = runBattle(makeArmy(), 'yulin', 'fangyuan', 0, 80).state;
  check('起点士气为零立即溃败', state.finished && state.winner === 'ai' && state.endReason === 'rout');
  check('溃败局无额外战损', state.pieces.every((p) => p.status === 'alive'));
}

console.log('\n--- 连续多局：士气承接、战损同步、历史淘汰 ---');
{
  const ROUNDS = HISTORY_LIMIT + 5;
  let history: HistoryItem[] = [];
  let chain = { player: MORALE_INITIAL, ai: MORALE_INITIAL };
  const ledger: { start: { player: number; ai: number }; item: HistoryItem }[] = [];
  let firstItem: HistoryItem | null = null;

  for (let round = 1; round <= ROUNDS; round++) {
    const playerFormation = FORMATIONS_CYCLE[round % 3];
    const aiFormation = FORMATIONS_CYCLE[(round + 1) % 3];
    const pieces = makeArmy();

    const battle = createBattle(pieces, playerFormation, aiFormation, chain.player, chain.ai);
    check(`第${round}局起点承接上局结束士气`, battle.playerMoraleStart === chain.player && battle.aiMoraleStart === chain.ai);

    const { state, steps } = runBattle(pieces, playerFormation, aiFormation, chain.player, chain.ai);
    check(`第${round}局推演正常结束`, state.finished && steps < 30000);

    const result = getBattleResult(state);
    const expectedPlayerMorale = clampMorale(
      chain.player -
        MORALE_LOSS_PER_DEATH * (15 - result.playerRemaining) +
        MORALE_GAIN_PER_KILL * (15 - result.aiRemaining)
    );
    const expectedAiMorale = clampMorale(
      chain.ai -
        MORALE_LOSS_PER_DEATH * (15 - result.aiRemaining) +
        MORALE_GAIN_PER_KILL * (15 - result.playerRemaining)
    );
    check(
      `第${round}局我方士气随战损推导`,
      result.playerMoraleEnd === expectedPlayerMorale,
      `got ${result.playerMoraleEnd}, want ${expectedPlayerMorale}`
    );
    check(
      `第${round}局敌方士气随战损推导`,
      result.aiMoraleEnd === expectedAiMorale,
      `got ${result.aiMoraleEnd}, want ${expectedAiMorale}`
    );

    const item = buildHistoryItem(result, `round-${round}`);
    history = appendHistory(history, item);
    check(`第${round}局历史条目字段一致`, history[0].playerMoraleEnd === result.playerMoraleEnd && history[0].aiRemaining === result.aiRemaining);
    check(`第${round}局历史数量不超过上限`, history.length <= HISTORY_LIMIT);

    if (round === 1) {
      firstItem = item;
    }

    ledger.push({ start: { ...chain }, item });
    chain = { player: result.playerMoraleEnd, ai: result.aiMoraleEnd };
  }

  check('旧记录被淘汰后仍保留上限条', history.length === HISTORY_LIMIT);
  check('淘汰后最新记录仍在最前', history[0].id === `round-${ROUNDS}`);
  check('淘汰后最旧记录为第6局', history[history.length - 1].id === 'round-6');

  const chainIntact = ledger.every((entry, index) => {
    if (index === 0) {
      return entry.start.player === MORALE_INITIAL && entry.start.ai === MORALE_INITIAL;
    }
    const prev = ledger[index - 1].item;
    return (
      entry.start.player === prev.playerMoraleEnd &&
      entry.start.ai === prev.aiMoraleEnd
    );
  });
  check('历史淘汰不影响士气承接链', chainIntact);

  console.log('\n--- 恢复历史快照：棋盘/士气/阵型/结果一致 ---');
  const restored = restoreHistoryState(firstItem!);
  check('恢复后棋子快照一致', JSON.stringify(restored.pieces) === JSON.stringify(firstItem!.snapshot));
  check('恢复后死亡棋子不复活', restored.pieces.every((p, i) => p.status === firstItem!.snapshot[i].status));
  check('恢复后我方士气为该局结束值', restored.playerMorale === firstItem!.playerMoraleEnd);
  check('恢复后敌方士气为该局结束值', restored.aiMorale === firstItem!.aiMoraleEnd);
  check('恢复后阵型一致', restored.playerFormation === firstItem!.playerFormation && restored.aiFormation === firstItem!.aiFormation);
  check('恢复后结果胜负一致', restored.result.winner === (firstItem!.result === 'win' ? 'player' : firstItem!.result === 'lose' ? 'ai' : 'draw'));
  check('恢复后最终兵力一致', restored.result.playerRemaining === firstItem!.playerRemaining && restored.result.aiRemaining === firstItem!.aiRemaining);
  check('已淘汰记录仍可恢复一致状态', !history.some((h) => h.id === firstItem!.id));
}

console.log(`\n===== ${failures === 0 ? '全部通过' : '存在失败'}：${checks - failures}/${checks} 通过，${failures} 失败 =====`);
if (failures > 0) {
  process.exit(1);
}
