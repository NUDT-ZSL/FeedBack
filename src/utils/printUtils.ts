import type { PlacedCharacter } from '../types';
import { mulberry32, type Rng } from './random';

export const GRID_ROWS = 15;
export const GRID_COLS = 30;
export const CELL_SIZE = 20;
export const CANVAS_PADDING = 40;
export const FONT_SIZE = 24;
export const LINE_HEIGHT = 36;

/** 压力超过该阈值时印刷清晰但可能产生版心偏移 */
export const HIGH_PRESSURE_THRESHOLD = 80;
/** 压力低于该阈值时文字模糊并出现重影 */
export const LOW_PRESSURE_THRESHOLD = 30;
/** 墨量低于该阈值时印刷结果会出现断墨白点 */
export const LOW_INK_THRESHOLD = 20;
/** 版心偏移的最大幅度（px），约定范围 [-3, 3] */
export const MAX_PLATE_OFFSET = 3;
/** 墨量过低时单个活字出现断墨白点的概率 */
export const WHITE_SPOT_PROBABILITY = 0.3;
/** 压力过低时重影副本的偏移量（px） */
export const GHOST_OFFSET = 0.5;

/**
 * 计算版心偏移。压力超过阈值时产生落在 [-MAX_PLATE_OFFSET, MAX_PLATE_OFFSET]
 * 内的随机偏移。传入 rng 可复现；缺省时以压力值为种子，保证同一压力重复
 * 计算结果稳定一致。
 */
export function calculatePlateOffset(pressure: number, rng: Rng = mulberry32(pressure)): { x: number; y: number } {
  if (pressure > HIGH_PRESSURE_THRESHOLD) {
    const offsetX = (rng() - 0.5) * MAX_PLATE_OFFSET * 2;
    const offsetY = (rng() - 0.5) * MAX_PLATE_OFFSET * 2;
    return { x: Math.round(offsetX * 10) / 10, y: Math.round(offsetY * 10) / 10 };
  }
  return { x: 0, y: 0 };
}

/**
 * 计算墨色均匀度（0-100）。传入 rng 可复现；缺省时以墨量为种子，
 * 保证同一墨量重复计算结果稳定一致。
 */
export function calculateInkUniformity(inkLevel: number, rng: Rng = mulberry32(inkLevel)): number {
  const baseUniformity = Math.min(100, Math.max(20, inkLevel));
  const variance = rng() * 15;
  return Math.round(Math.min(100, Math.max(0, baseUniformity - variance)));
}

export function calculateCharacterSpacing(
  char: PlacedCharacter,
  allChars: PlacedCharacter[]
): { right: number; bottom: number } {
  const rightNeighbor = allChars.find(
    c => c.row === char.row && c.col === char.col + 1
  );
  const bottomNeighbor = allChars.find(
    c => c.row === char.row + 1 && c.col === char.col
  );
  
  const cellSizeMm = 6.67;
  
  return {
    right: rightNeighbor ? 0 : cellSizeMm,
    bottom: bottomNeighbor ? 0 : cellSizeMm
  };
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 判断单个活字是否出现断墨白点。墨量低于阈值时以 WHITE_SPOT_PROBABILITY
 * 的概率出现。传入 rng 可复现；缺省时以墨量为种子，保证结果稳定。
 */
export function hasWhiteSpot(inkLevel: number, rng: Rng = mulberry32(inkLevel)): boolean {
  if (inkLevel < LOW_INK_THRESHOLD) {
    return rng() < WHITE_SPOT_PROBABILITY;
  }
  return false;
}

/** 文字透明度：随压力与墨量上升而提高，结果钳制在 [0.2, 1]。 */
export function getTextOpacity(pressure: number, inkLevel: number): number {
  const pressureFactor = pressure < LOW_PRESSURE_THRESHOLD
    ? 0.3 + (pressure / LOW_PRESSURE_THRESHOLD) * 0.4
    : 0.7 + ((pressure - LOW_PRESSURE_THRESHOLD) / 70) * 0.3;
  const inkFactor = inkLevel / 100;
  return Math.min(1, Math.max(0.2, pressureFactor * inkFactor));
}
