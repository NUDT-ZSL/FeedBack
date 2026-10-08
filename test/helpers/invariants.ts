import assert from 'node:assert/strict';
import {
  BOARD_CAPACITY,
  validateState,
  type CompositionState
} from '../../src/state/composition.ts';

export function assertConsistent(
  state: CompositionState,
  expectedTotal?: number
): void {
  const violations =
    expectedTotal === undefined
      ? validateState(state)
      : validateState(state, expectedTotal);
  assert.deepEqual(violations, [], `状态一致性校验失败:\n${violations.join('\n')}`);
}

export function occupancyOf(state: CompositionState): Map<number, string> {
  const map = new Map<number, string>();
  state.board.forEach((cell, index) => {
    if (cell !== null) {
      map.set(index, cell.id);
    }
  });
  return map;
}

export function placedCountOf(state: CompositionState): number {
  return state.board.reduce(
    (count, cell) => (cell === null ? count : count + 1),
    0
  );
}

export function ownerOf(
  state: CompositionState,
  charId: string
): 'rack' | 'board' | 'none' | 'both' {
  const inRack = state.rack.some((item) => item.id === charId);
  const onBoard = state.board.some((cell) => cell?.id === charId);
  if (inRack && onBoard) return 'both';
  if (inRack) return 'rack';
  if (onBoard) return 'board';
  return 'none';
}

export function emptyPositionsOf(state: CompositionState): number[] {
  const positions: number[] = [];
  state.board.forEach((cell, index) => {
    if (cell === null) positions.push(index);
  });
  return positions;
}

export function occupiedPositionsOf(state: CompositionState): number[] {
  const positions: number[] = [];
  state.board.forEach((cell, index) => {
    if (cell !== null) positions.push(index);
  });
  return positions;
}

export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export { BOARD_CAPACITY };
