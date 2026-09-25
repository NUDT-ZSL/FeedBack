export type PixelData = string[][];

export interface CanvasSnapshot {
  size: number;
  pixels: PixelData;
}

export type StoreChangeType = 'commit' | 'undo' | 'redo' | 'reset' | 'set';

export const DEFAULT_PIXEL_COLOR = '#ffffff';

const MAX_HISTORY = 30;

function createBlank(size: number): PixelData {
  const data: PixelData = new Array(size);
  for (let y = 0; y < size; y++) {
    const row: string[] = new Array(size);
    for (let x = 0; x < size; x++) {
      row[x] = DEFAULT_PIXEL_COLOR;
    }
    data[y] = row;
  }
  return data;
}

function clonePixels(data: PixelData): PixelData {
  const result: PixelData = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i].slice();
  }
  return result;
}

function pixelsEqual(a: PixelData, b: PixelData): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    const rowA = a[y];
    const rowB = b[y];
    if (rowA.length !== rowB.length) return false;
    for (let x = 0; x < rowA.length; x++) {
      if (rowA[x] !== rowB[x]) return false;
    }
  }
  return true;
}

/**
 * Single source of truth for canvas state and history.
 *
 * - committed: committed state; undo/redo/export only read or write this.
 * - draft: in-progress stroke state, used for display only; committed on endStroke.
 * - undo/redo stacks hold committed snapshots only; size changes reset history.
 */
export class CanvasStore {
  private size: number;
  private committed: PixelData;
  private draft: PixelData | null = null;
  private undoStack: CanvasSnapshot[] = [];
  private redoStack: CanvasSnapshot[] = [];
  private listeners: Set<(type: StoreChangeType) => void> = new Set();

  constructor(size: number = 32) {
    this.size = size;
    this.committed = createBlank(size);
  }

  public subscribe(listener: (type: StoreChangeType) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(type: StoreChangeType): void {
    this.listeners.forEach(listener => listener(type));
  }

  public getGridSize(): number {
    return this.size;
  }

  /** Deep copy of the committed state, for export and other external reads. */
  public getCommittedPixels(): PixelData {
    return clonePixels(this.committed);
  }

  /** Live render state (draft while drawing). Read-only reference; do not mutate. */
  public getDisplayPixels(): PixelData {
    return this.draft !== null ? this.draft : this.committed;
  }

  public isStrokeActive(): boolean {
    return this.draft !== null;
  }

  public beginStroke(): void {
    if (this.draft === null) {
      this.draft = clonePixels(this.committed);
    }
  }

  private mutateDraft(x: number, y: number, color: string): boolean {
    if (this.draft === null) return false;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
    if (this.draft[y][x] === color) return false;
    this.draft[y][x] = color;
    return true;
  }

  public applyPixel(x: number, y: number, color: string): boolean {
    return this.mutateDraft(x, y, color);
  }

  public erasePixel(x: number, y: number): boolean {
    return this.mutateDraft(x, y, DEFAULT_PIXEL_COLOR);
  }

  public floodFill(x: number, y: number, fillColor: string): Array<[number, number]> {
    const changed: Array<[number, number]> = [];
    if (this.draft === null) return changed;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return changed;
    const targetColor = this.draft[y][x];
    if (targetColor === fillColor) return changed;

    const stack: Array<[number, number]> = [[x, y]];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= this.size || cy < 0 || cy >= this.size) continue;
      if (this.draft[cy][cx] !== targetColor) continue;

      visited.add(key);
      this.draft[cy][cx] = fillColor;
      changed.push([cx, cy]);

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }

    return changed;
  }

  /** Commit the stroke: if the draft differs, push history and clear the redo stack. */
  public endStroke(): boolean {
    if (this.draft === null) return false;
    const changed = !pixelsEqual(this.draft, this.committed);
    if (changed) {
      this.pushUndo();
      this.committed = this.draft;
      this.redoStack = [];
    }
    this.draft = null;
    if (changed) {
      this.notify('commit');
    }
    return changed;
  }

  public cancelStroke(): void {
    this.draft = null;
  }

  /** Replace pixels externally: committed as a new history entry. */
  public setPixels(pixels: PixelData): void {
    this.draft = null;
    this.pushUndo();
    this.committed = clonePixels(pixels);
    this.size = pixels.length;
    this.redoStack = [];
    this.notify('set');
  }

  /** Reset the canvas (including size changes): history is cleared, keeping only the new initial snapshot. */
  public reset(size?: number): void {
    this.draft = null;
    if (size !== undefined) {
      this.size = size;
    }
    this.committed = createBlank(this.size);
    this.undoStack = [];
    this.redoStack = [];
    this.notify('reset');
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.draft = null;
    this.redoStack.push({ size: this.size, pixels: this.committed });
    const snapshot = this.undoStack.pop()!;
    this.size = snapshot.size;
    this.committed = snapshot.pixels;
    this.notify('undo');
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.draft = null;
    this.undoStack.push({ size: this.size, pixels: this.committed });
    const snapshot = this.redoStack.pop()!;
    this.size = snapshot.size;
    this.committed = snapshot.pixels;
    this.notify('redo');
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushUndo(): void {
    this.undoStack.push({ size: this.size, pixels: this.committed });
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
  }
}
