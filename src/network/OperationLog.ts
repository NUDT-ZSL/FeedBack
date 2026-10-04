import { BlockData, PlayerData } from './NetworkManager';

export type OperationType =
  | 'world_state'
  | 'block_place'
  | 'block_break'
  | 'player_join'
  | 'player_leave'
  | 'player_move';

interface OperationBase {
  seq: number;
  source: string;
}

export interface WorldStateOperation extends OperationBase {
  type: 'world_state';
  blocks: BlockData[];
  players: PlayerData[];
}

export interface BlockPlaceOperation extends OperationBase {
  type: 'block_place';
  x: number;
  y: number;
  color: string;
}

export interface BlockBreakOperation extends OperationBase {
  type: 'block_break';
  x: number;
  y: number;
}

export interface PlayerJoinOperation extends OperationBase {
  type: 'player_join';
  player: PlayerData;
}

export interface PlayerLeaveOperation extends OperationBase {
  type: 'player_leave';
  playerId: string;
}

export interface PlayerMoveOperation extends OperationBase {
  type: 'player_move';
  playerId: string;
  x: number;
  y: number;
}

export type Operation =
  | WorldStateOperation
  | BlockPlaceOperation
  | BlockBreakOperation
  | PlayerJoinOperation
  | PlayerLeaveOperation
  | PlayerMoveOperation;

export interface SnapshotBlock extends BlockData {
  source: string;
}

export interface SnapshotPlayer extends PlayerData {
  source: string;
}

export interface WorldSnapshot {
  blocks: SnapshotBlock[];
  players: SnapshotPlayer[];
}

export interface MissingRange {
  from: number;
  to: number;
}

export interface ReplayResult {
  snapshot: WorldSnapshot;
  appliedSeqs: number[];
  skippedDuplicates: number[];
  missingRanges: MissingRange[];
  lastSeq: number;
}

export interface ReplayOptions {
  base?: WorldSnapshot;
  baseSeq?: number;
}

export interface MutableWorldState {
  blocks: Map<string, SnapshotBlock>;
  players: Map<string, SnapshotPlayer>;
}

export function blockKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function createEmptyState(): MutableWorldState {
  return { blocks: new Map(), players: new Map() };
}

export function applyOperation(state: MutableWorldState, op: Operation): void {
  switch (op.type) {
    case 'world_state': {
      state.blocks.clear();
      state.players.clear();
      for (const block of op.blocks) {
        state.blocks.set(blockKey(block.x, block.y), { ...block, source: op.source });
      }
      for (const player of op.players) {
        state.players.set(player.id, { ...player, source: op.source });
      }
      break;
    }
    case 'block_place': {
      state.blocks.set(blockKey(op.x, op.y), {
        x: op.x,
        y: op.y,
        color: op.color,
        isIndestructible: false,
        source: op.source
      });
      break;
    }
    case 'block_break': {
      state.blocks.delete(blockKey(op.x, op.y));
      break;
    }
    case 'player_join': {
      state.players.set(op.player.id, { ...op.player, source: op.source });
      break;
    }
    case 'player_leave': {
      state.players.delete(op.playerId);
      break;
    }
    case 'player_move': {
      const player = state.players.get(op.playerId);
      if (player) {
        player.x = op.x;
        player.y = op.y;
        player.source = op.source;
      }
      break;
    }
  }
}

export function stateToSnapshot(state: MutableWorldState): WorldSnapshot {
  const blocks = Array.from(state.blocks.values())
    .map(block => ({ ...block }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const players = Array.from(state.players.values())
    .map(player => ({ ...player }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { blocks, players };
}

export function replayOperations(ops: Operation[], options: ReplayOptions = {}): ReplayResult {
  const state = createEmptyState();
  if (options.base) {
    for (const block of options.base.blocks) {
      state.blocks.set(blockKey(block.x, block.y), { ...block });
    }
    for (const player of options.base.players) {
      state.players.set(player.id, { ...player });
    }
  }

  const sorted = [...ops].sort((a, b) => a.seq - b.seq);
  const appliedSeqs: number[] = [];
  const skippedDuplicates: number[] = [];
  const missingRanges: MissingRange[] = [];
  const seen = new Set<number>();
  let expectedSeq = options.baseSeq !== undefined ? options.baseSeq + 1 : 1;

  for (const op of sorted) {
    if (seen.has(op.seq) || op.seq < expectedSeq) {
      skippedDuplicates.push(op.seq);
      continue;
    }
    if (op.seq > expectedSeq) {
      missingRanges.push({ from: expectedSeq, to: op.seq - 1 });
    }
    applyOperation(state, op);
    seen.add(op.seq);
    appliedSeqs.push(op.seq);
    expectedSeq = op.seq + 1;
  }

  return {
    snapshot: stateToSnapshot(state),
    appliedSeqs,
    skippedDuplicates,
    missingRanges,
    lastSeq: appliedSeqs.length > 0 ? appliedSeqs[appliedSeqs.length - 1] : (options.baseSeq ?? 0)
  };
}
