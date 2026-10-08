import {
  COMMON_CHARACTERS,
  FONT_SIZES,
  GRID_COLS,
  GRID_ROWS,
  INK_COLORS
} from '../data/characters.ts';
import type { FontSizeOption, InkColor, TypeCharacter } from '../types/index.ts';

export const BOARD_COLS = GRID_COLS;
export const BOARD_ROWS = GRID_ROWS;
export const BOARD_CAPACITY = BOARD_COLS * BOARD_ROWS;
export const INK_MIX_MIN = 0;
export const INK_MIX_MAX = 100;

export type ErrorCode =
  | 'CELL_OCCUPIED'
  | 'CELL_OUT_OF_RANGE'
  | 'CHAR_NOT_IN_RACK'
  | 'CHAR_NOT_ON_BOARD'
  | 'BOARD_FULL'
  | 'INVALID_INK_COLOR'
  | 'INVALID_FONT_SIZE'
  | 'INVALID_INK_MIX';

export class CompositionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'CompositionError';
    this.code = code;
  }
}

export interface PlacedType extends TypeCharacter {
  id: string;
  char: string;
  position: number;
}

export interface CompositionState {
  rack: TypeCharacter[];
  board: (PlacedType | null)[];
  inkColor: InkColor;
  fontSize: FontSizeOption;
  inkMix: number;
}

export interface ExportSnapshot {
  cells: (string | null)[];
  placedCount: number;
  inkColor: string;
  inkColorName: string;
  inkMix: number;
  fontSize: number;
  fontSizeName: string;
}

export interface CreateStateOptions {
  chars?: string[];
  createId?: (char: string, index: number) => string;
  inkColor?: InkColor;
  fontSize?: FontSizeOption;
  inkMix?: number;
}

const defaultCreateId = (char: string, index: number): string => `type-${index}-${char}`;

export function createInitialState(options: CreateStateOptions = {}): CompositionState {
  const chars = options.chars ?? COMMON_CHARACTERS;
  const createId = options.createId ?? defaultCreateId;
  const inkColor = options.inkColor ?? INK_COLORS[0];
  const fontSize = options.fontSize ?? FONT_SIZES[1];
  const inkMix = options.inkMix ?? INK_MIX_MAX;

  if (!INK_COLORS.some((item) => item.value === inkColor.value)) {
    throw new CompositionError('INVALID_INK_COLOR', `未知墨色: ${inkColor.value}`);
  }
  if (!FONT_SIZES.some((item) => item.value === fontSize.value)) {
    throw new CompositionError('INVALID_FONT_SIZE', `未知字号: ${fontSize.value}`);
  }
  if (!Number.isInteger(inkMix) || inkMix < INK_MIX_MIN || inkMix > INK_MIX_MAX) {
    throw new CompositionError('INVALID_INK_MIX', `墨色混合值越界: ${inkMix}`);
  }

  return {
    rack: chars.map((char, index) => ({ id: createId(char, index), char })),
    board: Array.from({ length: BOARD_CAPACITY }, () => null),
    inkColor: { ...inkColor },
    fontSize: { ...fontSize },
    inkMix
  };
}

function assertPositionInRange(position: number): void {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position >= BOARD_CAPACITY
  ) {
    throw new CompositionError(
      'CELL_OUT_OF_RANGE',
      `单元格位置越界: ${String(position)}（有效范围 0-${BOARD_CAPACITY - 1}）`
    );
  }
}

export function placeFromRack(
  state: CompositionState,
  charId: string,
  position: number
): CompositionState {
  assertPositionInRange(position);

  if (state.board[position] !== null) {
    if (state.board.every((cell) => cell !== null)) {
      throw new CompositionError('BOARD_FULL', `版盘已满（${BOARD_CAPACITY} 格），无法继续落位`);
    }
    throw new CompositionError('CELL_OCCUPIED', `位置 ${position} 已被占用`);
  }

  const rackIndex = state.rack.findIndex((item) => item.id === charId);
  if (rackIndex === -1) {
    if (state.board.some((cell) => cell?.id === charId)) {
      throw new CompositionError('CHAR_NOT_IN_RACK', `字模 ${charId} 已在版盘上，不能重复落位`);
    }
    throw new CompositionError('CHAR_NOT_IN_RACK', `字架中不存在字模: ${charId}`);
  }

  const source = state.rack[rackIndex];
  const placed: PlacedType = { id: source.id, char: source.char, position };

  return {
    ...state,
    rack: state.rack.filter((item) => item.id !== charId),
    board: state.board.map((cell, index) => (index === position ? placed : cell))
  };
}

export function takeBack(state: CompositionState, charId: string): CompositionState {
  const placed = state.board.find((cell) => cell?.id === charId) ?? null;
  if (placed === null) {
    throw new CompositionError('CHAR_NOT_ON_BOARD', `版盘上不存在字模: ${charId}`);
  }

  const returned: TypeCharacter = { id: placed.id, char: placed.char };
  return {
    ...state,
    rack: [...state.rack, returned],
    board: state.board.map((cell) => (cell?.id === charId ? null : cell))
  };
}

export function movePlaced(
  state: CompositionState,
  fromPosition: number,
  toPosition: number
): CompositionState {
  assertPositionInRange(fromPosition);
  assertPositionInRange(toPosition);

  const moving = state.board[fromPosition];
  if (moving === null) {
    throw new CompositionError('CHAR_NOT_ON_BOARD', `位置 ${fromPosition} 无字模`);
  }
  if (fromPosition === toPosition) {
    return state;
  }

  const target = state.board[toPosition];
  const movingRelocated: PlacedType = { ...moving, position: toPosition };
  const targetRelocated: PlacedType | null =
    target === null ? null : { ...target, position: fromPosition };

  return {
    ...state,
    board: state.board.map((cell, index) => {
      if (index === fromPosition) return targetRelocated;
      if (index === toPosition) return movingRelocated;
      return cell;
    })
  };
}

export function clearBoard(state: CompositionState): CompositionState {
  const returned: TypeCharacter[] = state.board
    .filter((cell): cell is PlacedType => cell !== null)
    .map(({ id, char }) => ({ id, char }));

  if (returned.length === 0) {
    return state;
  }

  return {
    ...state,
    rack: [...state.rack, ...returned],
    board: Array.from({ length: BOARD_CAPACITY }, () => null)
  };
}

export function setInkColor(
  state: CompositionState,
  colorValue: string
): CompositionState {
  const inkColor = INK_COLORS.find((item) => item.value === colorValue);
  if (!inkColor) {
    throw new CompositionError('INVALID_INK_COLOR', `未知墨色: ${colorValue}`);
  }
  return { ...state, inkColor: { ...inkColor } };
}

export function setFontSize(
  state: CompositionState,
  sizeValue: number
): CompositionState {
  const fontSize = FONT_SIZES.find((item) => item.value === sizeValue);
  if (!fontSize) {
    throw new CompositionError('INVALID_FONT_SIZE', `未知字号: ${String(sizeValue)}`);
  }
  return { ...state, fontSize: { ...fontSize } };
}

export function setInkMix(state: CompositionState, inkMix: number): CompositionState {
  if (
    !Number.isInteger(inkMix) ||
    inkMix < INK_MIX_MIN ||
    inkMix > INK_MIX_MAX
  ) {
    throw new CompositionError('INVALID_INK_MIX', `墨色混合值越界: ${String(inkMix)}`);
  }
  return { ...state, inkMix };
}

export function exportSnapshot(state: CompositionState): ExportSnapshot {
  return {
    cells: state.board.map((cell) => (cell === null ? null : cell.char)),
    placedCount: state.board.reduce(
      (count, cell) => (cell === null ? count : count + 1),
      0
    ),
    inkColor: state.inkColor.value,
    inkColorName: state.inkColor.name,
    inkMix: state.inkMix,
    fontSize: state.fontSize.value,
    fontSizeName: state.fontSize.name
  };
}

export function validateState(
  state: CompositionState,
  expectedTotal: number = COMMON_CHARACTERS.length
): string[] {
  const violations: string[] = [];

  if (state.board.length !== BOARD_CAPACITY) {
    violations.push(`版盘长度异常: ${state.board.length}（应为 ${BOARD_CAPACITY}）`);
  }

  state.board.forEach((cell, index) => {
    if (cell !== null && cell.position !== index) {
      violations.push(
        `位置与占用不同步: 字模 ${cell.id} 记录位置 ${cell.position}，实际位于 ${index}`
      );
    }
  });

  const boardIds = state.board
    .filter((cell): cell is PlacedType => cell !== null)
    .map((cell) => cell.id);
  const boardIdSet = new Set(boardIds);
  if (boardIdSet.size !== boardIds.length) {
    violations.push(`版盘内存在重复字模: ${boardIds.join(', ')}`);
  }

  const rackIds = state.rack.map((item) => item.id);
  const rackIdSet = new Set(rackIds);
  if (rackIdSet.size !== rackIds.length) {
    violations.push(`字架内存在重复字模: ${rackIds.join(', ')}`);
  }

  for (const id of boardIds) {
    if (rackIdSet.has(id)) {
      violations.push(`字模 ${id} 同时出现在字架与版盘上，字符归属不唯一`);
    }
  }

  const total = rackIds.length + boardIds.length;
  if (total !== expectedTotal) {
    violations.push(
      `字模总数异常: ${total}（字架 ${rackIds.length} + 版盘 ${boardIds.length}，应为 ${expectedTotal}）`
    );
  }

  if (!INK_COLORS.some((item) => item.value === state.inkColor.value)) {
    violations.push(`当前墨色非法: ${state.inkColor.value}`);
  }
  if (!FONT_SIZES.some((item) => item.value === state.fontSize.value)) {
    violations.push(`当前字号非法: ${state.fontSize.value}`);
  }
  if (
    !Number.isInteger(state.inkMix) ||
    state.inkMix < INK_MIX_MIN ||
    state.inkMix > INK_MIX_MAX
  ) {
    violations.push(`墨色混合值非法: ${String(state.inkMix)}`);
  }

  return violations;
}
