import {
  COMMON_CHARACTERS,
  INK_COLORS,
  FONT_SIZES,
  GRID_COLS,
  GRID_ROWS
} from '../data/characters.ts';
import type { InkColor, FontSizeOption, TypeCharacter } from '../types/index.ts';

export const GRID_CAPACITY = GRID_COLS * GRID_ROWS;

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface PlacedCharView {
  id: string;
  char: string;
  position: number;
  inkColor: string;
  inkName: string;
  fontSize: number;
}

export interface ExportedCell {
  id: string;
  char: string;
  position: number;
  inkColor: string;
  fontSize: number;
}

export interface ExportRecord {
  sequence: number;
  exportedAt: number;
  inkColor: InkColor;
  fontSize: FontSizeOption;
  cells: ExportedCell[];
}

const FAIL_REASONS = {
  CHARACTER_NOT_ON_RACK: 'character-not-on-rack',
  CHARACTER_ALREADY_PLACED: 'character-already-placed',
  ALREADY_HOLDING: 'already-holding',
  NOT_HOLDING: 'not-holding',
  CELL_OUT_OF_RANGE: 'cell-out-of-range',
  CELL_EMPTY: 'cell-empty',
  CELL_OCCUPIED: 'cell-occupied',
  GRID_FULL: 'grid-full',
  UNKNOWN_INK: 'unknown-ink',
  UNKNOWN_FONT_SIZE: 'unknown-font-size'
} as const;

export class PrintingStudio {
  readonly rack: TypeCharacter[] = [];
  held: TypeCharacter | null = null;
  readonly grid: (TypeCharacter | null)[] = new Array(GRID_CAPACITY).fill(null);
  inkColor: InkColor = INK_COLORS[0];
  fontSize: FontSizeOption = FONT_SIZES[1];
  readonly exportHistory: ExportRecord[] = [];

  private readonly initialIds: string[] = [];

  constructor(characters: readonly string[] = COMMON_CHARACTERS, now: () => number = Date.now) {
    this.now = now;
    characters.forEach((char, index) => {
      const character: TypeCharacter = { id: `type-${index + 1}`, char };
      this.rack.push(character);
      this.initialIds.push(character.id);
    });
  }

  private readonly now: () => number;

  get placedCount(): number {
    return this.grid.reduce<number>((count, cell) => (cell ? count + 1 : count), 0);
  }

  get isGridFull(): boolean {
    return this.placedCount === GRID_CAPACITY;
  }

  get lastExport(): ExportRecord | null {
    return this.exportHistory.length > 0 ? this.exportHistory[this.exportHistory.length - 1] : null;
  }

  locationOf(charId: string): { where: 'rack'; index: number } | { where: 'held' } | { where: 'grid'; position: number } | null {
    const rackIndex = this.rack.findIndex((item) => item.id === charId);
    if (rackIndex >= 0) return { where: 'rack', index: rackIndex };
    if (this.held?.id === charId) return { where: 'held' };
    const position = this.grid.findIndex((cell) => cell?.id === charId);
    if (position >= 0) return { where: 'grid', position };
    return null;
  }

  takeFromRack(charId: string): ActionResult {
    if (this.held) return { ok: false, reason: FAIL_REASONS.ALREADY_HOLDING };
    const rackIndex = this.rack.findIndex((item) => item.id === charId);
    if (rackIndex < 0) {
      if (this.locationOf(charId)) return { ok: false, reason: FAIL_REASONS.CHARACTER_ALREADY_PLACED };
      return { ok: false, reason: FAIL_REASONS.CHARACTER_NOT_ON_RACK };
    }
    this.held = this.rack.splice(rackIndex, 1)[0];
    return { ok: true };
  }

  returnHeldToRack(): ActionResult {
    if (!this.held) return { ok: false, reason: FAIL_REASONS.NOT_HOLDING };
    this.rack.push(this.held);
    this.held = null;
    return { ok: true };
  }

  placeOnGrid(cellIndex: number): ActionResult {
    if (!this.held) return { ok: false, reason: FAIL_REASONS.NOT_HOLDING };
    if (cellIndex < 0 || cellIndex >= GRID_CAPACITY) {
      return { ok: false, reason: FAIL_REASONS.CELL_OUT_OF_RANGE };
    }
    if (this.isGridFull) return { ok: false, reason: FAIL_REASONS.GRID_FULL };
    if (this.grid[cellIndex]) return { ok: false, reason: FAIL_REASONS.CELL_OCCUPIED };
    const character = this.held;
    character.position = cellIndex;
    this.grid[cellIndex] = character;
    this.held = null;
    return { ok: true };
  }

  moveOnGrid(from: number, to: number): ActionResult {
    if (from < 0 || from >= GRID_CAPACITY || to < 0 || to >= GRID_CAPACITY) {
      return { ok: false, reason: FAIL_REASONS.CELL_OUT_OF_RANGE };
    }
    if (from === to) return { ok: true };
    if (!this.grid[from]) return { ok: false, reason: FAIL_REASONS.CELL_EMPTY };
    const moving = this.grid[from] as TypeCharacter;
    const target = this.grid[to];
    this.grid[from] = target;
    this.grid[to] = moving;
    moving.position = to;
    if (target) target.position = from;
    return { ok: true };
  }

  returnToRack(position: number): ActionResult {
    if (position < 0 || position >= GRID_CAPACITY) {
      return { ok: false, reason: FAIL_REASONS.CELL_OUT_OF_RANGE };
    }
    const character = this.grid[position];
    if (!character) return { ok: false, reason: FAIL_REASONS.CELL_EMPTY };
    character.position = undefined;
    this.grid[position] = null;
    this.rack.push(character);
    return { ok: true };
  }

  setInkColor(name: string): ActionResult {
    const found = INK_COLORS.find((item) => item.name === name);
    if (!found) return { ok: false, reason: FAIL_REASONS.UNKNOWN_INK };
    this.inkColor = found;
    return { ok: true };
  }

  setFontSize(name: string): ActionResult {
    const found = FONT_SIZES.find((item) => item.name === name);
    if (!found) return { ok: false, reason: FAIL_REASONS.UNKNOWN_FONT_SIZE };
    this.fontSize = found;
    return { ok: true };
  }

  getPlacedView(): PlacedCharView[] {
    return this.grid.flatMap((cell, position) =>
      cell
        ? [
            {
              id: cell.id,
              char: cell.char,
              position,
              inkColor: this.inkColor.value,
              inkName: this.inkColor.name,
              fontSize: this.fontSize.value
            }
          ]
        : []
    );
  }

  exportComposition(): ExportRecord {
    const record: ExportRecord = {
      sequence: this.exportHistory.length + 1,
      exportedAt: this.now(),
      inkColor: { ...this.inkColor },
      fontSize: { ...this.fontSize },
      cells: this.getPlacedView().map((view) => ({
        id: view.id,
        char: view.char,
        position: view.position,
        inkColor: view.inkColor,
        fontSize: view.fontSize
      }))
    };
    this.exportHistory.push(record);
    return record;
  }

  clearComposition(): ActionResult {
    for (let position = 0; position < GRID_CAPACITY; position += 1) {
      const character = this.grid[position];
      if (character) {
        character.position = undefined;
        this.grid[position] = null;
        this.rack.push(character);
      }
    }
    if (this.held) {
      this.rack.push(this.held);
      this.held = null;
    }
    return { ok: true };
  }

  checkInvariants(): string[] {
    const violations: string[] = [];
    const seen = new Map<string, { where: string; index: number }>();
    const remember = (id: string, where: string, index: number): void => {
      const previous = seen.get(id);
      if (previous) {
        violations.push(
          `字符实例 ${id} 归属不唯一：同时出现在 ${previous.where}#${previous.index} 与 ${where}#${index}`
        );
      } else {
        seen.set(id, { where, index });
      }
    };
    this.rack.forEach((item, index) => remember(item.id, 'rack', index));
    if (this.held) remember(this.held.id, 'held', 0);
    this.grid.forEach((cell, position) => {
      if (cell) {
        remember(cell.id, 'grid', position);
        if (cell.position !== position) {
          violations.push(`版盘 ${position} 位字模 position=${cell.position}，与占用格位不一致`);
        }
      }
    });
    const occupied = this.grid.filter(Boolean).length;
    if (this.placedCount !== occupied) violations.push('placedCount 与实际占用格位数不一致');
    if (seen.size !== this.initialIds.length) {
      violations.push(`字模总数异常：当前 ${seen.size}，初始 ${this.initialIds.length}`);
    }
    for (const id of this.initialIds) {
      if (!seen.has(id)) violations.push(`字模 ${id} 从字架/持字/版盘中丢失`);
    }
    return violations;
  }
}

export { FAIL_REASONS };
