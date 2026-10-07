import { v4 as uuidv4 } from 'uuid';
import type {
  Piece,
  PieceType,
  Side,
  FormationType,
  SimulationResult,
  BattleEndReason,
} from './types';
import {
  BOARD_SIZE,
  CELL_SIZE,
  PIECE_RADIUS,
  PIECE_STATS,
  FORMATION_NAMES,
} from './types';
import { FORMATIONS } from './formations';

export const MORALE_MIN = 0;
export const MORALE_MAX = 100;
export const MORALE_INITIAL = 100;
export const MORALE_LOSS_PER_DEATH = 6;
export const MORALE_GAIN_PER_KILL = 3;
const MORALE_SPEED_BASE = 0.7;
const MORALE_SPEED_SPAN = 0.6;
const MORALE_COMBAT_BASE = 0.8;
const MORALE_COMBAT_SPAN = 0.4;

export function clampMorale(value: number): number {
  return Math.max(MORALE_MIN, Math.min(MORALE_MAX, Math.round(value)));
}

export function moraleSpeedFactor(morale: number): number {
  return MORALE_SPEED_BASE + (MORALE_SPEED_SPAN * clampMorale(morale)) / MORALE_MAX;
}

export function moraleCombatFactor(morale: number): number {
  return MORALE_COMBAT_BASE + (MORALE_COMBAT_SPAN * clampMorale(morale)) / MORALE_MAX;
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
        gridX = Math.floor(Math.random() * 6) + 2;
        gridY = Math.floor(Math.random() * 10) + 3;
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
        gridX = Math.floor(Math.random() * 6) + 8;
        gridY = Math.floor(Math.random() * 10) + 3;
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

function checkCollisions(
  pieces: Piece[],
  playerMorale: number,
  aiMorale: number
): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const alivePieces = pieces.filter((p) => p.status === 'alive');
  const combatFactor = (side: Side) =>
    moraleCombatFactor(side === 'player' ? playerMorale : aiMorale);

  for (let i = 0; i < alivePieces.length; i++) {
    for (let j = i + 1; j < alivePieces.length; j++) {
      const p1 = alivePieces[i];
      const p2 = alivePieces[j];
      if (p1.side === p2.side) continue;

      const dist = Math.sqrt(
        Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)
      );

      if (dist < PIECE_RADIUS * 2) {
        const p1Factor = combatFactor(p1.side);
        const p2Factor = combatFactor(p2.side);
        const p1EffectiveAttack = p1.attack * p1Factor;
        const p2EffectiveAttack = p2.attack * p2Factor;
        const p1EffectiveDefense = p1.defense * p1Factor;
        const p2EffectiveDefense = p2.defense * p2Factor;
        let deadPieceId: string;
        if (p1EffectiveAttack >= p2EffectiveDefense && p2EffectiveAttack >= p1EffectiveDefense) {
          deadPieceId = p1EffectiveDefense <= p2EffectiveDefense ? p1.id : p2.id;
        } else if (p1EffectiveAttack >= p2EffectiveDefense) {
          deadPieceId = p2.id;
        } else if (p2EffectiveAttack >= p1EffectiveDefense) {
          deadPieceId = p1.id;
        } else {
          deadPieceId = p1EffectiveDefense < p2EffectiveDefense ? p1.id : p2.id;
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

function calculateMovement(
  pieces: Piece[],
  playerFormation: FormationType | null,
  aiFormation: FormationType | null,
  deltaTime: number,
  playerMorale: number,
  aiMorale: number
): Piece[] {
  const updatedPieces = pieces.map((p) => ({ ...p }));
  const speed = 40 * deltaTime;

  const playerBonus = playerFormation ? FORMATIONS[playerFormation].attackBonus : 1;
  const aiBonus = aiFormation ? FORMATIONS[aiFormation].attackBonus : 1;
  const playerSpeedFactor = moraleSpeedFactor(playerMorale);
  const aiSpeedFactor = moraleSpeedFactor(aiMorale);

  const alivePlayers = updatedPieces.filter(
    (p) => p.side === 'player' && p.status === 'alive'
  );
  const aliveAis = updatedPieces.filter(
    (p) => p.side === 'ai' && p.status === 'alive'
  );

  alivePlayers.forEach((player) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    for (const ai of aliveAis) {
      if (ai.status !== 'alive') continue;
      const dist = Math.sqrt(
        Math.pow(ai.x - player.x, 2) + Math.pow(ai.y - player.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = ai;
      }
    }
    if (nearestEnemy && minDist > PIECE_RADIUS * 2) {
      const dx = nearestEnemy.x - player.x;
      const dy = nearestEnemy.y - player.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed =
        speed * (player.type === 'cavalry' ? 1.3 : 1) * playerBonus * playerSpeedFactor;
      player.x += (dx / len) * pieceSpeed;
      player.y += (dy / len) * pieceSpeed;
    }
  });

  aliveAis.forEach((ai) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    for (const player of alivePlayers) {
      if (player.status !== 'alive') continue;
      const dist = Math.sqrt(
        Math.pow(player.x - ai.x, 2) + Math.pow(player.y - ai.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = player;
      }
    }
    if (nearestEnemy && minDist > PIECE_RADIUS * 2) {
      const dx = nearestEnemy.x - ai.x;
      const dy = nearestEnemy.y - ai.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed =
        speed * (ai.type === 'cavalry' ? 1.3 : 1) * aiBonus * aiSpeedFactor;
      ai.x += (dx / len) * pieceSpeed;
      ai.y += (dy / len) * pieceSpeed;
    }
  });

  return updatedPieces;
}

export interface BattleState {
  pieces: Piece[];
  playerFormation: FormationType;
  aiFormation: FormationType;
  playerMorale: number;
  aiMorale: number;
  playerMoraleStart: number;
  aiMoraleStart: number;
  finished: boolean;
  winner: Side | 'draw' | null;
  endReason: BattleEndReason | null;
}

export function createBattle(
  pieces: Piece[],
  playerFormation: FormationType,
  aiFormation: FormationType,
  playerMorale: number,
  aiMorale: number
): BattleState {
  return {
    pieces: pieces.map((p) => ({ ...p })),
    playerFormation,
    aiFormation,
    playerMorale: clampMorale(playerMorale),
    aiMorale: clampMorale(aiMorale),
    playerMoraleStart: clampMorale(playerMorale),
    aiMoraleStart: clampMorale(aiMorale),
    finished: false,
    winner: null,
    endReason: null,
  };
}

export interface BattleEnd {
  winner: Side | 'draw';
  reason: BattleEndReason;
}

export function countAlive(pieces: Piece[], side: Side): number {
  return pieces.filter((p) => p.side === side && p.status === 'alive').length;
}

export function resolveBattleEnd(
  pieces: Piece[],
  playerMorale: number,
  aiMorale: number
): BattleEnd | null {
  const playerOut = countAlive(pieces, 'player') === 0 || playerMorale <= MORALE_MIN;
  const aiOut = countAlive(pieces, 'ai') === 0 || aiMorale <= MORALE_MIN;

  if (!playerOut && !aiOut) return null;
  if (playerOut && aiOut) {
    return { winner: 'draw', reason: 'mutual-destruction' };
  }
  if (playerOut) {
    return { winner: 'ai', reason: playerMorale <= MORALE_MIN ? 'rout' : 'annihilation' };
  }
  return { winner: 'player', reason: aiMorale <= MORALE_MIN ? 'rout' : 'annihilation' };
}

function applyCasualtyMorale(
  pieces: Piece[],
  deadIds: Set<string>,
  playerMorale: number,
  aiMorale: number
): { playerMorale: number; aiMorale: number } {
  let nextPlayer = playerMorale;
  let nextAi = aiMorale;
  pieces.forEach((piece) => {
    if (!deadIds.has(piece.id)) return;
    if (piece.side === 'player') {
      nextPlayer -= MORALE_LOSS_PER_DEATH;
      nextAi += MORALE_GAIN_PER_KILL;
    } else {
      nextAi -= MORALE_LOSS_PER_DEATH;
      nextPlayer += MORALE_GAIN_PER_KILL;
    }
  });
  return {
    playerMorale: clampMorale(nextPlayer),
    aiMorale: clampMorale(nextAi),
  };
}

export interface BattleStep {
  state: BattleState;
  events: CollisionEvent[];
}

export function stepBattle(state: BattleState, deltaTime: number): BattleStep {
  if (state.finished) {
    return { state, events: [] };
  }

  const opening = resolveBattleEnd(state.pieces, state.playerMorale, state.aiMorale);
  if (opening) {
    return {
      state: {
        ...state,
        finished: true,
        winner: opening.winner,
        endReason: opening.reason,
      },
      events: [],
    };
  }

  let pieces = calculateMovement(
    state.pieces,
    state.playerFormation,
    state.aiFormation,
    deltaTime,
    state.playerMorale,
    state.aiMorale
  );

  const events = checkCollisions(pieces, state.playerMorale, state.aiMorale);
  const deadIds = new Set(events.map((event) => event.deadPieceId));
  if (events.length > 0) {
    pieces = pieces.map((p) =>
      deadIds.has(p.id) ? { ...p, status: 'dead' as const } : p
    );
  }

  const morale = applyCasualtyMorale(state.pieces, deadIds, state.playerMorale, state.aiMorale);

  const end = resolveBattleEnd(pieces, morale.playerMorale, morale.aiMorale);

  return {
    state: {
      ...state,
      pieces,
      playerMorale: morale.playerMorale,
      aiMorale: morale.aiMorale,
      finished: end !== null,
      winner: end ? end.winner : null,
      endReason: end ? end.reason : null,
    },
    events,
  };
}

export function getBattleResult(state: BattleState): SimulationResult {
  const playerRemaining = countAlive(state.pieces, 'player');
  const aiRemaining = countAlive(state.pieces, 'ai');

  let winner: Side | 'draw';
  let endReason: BattleEndReason;
  if (state.finished && state.winner !== null && state.endReason !== null) {
    winner = state.winner;
    endReason = state.endReason;
  } else if (playerRemaining > aiRemaining) {
    winner = 'player';
    endReason = 'annihilation';
  } else if (aiRemaining > playerRemaining) {
    winner = 'ai';
    endReason = 'annihilation';
  } else {
    winner = 'draw';
    endReason = 'mutual-destruction';
  }

  return {
    winner,
    playerRemaining,
    aiRemaining,
    playerFormation: state.playerFormation,
    aiFormation: state.aiFormation,
    playerMoraleStart: state.playerMoraleStart,
    playerMoraleEnd: state.playerMorale,
    aiMoraleStart: state.aiMoraleStart,
    aiMoraleEnd: state.aiMorale,
    endReason,
    timestamp: Date.now(),
    snapshot: JSON.parse(JSON.stringify(state.pieces)),
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

export function selectAiFormation(): FormationType {
  const formations: FormationType[] = ['yulin', 'fangyuan', 'heyi'];
  return formations[Math.floor(Math.random() * formations.length)];
}

export function formatHistoryText(
  playerFormation: string,
  aiFormation: string,
  result: 'win' | 'lose' | 'draw',
  remaining: number
): string {
  const resultText = result === 'win' ? '胜' : result === 'lose' ? '败' : '平';
  const playerName = FORMATION_NAMES[playerFormation as FormationType] || playerFormation;
  const aiName = FORMATION_NAMES[aiFormation as FormationType] || aiFormation;
  return `${playerName}vs${aiName}，${resultText}，剩余${remaining}兵`;
}
