import type { BlockData, PlayerData } from './NetworkManager';

export type { BlockData, PlayerData };

export const LOG_SOURCE_SERVER = 'server';
export const LOG_SOURCE_MOCK = 'mock-server';
export const LOG_SOURCE_LOCAL = 'local';

export type OperationType =
  | 'world_state'
  | 'block_place'
  | 'block_break'
  | 'player_join'
  | 'player_leave'
  | 'player_move';

export type Operation =
  | { seq: number; source: string; type: 'world_state'; blocks: BlockData[]; players: PlayerData[] }
  | { seq: number; source: string; type: 'block_place'; x: number; y: number; color: string }
  | { seq: number; source: string; type: 'block_break'; x: number; y: number }
  | { seq: number; source: string; type: 'player_join'; player: PlayerData }
  | { seq: number; source: string; type: 'player_leave'; playerId: string }
  | { seq: number; source: string; type: 'player_move'; playerId: string; x: number; y: number };

export type OperationInput =
  | { source: string; type: 'world_state'; blocks: BlockData[]; players: PlayerData[] }
  | { source: string; type: 'block_place'; x: number; y: number; color: string }
  | { source: string; type: 'block_break'; x: number; y: number }
  | { source: string; type: 'player_join'; player: PlayerData }
  | { source: string; type: 'player_leave'; playerId: string }
  | { source: string; type: 'player_move'; playerId: string; x: number; y: number };

export interface TrackedBlock extends BlockData {
  source: string;
}

export interface TrackedPlayer extends PlayerData {
  source: string;
}

export interface WorldSnapshot {
  blocks: Record<string, TrackedBlock>;
  players: Record<string, TrackedPlayer>;
}

export interface MissingRange {
  from: number;
  to: number;
}

export interface ReplayResult {
  snapshot: WorldSnapshot;
  appliedSeqs: number[];
  duplicateSeqs: number[];
  missingRanges: MissingRange[];
}

export function blockKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function createEmptySnapshot(): WorldSnapshot {
  return { blocks: {}, players: {} };
}

export function cloneOperation(op: Operation): Operation {
  switch (op.type) {
    case 'world_state':
      return {
        ...op,
        blocks: op.blocks.map(block => ({ ...block })),
        players: op.players.map(player => ({ ...player }))
      };
    case 'player_join':
      return { ...op, player: { ...op.player } };
    default:
      return { ...op };
  }
}

export function cloneSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  const blocks: Record<string, TrackedBlock> = {};
  for (const key of Object.keys(snapshot.blocks)) {
    blocks[key] = { ...snapshot.blocks[key] };
  }
  const players: Record<string, TrackedPlayer> = {};
  for (const id of Object.keys(snapshot.players)) {
    players[id] = { ...snapshot.players[id] };
  }
  return { blocks, players };
}

export function applyOperationToSnapshot(snapshot: WorldSnapshot, op: Operation): void {
  switch (op.type) {
    case 'world_state': {
      snapshot.blocks = {};
      snapshot.players = {};
      for (const block of op.blocks) {
        snapshot.blocks[blockKey(block.x, block.y)] = { ...block, source: op.source };
      }
      for (const player of op.players) {
        snapshot.players[player.id] = { ...player, source: op.source };
      }
      break;
    }
    case 'block_place': {
      const key = blockKey(op.x, op.y);
      const existing = snapshot.blocks[key];
      snapshot.blocks[key] = {
        x: op.x,
        y: op.y,
        color: op.color,
        isIndestructible: existing ? existing.isIndestructible : false,
        source: op.source
      };
      break;
    }
    case 'block_break': {
      const key = blockKey(op.x, op.y);
      const existing = snapshot.blocks[key];
      if (existing && existing.isIndestructible) break;
      delete snapshot.blocks[key];
      break;
    }
    case 'player_join': {
      snapshot.players[op.player.id] = { ...op.player, source: op.source };
      break;
    }
    case 'player_leave': {
      delete snapshot.players[op.playerId];
      break;
    }
    case 'player_move': {
      const player = snapshot.players[op.playerId];
      if (!player) break;
      player.x = op.x;
      player.y = op.y;
      player.source = op.source;
      break;
    }
  }
}

export function computeMissingRanges(appliedSeqs: readonly number[]): MissingRange[] {
  if (appliedSeqs.length === 0) return [];
  const applied = new Set(appliedSeqs);
  const sorted = [...applied].sort((a, b) => a - b);
  const ranges: MissingRange[] = [];
  let gapStart = -1;
  for (let seq = sorted[0]; seq <= sorted[sorted.length - 1]; seq++) {
    if (!applied.has(seq)) {
      if (gapStart === -1) gapStart = seq;
    } else if (gapStart !== -1) {
      ranges.push({ from: gapStart, to: seq - 1 });
      gapStart = -1;
    }
  }
  return ranges;
}

export function replayOperations(
  operations: readonly Operation[],
  baseSnapshot?: WorldSnapshot
): ReplayResult {
  const snapshot = baseSnapshot ? cloneSnapshot(baseSnapshot) : createEmptySnapshot();
  const appliedSeqs: number[] = [];
  const duplicateSeqs: number[] = [];
  const applied = new Set<number>();

  for (const op of operations) {
    if (applied.has(op.seq)) {
      duplicateSeqs.push(op.seq);
      continue;
    }
    applied.add(op.seq);
    appliedSeqs.push(op.seq);
    applyOperationToSnapshot(snapshot, op);
  }

  return {
    snapshot,
    appliedSeqs,
    duplicateSeqs,
    missingRanges: computeMissingRanges(appliedSeqs)
  };
}
