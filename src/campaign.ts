import type {
  HistoryItem,
  Piece,
  FormationType,
  SimulationResult,
} from './types';

export const HISTORY_LIMIT = 20;

export function buildHistoryItem(result: SimulationResult, id: string): HistoryItem {
  return {
    id,
    playerFormation: result.playerFormation,
    aiFormation: result.aiFormation,
    result:
      result.winner === 'player'
        ? 'win'
        : result.winner === 'ai'
        ? 'lose'
        : 'draw',
    remaining: result.playerRemaining,
    playerRemaining: result.playerRemaining,
    aiRemaining: result.aiRemaining,
    playerMoraleStart: result.playerMoraleStart,
    playerMoraleEnd: result.playerMoraleEnd,
    aiMoraleStart: result.aiMoraleStart,
    aiMoraleEnd: result.aiMoraleEnd,
    endReason: result.endReason,
    timestamp: result.timestamp,
    snapshot: JSON.parse(JSON.stringify(result.snapshot)) as Piece[],
  };
}

export function appendHistory(
  history: HistoryItem[],
  item: HistoryItem,
  limit: number = HISTORY_LIMIT
): HistoryItem[] {
  if (history[0]?.id === item.id) return history;
  return [item, ...history].slice(0, limit);
}

export interface RestoredState {
  pieces: Piece[];
  playerFormation: FormationType;
  aiFormation: FormationType;
  playerMorale: number;
  aiMorale: number;
  result: SimulationResult;
}

export function restoreHistoryState(item: HistoryItem): RestoredState {
  const pieces = JSON.parse(JSON.stringify(item.snapshot)) as Piece[];
  const winner =
    item.result === 'win' ? 'player' : item.result === 'lose' ? 'ai' : 'draw';
  const result: SimulationResult = {
    winner,
    playerRemaining: item.playerRemaining,
    aiRemaining: item.aiRemaining,
    playerFormation: item.playerFormation as FormationType,
    aiFormation: item.aiFormation as FormationType,
    playerMoraleStart: item.playerMoraleStart,
    playerMoraleEnd: item.playerMoraleEnd,
    aiMoraleStart: item.aiMoraleStart,
    aiMoraleEnd: item.aiMoraleEnd,
    endReason: item.endReason,
    timestamp: item.timestamp,
    snapshot: JSON.parse(JSON.stringify(pieces)),
  };
  return {
    pieces,
    playerFormation: item.playerFormation as FormationType,
    aiFormation: item.aiFormation as FormationType,
    playerMorale: item.playerMoraleEnd,
    aiMorale: item.aiMoraleEnd,
    result,
  };
}
