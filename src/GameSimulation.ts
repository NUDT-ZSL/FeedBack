import { v4 as uuidv4 } from 'uuid';
import type {
  Piece,
  PieceType,
  Side,
  FormationType,
  SimulationResult,
  MoraleState,
  HistoryItem,
} from './types';
import {
  BOARD_SIZE,
  CELL_SIZE,
  PIECE_RADIUS,
  PIECE_STATS,
  FORMATION_NAMES,
  MORALE_MAX,
  MORALE_MIN,
} from './types';
import { FORMATIONS } from './formations';

export const HISTORY_LIMIT = 20;

export const MORALE_CASUALTY_COST: Record<PieceType, number> = {
  infantry: 4,
  archer: 5,
  cavalry: 6,
};
export const MORALE_KILL_BONUS = 2;

export function createInitialMorale(): MoraleState {
  return { player: MORALE_MAX, ai: MORALE_MAX };
}

export function clampMorale(value: number): number {
  return Math.max(MORALE_MIN, Math.min(MORALE_MAX, Math.round(value)));
}

export function moraleSpeedFactor(morale: number): number {
  return 0.6 + 0.4 * (clampMorale(morale) / MORALE_MAX);
}

export function moraleCombatFactor(morale: number): number {
  return 0.7 + 0.3 * (clampMorale(morale) / MORALE_MAX);
}

export function applyCasualtyMorale(morale: MoraleState, deadPiece: Piece): MoraleState {
  const loser = deadPiece.side;
  const killer: Side = loser === 'player' ? 'ai' : 'player';
  return {
    ...morale,
    [loser]: clampMorale(morale[loser] - MORALE_CASUALTY_COST[deadPiece.type]),
    [killer]: clampMorale(morale[killer] + MORALE_KILL_BONUS),
  };
}

export function isSideBroken(pieces: Piece[], morale: MoraleState, side: Side): boolean {
  if (morale[side] <= MORALE_MIN) return true;
  return !pieces.some((p) => p.side === side && p.status !== 'dead');
}

export function createPiece(
  type: PieceType,
  side: Side,
  gridX: number,
  gridY: number
): Piece {
  const stats = PIECE_STATS[type];
  return {
    id: uuidv4(),
    type,
    side,
    x: gridX * CELL_SIZE + CELL_SIZE / 2,
    y: gridY * CELL_SIZE + CELL_SIZE / 2,
    status: 'alive',
    attack: stats.attack,
    defense: stats.defense,
  };
}

export function initializePieces(): Piece[] {
  return initializePiecesWithRandom(Math.random);
}

export function initializePiecesWithRandom(random: () => number): Piece[] {
  const pieces: Piece[] = [];
  const playerPieces: { type: PieceType; count: number }[] = [
    { type: 'infantry', count: 8 },
    { type: 'archer', count: 4 },
    { type: 'cavalry', count: 3 },
  ];
  const usedPositions = new Set<string>();

  playerPieces.forEach(({ type, count }) => {
    for (let i = 0; i < count; i++) {
      let gridX: number, gridY: number, key: string;
      do {
        gridX = Math.floor(random() * 6) + 2;
        gridY = Math.floor(random() * 10) + 3;
        key = `${gridX},${gridY}`;
      } while (usedPositions.has(key));
      usedPositions.add(key);
      pieces.push(createPiece(type, 'player', gridX, gridY));
    }
  });

  usedPositions.clear();
  const aiPieces: { type: PieceType; count: number }[] = [
    { type: 'infantry', count: 8 },
    { type: 'archer', count: 4 },
    { type: 'cavalry', count: 3 },
  ];

  aiPieces.forEach(({ type, count }) => {
    for (let i = 0; i < count; i++) {
      let gridX: number, gridY: number, key: string;
      do {
        gridX = Math.floor(random() * 6) + 8;
        gridY = Math.floor(random() * 10) + 3;
        key = `${gridX},${gridY}`;
      } while (usedPositions.has(key));
      usedPositions.add(key);
      pieces.push(createPiece(type, 'ai', gridX, gridY));
    }
  });

  return pieces;
}

export function snapToGrid(x: number, y: number): { x: number; y: number; gridX: number; gridY: number } {
  const gridX = Math.round(x / CELL_SIZE);
  const gridY = Math.round(y / CELL_SIZE);
  const snappedX = gridX * CELL_SIZE + CELL_SIZE / 2;
  const snappedY = gridY * CELL_SIZE + CELL_SIZE / 2;
  return { x: snappedX, y: snappedY, gridX, gridY };
}

export function isValidPosition(
  pieces: Piece[],
  pieceId: string,
  gridX: number,
  gridY: number
): boolean {
  if (gridX < 0 || gridX >= BOARD_SIZE || gridY < 0 || gridY >= BOARD_SIZE) {
    return false;
  }
  const targetX = gridX * CELL_SIZE + CELL_SIZE / 2;
  const targetY = gridY * CELL_SIZE + CELL_SIZE / 2;
  for (const piece of pieces) {
    if (piece.id === pieceId || piece.status === 'dead') continue;
    const dist = Math.sqrt(
      Math.pow(piece.x - targetX, 2) + Math.pow(piece.y - targetY, 2)
    );
    if (dist < PIECE_RADIUS * 2) {
      return false;
    }
  }
  return true;
}

export function rearrangeFormation(
  pieces: Piece[],
  formationType: FormationType,
  side: Side,
  centerGridX: number,
  centerGridY: number
): Map<string, { x: number; y: number }> {
  const formation = FORMATIONS[formationType];
  const moveMap = new Map<string, { x: number; y: number }>();
  const sidePieces = pieces.filter((p) => p.side === side && p.status === 'alive');

  const byType: Record<PieceType, Piece[]> = {
    infantry: [],
    archer: [],
    cavalry: [],
  };
  sidePieces.forEach((p) => byType[p.type].push(p));

  const usedPieces = new Set<string>();
  formation.positions.forEach((pos) => {
    const piece = byType[pos.type].find((p) => !usedPieces.has(p.id));
    if (piece) {
      usedPieces.add(piece.id);
      const targetGridX = centerGridX + pos.dx;
      const targetGridY = centerGridY + pos.dy;
      moveMap.set(piece.id, {
        x: targetGridX * CELL_SIZE + CELL_SIZE / 2,
        y: targetGridY * CELL_SIZE + CELL_SIZE / 2,
      });
    }
  });

  return moveMap;
}

export interface CollisionEvent {
  piece1Id: string;
  piece2Id: string;
  x: number;
  y: number;
  deadPieceId: string;
}

export function checkCollisions(pieces: Piece[], morale?: MoraleState): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const alivePieces = pieces.filter((p) => p.status !== 'dead');
  const combatFactor = (side: Side) =>
    morale ? moraleCombatFactor(morale[side]) : 1;

  for (let i = 0; i < alivePieces.length; i++) {
    for (let j = i + 1; j < alivePieces.length; j++) {
      const p1 = alivePieces[i];
      const p2 = alivePieces[j];
      if (p1.side === p2.side) continue;

      const dist = Math.sqrt(
        Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)
      );

      if (dist < PIECE_RADIUS * 2) {
        const p1EffectiveAttack = p1.attack * combatFactor(p1.side);
        const p2EffectiveAttack = p2.attack * combatFactor(p2.side);
        let deadPieceId: string;
        if (p1EffectiveAttack >= p2.defense && p2EffectiveAttack >= p1.defense) {
          deadPieceId = p1.defense <= p2.defense ? p1.id : p2.id;
        } else if (p1EffectiveAttack >= p2.defense) {
          deadPieceId = p2.id;
        } else if (p2EffectiveAttack >= p1.defense) {
          deadPieceId = p1.id;
        } else {
          deadPieceId = p1.defense < p2.defense ? p1.id : p2.id;
        }
        events.push({
          piece1Id: p1.id,
          piece2Id: p2.id,
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2,
          deadPieceId,
        });
      }
    }
  }
  return events;
}

export function calculateMovement(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null,
  deltaTime: number,
  morale?: MoraleState
): Piece[] {
  const updatedPieces = pieces.map((p) => ({ ...p }));
  const speed = 40 * deltaTime;

  const playerBonus = playerFormation ? FORMATIONS[playerFormation].attackBonus : 1;
  const aiBonus = aiFormation ? FORMATIONS[aiFormation].attackBonus : 1;
  const playerMoraleFactor = morale ? moraleSpeedFactor(morale.player) : 1;
  const aiMoraleFactor = morale ? moraleSpeedFactor(morale.ai) : 1;

  const alivePlayers = updatedPieces.filter(
    (p) => p.side === 'player' && p.status !== 'dead'
  );
  const aliveAis = updatedPieces.filter(
    (p) => p.side === 'ai' && p.status !== 'dead'
  );

  alivePlayers.forEach((player) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    aliveAis.forEach((ai) => {
      if (ai.status === 'dead') return;
      const dist = Math.sqrt(
        Math.pow(ai.x - player.x, 2) + Math.pow(ai.y - player.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = ai;
      }
    });
    const playerTarget = nearestEnemy as Piece | null;
    if (playerTarget && minDist > PIECE_RADIUS * 2) {
      const dx = playerTarget.x - player.x;
      const dy = playerTarget.y - player.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed =
        speed * (player.type === 'cavalry' ? 1.3 : 1) * playerBonus * playerMoraleFactor;
      player.x += (dx / len) * pieceSpeed;
      player.y += (dy / len) * pieceSpeed;
      player.status = 'moving';
    }
  });

  aliveAis.forEach((ai) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    alivePlayers.forEach((player) => {
      if (player.status === 'dead') return;
      const dist = Math.sqrt(
        Math.pow(player.x - ai.x, 2) + Math.pow(player.y - ai.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = player;
      }
    });
    const aiTarget = nearestEnemy as Piece | null;
    if (aiTarget && minDist > PIECE_RADIUS * 2) {
      const dx = aiTarget.x - ai.x;
      const dy = aiTarget.y - ai.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed =
        speed * (ai.type === 'cavalry' ? 1.3 : 1) * aiBonus * aiMoraleFactor;
      ai.x += (dx / len) * pieceSpeed;
      ai.y += (dy / len) * pieceSpeed;
      ai.status = 'moving';
    }
  });

  return updatedPieces;
}

export interface SimulationStepOutcome {
  pieces: Piece[];
  morale: MoraleState;
  deaths: CollisionEvent[];
  complete: boolean;
}

export function simulateStep(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null,
  morale: MoraleState,
  deltaTime: number
): SimulationStepOutcome {
  let updated = calculateMovement(pieces, playerFormation, aiFormation, deltaTime, morale);
  const events = checkCollisions(updated, morale);
  const deaths: CollisionEvent[] = [];
  let currentMorale: MoraleState = { ...morale };

  for (const event of events) {
    if (currentMorale.player <= MORALE_MIN || currentMorale.ai <= MORALE_MIN) break;
    const deadPiece = updated.find((p) => p.id === event.deadPieceId);
    if (!deadPiece || deadPiece.status === 'dead') continue;
    updated = updated.map((p) =>
      p.id === event.deadPieceId ? { ...p, status: 'dead' as const } : p
    );
    currentMorale = applyCasualtyMorale(currentMorale, deadPiece);
    deaths.push(event);
  }

  return {
    pieces: updated,
    morale: currentMorale,
    deaths,
    complete: isSimulationComplete(updated, currentMorale),
  };
}

export function isSimulationComplete(pieces: Piece[], morale?: MoraleState): boolean {
  const playerBroken = isSideBroken(pieces, morale ?? { player: 1, ai: 1 }, 'player');
  const aiBroken = isSideBroken(pieces, morale ?? { player: 1, ai: 1 }, 'ai');
  return playerBroken || aiBroken;
}

export function getSimulationResult(
  pieces: Piece[],
  playerFormation: FormationType,
  aiFormation: FormationType,
  moraleStart?: MoraleState,
  moraleEnd?: MoraleState
): SimulationResult {
  const endMorale: MoraleState = moraleEnd ?? createInitialMorale();
  const startMorale: MoraleState = moraleStart ?? endMorale;
  const playerBroken = isSideBroken(pieces, endMorale, 'player');
  const aiBroken = isSideBroken(pieces, endMorale, 'ai');
  const playerStanding = pieces.filter((p) => p.side === 'player' && p.status !== 'dead');
  const aiStanding = pieces.filter((p) => p.side === 'ai' && p.status !== 'dead');

  let winner: 'player' | 'ai' | 'draw';
  if (playerBroken && aiBroken) {
    winner = 'draw';
  } else if (playerBroken) {
    winner = 'ai';
  } else if (aiBroken) {
    winner = 'player';
  } else if (playerStanding.length > aiStanding.length) {
    winner = 'player';
  } else if (aiStanding.length > playerStanding.length) {
    winner = 'ai';
  } else {
    winner = 'draw';
  }

  return {
    winner,
    playerRemaining: playerStanding.length,
    aiRemaining: aiStanding.length,
    playerMoraleStart: clampMorale(startMorale.player),
    playerMoraleEnd: clampMorale(endMorale.player),
    aiMoraleStart: clampMorale(startMorale.ai),
    aiMoraleEnd: clampMorale(endMorale.ai),
    playerFormation,
    aiFormation,
    timestamp: Date.now(),
    snapshot: JSON.parse(JSON.stringify(pieces)),
  };
}

export function buildHistoryItem(result: SimulationResult, id: string): HistoryItem {
  return {
    id,
    playerFormation: result.playerFormation,
    aiFormation: result.aiFormation,
    result: result.winner === 'player' ? 'win' : result.winner === 'ai' ? 'lose' : 'draw',
    playerRemaining: result.playerRemaining,
    aiRemaining: result.aiRemaining,
    playerMoraleStart: result.playerMoraleStart,
    playerMoraleEnd: result.playerMoraleEnd,
    aiMoraleStart: result.aiMoraleStart,
    aiMoraleEnd: result.aiMoraleEnd,
    timestamp: result.timestamp,
    snapshot: JSON.parse(JSON.stringify(result.snapshot)),
  };
}

export function pushHistory(history: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...history].slice(0, HISTORY_LIMIT);
}

export function resultFromHistoryItem(item: HistoryItem): SimulationResult {
  return {
    winner: item.result === 'win' ? 'player' : item.result === 'lose' ? 'ai' : 'draw',
    playerRemaining: item.playerRemaining,
    aiRemaining: item.aiRemaining,
    playerMoraleStart: item.playerMoraleStart,
    playerMoraleEnd: item.playerMoraleEnd,
    aiMoraleStart: item.aiMoraleStart,
    aiMoraleEnd: item.aiMoraleEnd,
    playerFormation: item.playerFormation as FormationType,
    aiFormation: item.aiFormation as FormationType,
    timestamp: item.timestamp,
    snapshot: JSON.parse(JSON.stringify(item.snapshot)),
  };
}

export function getFormationCenter(
  pieces: Piece[],
  side: Side
): { gridX: number; gridY: number } {
  const sidePieces = pieces.filter((p) => p.side === side && p.status === 'alive');
  if (sidePieces.length === 0) {
    return { gridX: 8, gridY: 8 };
  }
  const sumX = sidePieces.reduce((sum, p) => sum + p.x, 0);
  const sumY = sidePieces.reduce((sum, p) => sum + p.y, 0);
  const avgX = sumX / sidePieces.length;
  const avgY = sumY / sidePieces.length;
  return {
    gridX: Math.round(avgX / CELL_SIZE),
    gridY: Math.round(avgY / CELL_SIZE),
  };
}

export function selectAiFormation(random: () => number = Math.random): FormationType {
  const formations: FormationType[] = ['yulin', 'fangyuan', 'heyi'];
  return formations[Math.floor(random() * formations.length)];
}

export function formatHistoryText(
  item: Pick<HistoryItem, 'playerFormation' | 'aiFormation' | 'result' | 'playerRemaining' | 'aiRemaining'>
): string {
  const resultText = item.result === 'win' ? '胜' : item.result === 'lose' ? '败' : '平';
  const playerName = FORMATION_NAMES[item.playerFormation as FormationType] || item.playerFormation;
  const aiName = FORMATION_NAMES[item.aiFormation as FormationType] || item.aiFormation;
  return `${playerName}vs${aiName}，${resultText}，剩余 我${item.playerRemaining}/敌${item.aiRemaining}`;
}

export function formatMoraleRange(start: number, end: number): string {
  return `${start}→${end}`;
}
