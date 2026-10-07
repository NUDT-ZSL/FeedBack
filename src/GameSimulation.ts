import { v4 as uuidv4 } from 'uuid';
import type {
  Piece,
  PieceType,
  Side,
  FormationType,
  SimulationResult,
  PieceStatus,
} from './types';
import {
  BOARD_SIZE,
  CELL_SIZE,
  PIECE_RADIUS,
  PIECE_STATS,
  FORMATION_NAMES,
} from './types';
import { FORMATIONS } from './formations';

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

export function checkCollisions(pieces: Piece[]): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const alivePieces = pieces.filter((p) => p.status === 'alive');

  for (let i = 0; i < alivePieces.length; i++) {
    for (let j = i + 1; j < alivePieces.length; j++) {
      const p1 = alivePieces[i];
      const p2 = alivePieces[j];
      if (p1.side === p2.side) continue;

      const dist = Math.sqrt(
        Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)
      );

      if (dist < PIECE_RADIUS * 2) {
        const p1EffectiveAttack = p1.attack;
        const p2EffectiveAttack = p2.attack;
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
  deltaTime: number
): Piece[] {
  const updatedPieces = pieces.map((p) => ({ ...p }));
  const speed = 40 * deltaTime;

  const playerBonus = playerFormation ? FORMATIONS[playerFormation].attackBonus : 1;
  const aiBonus = aiFormation ? FORMATIONS[aiFormation].attackBonus : 1;

  const alivePlayers = updatedPieces.filter(
    (p) => p.side === 'player' && p.status === 'alive'
  );
  const aliveAis = updatedPieces.filter(
    (p) => p.side === 'ai' && p.status === 'alive'
  );

  alivePlayers.forEach((player) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    aliveAis.forEach((ai) => {
      if (ai.status !== 'alive') return;
      const dist = Math.sqrt(
        Math.pow(ai.x - player.x, 2) + Math.pow(ai.y - player.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = ai;
      }
    });
    if (nearestEnemy && minDist > PIECE_RADIUS * 2) {
      const dx = nearestEnemy.x - player.x;
      const dy = nearestEnemy.y - player.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed = speed * (player.type === 'cavalry' ? 1.3 : 1) * playerBonus;
      player.x += (dx / len) * pieceSpeed;
      player.y += (dy / len) * pieceSpeed;
      player.status = 'moving';
    }
  });

  aliveAis.forEach((ai) => {
    let nearestEnemy: Piece | null = null;
    let minDist = Infinity;
    alivePlayers.forEach((player) => {
      if (player.status !== 'alive') return;
      const dist = Math.sqrt(
        Math.pow(player.x - ai.x, 2) + Math.pow(player.y - ai.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearestEnemy = player;
      }
    });
    if (nearestEnemy && minDist > PIECE_RADIUS * 2) {
      const dx = nearestEnemy.x - ai.x;
      const dy = nearestEnemy.y - ai.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pieceSpeed = speed * (ai.type === 'cavalry' ? 1.3 : 1) * aiBonus;
      ai.x += (dx / len) * pieceSpeed;
      ai.y += (dy / len) * pieceSpeed;
      ai.status = 'moving';
    }
  });

  return updatedPieces;
}

export function isSimulationComplete(pieces: Piece[]): boolean {
  const alivePlayers = pieces.filter(
    (p) => p.side === 'player' && p.status === 'alive'
  );
  const aliveAis = pieces.filter(
    (p) => p.side === 'ai' && p.status === 'alive'
  );
  return alivePlayers.length === 0 || aliveAis.length === 0;
}

export function getSimulationResult(
  pieces: Piece[],
  playerFormation: FormationType,
  aiFormation: FormationType
): SimulationResult {
  const alivePlayers = pieces.filter(
    (p) => p.side === 'player' && p.status === 'alive'
  );
  const aliveAis = pieces.filter(
    (p) => p.side === 'ai' && p.status === 'alive'
  );

  let winner: 'player' | 'ai' | 'draw';
  if (alivePlayers.length > aliveAis.length) {
    winner = 'player';
  } else if (aliveAis.length > alivePlayers.length) {
    winner = 'ai';
  } else {
    winner = 'draw';
  }

  return {
    winner,
    playerRemaining: alivePlayers.length,
    aiRemaining: aliveAis.length,
    playerFormation,
    aiFormation,
    timestamp: Date.now(),
    snapshot: JSON.parse(JSON.stringify(pieces)),
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
