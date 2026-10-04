import type { PlacedCharacter } from '../types';
import type { Rng } from './random';

export const GRID_ROWS = 15;
export const GRID_COLS = 30;
export const CELL_SIZE = 20;
export const CANVAS_PADDING = 40;
export const FONT_SIZE = 24;
export const LINE_HEIGHT = 36;

export function calculatePlateOffset(
  pressure: number,
  rng: Rng = Math.random
): { x: number; y: number } {
  if (pressure > 80) {
    const offsetX = (rng() - 0.5) * 6;
    const offsetY = (rng() - 0.5) * 6;
    return { x: Math.round(offsetX * 10) / 10, y: Math.round(offsetY * 10) / 10 };
  }
  return { x: 0, y: 0 };
}

export function calculateInkUniformity(inkLevel: number, rng: Rng = Math.random): number {
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

export function hasWhiteSpot(inkLevel: number, rng: Rng = Math.random): boolean {
  if (inkLevel < 20) {
    return rng() < 0.3;
  }
  return false;
}

export function getTextOpacity(pressure: number, inkLevel: number): number {
  const pressureFactor = pressure < 30 ? 0.3 + (pressure / 30) * 0.4 : 0.7 + ((pressure - 30) / 70) * 0.3;
  const inkFactor = inkLevel / 100;
  return Math.min(1, Math.max(0.2, pressureFactor * inkFactor));
}
