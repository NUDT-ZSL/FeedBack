export type Rarity = 'common' | 'rare' | 'epic';
export type Ability = 'charge' | 'taunt' | 'divineShield' | null;

export interface Card {
  id: string;
  name: string;
  cost: number;
  attack: number;
  health: number;
  rarity: Rarity;
  ability: Ability;
  abilityDesc: string;
}

export interface BattleCard {
  instanceId: string;
  card: Card;
  currentHealth: number;
  currentAttack: number;
  hasDivineShield: boolean;
  hasAttacked: boolean;
  summonSickness: boolean;
}

export interface PlayerState {
  deck: Card[];
  hand: Card[];
  board: BattleCard[];
  health: number;
  maxMana: number;
  currentMana: number;
}

export interface BattleLogEntry {
  turn: number;
  player: 'A' | 'B';
  message: string;
  timestamp: number;
}

export interface BattleResult {
  winner: 'A' | 'B' | 'draw';
  finalHealthA: number;
  finalHealthB: number;
  cardUsageA: Record<string, number>;
  cardUsageB: Record<string, number>;
  cardDamageA: Record<string, number>;
  cardDamageB: Record<string, number>;
  logs: BattleLogEntry[];
}

export interface BattleStats {
  totalRounds: number;
  winsA: number;
  winsB: number;
  draws: number;
  winRateA: number;
  winRateB: number;
  avgHealthA: number;
  avgHealthB: number;
  cardUsageA: Record<string, number>;
  cardUsageB: Record<string, number>;
  cardDamageA: Record<string, number>;
  cardDamageB: Record<string, number>;
  balanceSuggestion: string;
}

export const CARD_LIBRARY: Card[] = [
  { id: 'c1', name: '新兵', cost: 1, attack: 1, health: 2, rarity: 'common', ability: null, abilityDesc: '普通士兵' },
  { id: 'c2', name: '护卫者', cost: 2, attack: 1, health: 4, rarity: 'common', ability: 'taunt', abilityDesc: '嘲讽：敌方必须优先攻击此单位' },
  { id: 'c3', name: '游侠', cost: 2, attack: 3, health: 2, rarity: 'common', ability: null, abilityDesc: '远程攻击手' },
  { id: 'c4', name: '狂热者', cost: 3, attack: 4, health: 3, rarity: 'common', ability: 'charge', abilityDesc: '冲锋：召唤当回合即可攻击' },
  { id: 'c5', name: '圣骑士', cost: 3, attack: 2, health: 3, rarity: 'rare', ability: 'divineShield', abilityDesc: '圣盾：免疫首次受到的伤害' },
  { id: 'c6', name: '狂战士', cost: 4, attack: 5, health: 4, rarity: 'rare', ability: null, abilityDesc: '强力近战单位' },
  { id: 'c7', name: '盾卫', cost: 4, attack: 2, health: 6, rarity: 'rare', ability: 'taunt', abilityDesc: '嘲讽：敌方必须优先攻击此单位' },
  { id: 'c8', name: '暗影刺客', cost: 4, attack: 5, health: 2, rarity: 'rare', ability: 'charge', abilityDesc: '冲锋：召唤当回合即可攻击' },
  { id: 'c9', name: '神圣骑士', cost: 5, attack: 4, health: 5, rarity: 'epic', ability: 'divineShield', abilityDesc: '圣盾：免疫首次受到的伤害' },
  { id: 'c10', name: '战争领主', cost: 5, attack: 6, health: 6, rarity: 'epic', ability: null, abilityDesc: '强力领袖单位' },
  { id: 'c11', name: '巨盾卫士', cost: 6, attack: 3, health: 8, rarity: 'epic', ability: 'taunt', abilityDesc: '嘲讽：敌方必须优先攻击此单位' },
  { id: 'c12', name: '风暴使者', cost: 6, attack: 7, health: 5, rarity: 'epic', ability: 'charge', abilityDesc: '冲锋：召唤当回合即可攻击' },
];

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

let instanceCounter = 0;
function generateInstanceId(): string {
  instanceCounter++;
  return `bc_${instanceCounter}_${Date.now()}`;
}

function createBattleCard(card: Card): BattleCard {
  return {
    instanceId: generateInstanceId(),
    card,
    currentHealth: card.health,
    currentAttack: card.attack,
    hasDivineShield: card.ability === 'divineShield',
    hasAttacked: false,
    summonSickness: card.ability !== 'charge',
  };
}

function createPlayerState(deck: Card[]): PlayerState {
  const shuffledDeck = shuffle([...deck]);
  return {
    deck: shuffledDeck,
    hand: [],
    board: [],
    health: 30,
    maxMana: 0,
    currentMana: 0,
  };
}

function drawCard(player: PlayerState): void {
  if (player.deck.length > 0 && player.hand.length < 10) {
    const card = player.deck.shift()!;
    player.hand.push(card);
  }
}

function playCards(player: PlayerState, logs: BattleLogEntry[], turn: number, playerSide: 'A' | 'B', cardUsage: Record<string, number>): void {
  let played = true;
  while (played) {
    played = false;
    player.hand.sort((a, b) => a.cost - b.cost);
    for (let i = 0; i < player.hand.length; i++) {
      const card = player.hand[i];
      if (card.cost <= player.currentMana && player.board.length < 7) {
        player.currentMana -= card.cost;
        player.hand.splice(i, 1);
        const battleCard = createBattleCard(card);
        player.board.push(battleCard);
        cardUsage[card.id] = (cardUsage[card.id] || 0) + 1;
        logs.push({
          turn,
          player: playerSide,
          message: `召唤 ${card.name} (${card.cost}费)`,
          timestamp: Date.now(),
        });
        played = true;
        break;
      }
    }
  }
}

function findAttackTarget(enemyBoard: BattleCard[]): BattleCard | null {
  const tauntMinions = enemyBoard.filter(c => c.card.ability === 'taunt');
  if (tauntMinions.length > 0) {
    tauntMinions.sort((a, b) => a.currentHealth - b.currentHealth);
    return tauntMinions[0];
  }
  if (enemyBoard.length === 0) {
    return null;
  }
  const sorted = [...enemyBoard].sort((a, b) => a.currentHealth - b.currentHealth);
  return sorted[0];
}

function dealDamage(target: BattleCard | 'hero', damage: number, defender: PlayerState, damageDealt: Record<string, number>, attackerCard?: Card): void {
  if (target === 'hero') {
    defender.health -= damage;
    if (attackerCard) {
      damageDealt[attackerCard.id] = (damageDealt[attackerCard.id] || 0) + damage;
    }
    return;
  }
  if (target.hasDivineShield) {
    target.hasDivineShield = false;
    return;
  }
  target.currentHealth -= damage;
  if (attackerCard) {
    damageDealt[attackerCard.id] = (damageDealt[attackerCard.id] || 0) + damage;
  }
}

function removeDeadMinions(player: PlayerState): void {
  player.board = player.board.filter(c => c.currentHealth > 0);
}

function performAttacks(
  attacker: PlayerState,
  defender: PlayerState,
  logs: BattleLogEntry[],
  turn: number,
  attackerSide: 'A' | 'B',
  damageDealt: Record<string, number>,
): void {
  for (const minion of attacker.board) {
    if (minion.summonSickness || minion.hasAttacked) continue;
    const target = findAttackTarget(defender.board);
    if (target) {
      dealDamage(target, minion.currentAttack, defender, damageDealt, minion.card);
      dealDamage(minion, target.currentAttack, attacker, {} as Record<string, number>);
      logs.push({
        turn,
        player: attackerSide,
        message: `${minion.card.name} 攻击 ${target.card.name} (造成${minion.currentAttack}点伤害)`,
        timestamp: Date.now(),
      });
    } else {
      defender.health -= minion.currentAttack;
      damageDealt[minion.card.id] = (damageDealt[minion.card.id] || 0) + minion.currentAttack;
      logs.push({
        turn,
        player: attackerSide,
        message: `${minion.card.name} 攻击敌方英雄 (造成${minion.currentAttack}点伤害)`,
        timestamp: Date.now(),
      });
    }
    minion.hasAttacked = true;
  }
  removeDeadMinions(attacker);
  removeDeadMinions(defender);
}

function resetMinionState(player: PlayerState): void {
  for (const minion of player.board) {
    minion.hasAttacked = false;
    minion.summonSickness = false;
  }
}

export function runSingleBattle(deckA: Card[], deckB: Card[]): BattleResult {
  const playerA = createPlayerState(deckA);
  const playerB = createPlayerState(deckB);
  const logs: BattleLogEntry[] = [];
  const cardUsageA: Record<string, number> = {};
  const cardUsageB: Record<string, number> = {};
  const cardDamageA: Record<string, number> = {};
  const cardDamageB: Record<string, number> = {};

  drawCard(playerA);
  drawCard(playerA);
  drawCard(playerA);
  drawCard(playerB);
  drawCard(playerB);
  drawCard(playerB);
  drawCard(playerB);

  let turn = 0;
  const maxTurns = 30;

  while (turn < maxTurns && playerA.health > 0 && playerB.health > 0) {
    turn++;

    playerA.maxMana = Math.min(playerA.maxMana + 1, 10);
    playerA.currentMana = playerA.maxMana;
    drawCard(playerA);
    playCards(playerA, logs, turn, 'A', cardUsageA);
    resetMinionState(playerA);
    performAttacks(playerA, playerB, logs, turn, 'A', cardDamageA);

    if (playerB.health <= 0 || playerA.health <= 0) break;

    turn++;

    playerB.maxMana = Math.min(playerB.maxMana + 1, 10);
    playerB.currentMana = playerB.maxMana;
    drawCard(playerB);
    playCards(playerB, logs, turn, 'B', cardUsageB);
    resetMinionState(playerB);
    performAttacks(playerB, playerA, logs, turn, 'B', cardDamageB);
  }

  let winner: 'A' | 'B' | 'draw';
  if (playerA.health > 0 && playerB.health <= 0) {
    winner = 'A';
  } else if (playerB.health > 0 && playerA.health <= 0) {
    winner = 'B';
  } else {
    winner = playerA.health > playerB.health ? 'A' : playerB.health > playerA.health ? 'B' : 'draw';
  }

  logs.push({
    turn,
    player: 'A',
    message: `对战结束！胜者: ${winner === 'draw' ? '平局' : '卡组' + winner} (A: ${playerA.health}血, B: ${playerB.health}血)`,
    timestamp: Date.now(),
  });

  return {
    winner,
    finalHealthA: Math.max(0, playerA.health),
    finalHealthB: Math.max(0, playerB.health),
    cardUsageA,
    cardUsageB,
    cardDamageA,
    cardDamageB,
    logs,
  };
}

export function runSimulation(
  deckA: Card[],
  deckB: Card[],
  rounds: number,
  onProgress?: (current: number, total: number, lastLogs: BattleLogEntry[]) => void,
): BattleStats {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let totalHealthA = 0;
  let totalHealthB = 0;
  const cardUsageA: Record<string, number> = {};
  const cardUsageB: Record<string, number> = {};
  const cardDamageA: Record<string, number> = {};
  const cardDamageB: Record<string, number> = {};

  for (let i = 0; i < rounds; i++) {
    const result = runSingleBattle(deckA, deckB);

    if (result.winner === 'A') winsA++;
    else if (result.winner === 'B') winsB++;
    else draws++;

    totalHealthA += result.finalHealthA;
    totalHealthB += result.finalHealthB;

    for (const [cardId, count] of Object.entries(result.cardUsageA)) {
      cardUsageA[cardId] = (cardUsageA[cardId] || 0) + count;
    }
    for (const [cardId, count] of Object.entries(result.cardUsageB)) {
      cardUsageB[cardId] = (cardUsageB[cardId] || 0) + count;
    }
    for (const [cardId, damage] of Object.entries(result.cardDamageA)) {
      cardDamageA[cardId] = (cardDamageA[cardId] || 0) + damage;
    }
    for (const [cardId, damage] of Object.entries(result.cardDamageB)) {
      cardDamageB[cardId] = (cardDamageB[cardId] || 0) + damage;
    }

    if (onProgress && (i % 10 === 0 || i === rounds - 1)) {
      onProgress(i + 1, rounds, result.logs.slice(-5));
    }
  }

  const balanceSuggestion = generateBalanceSuggestion(winsA, winsB, draws, rounds, cardDamageA, cardDamageB, deckA, deckB);

  return {
    totalRounds: rounds,
    winsA,
    winsB,
    draws,
    winRateA: (winsA / rounds) * 100,
    winRateB: (winsB / rounds) * 100,
    avgHealthA: totalHealthA / rounds,
    avgHealthB: totalHealthB / rounds,
    cardUsageA,
    cardUsageB,
    cardDamageA,
    cardDamageB,
    balanceSuggestion,
  };
}

function generateBalanceSuggestion(
  winsA: number,
  winsB: number,
  _draws: number,
  rounds: number,
  damageA: Record<string, number>,
  damageB: Record<string, number>,
  deckA: Card[],
  deckB: Card[],
): string {
  const winRateA = (winsA / rounds) * 100;
  const winRateB = (winsB / rounds) * 100;
  const diff = Math.abs(winRateA - winRateB);

  if (diff < 5) {
    return '两个卡组胜率接近，平衡性良好。';
  }

  const strongerDeck = winRateA > winRateB ? 'A' : 'B';
  const weakerDeck = winRateA > winRateB ? 'B' : 'A';
  const strongerDamage = winRateA > winRateB ? damageA : damageB;
  const strongerDeckCards = winRateA > winRateB ? deckA : deckB;

  const sortedByDamage = Object.entries(strongerDamage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const topCardId = sortedByDamage[0]?.[0];
  const topCard = strongerDeckCards.find(c => c.id === topCardId);

  if (topCard && diff > 20) {
    return `卡组${strongerDeck}胜率显著偏高（${Math.max(winRateA, winRateB).toFixed(1)}%），建议削弱卡牌「${topCard.name}」，可考虑降低攻击力1点或增加费用1点。`;
  } else if (diff > 10) {
    return `卡组${strongerDeck}胜率偏高（${Math.max(winRateA, winRateB).toFixed(1)}%），卡组${weakerDeck}需要加强。建议为卡组${weakerDeck}添加更多低费快攻卡牌或治疗卡牌。`;
  } else {
    return `卡组${strongerDeck}胜率略高（${Math.max(winRateA, winRateB).toFixed(1)}%），整体趋于平衡，可做微调。`;
  }
}
