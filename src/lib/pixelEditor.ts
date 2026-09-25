export const EMPTY_PIXEL = "";

export interface Snapshot {
  width: number;
  height: number;
  pixels: string[];
}

export interface PixelEditor {
  getState(): Snapshot;
  setPixel(x: number, y: number, color: string): void;
  resize(width: number, height: number): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  exportPixels(): Snapshot;
}

function createBlank(width: number, height: number): string[] {
  return new Array<string>(width * height).fill(EMPTY_PIXEL);
}

function copySnapshot(state: Snapshot): Snapshot {
  return { width: state.width, height: state.height, pixels: [...state.pixels] };
}

export function createPixelEditor(width: number, height: number): PixelEditor {
  let state: Snapshot = { width, height, pixels: createBlank(width, height) };
  const undoStack: Snapshot[] = [];
  const redoStack: Snapshot[] = [];

  function pushHistory(): void {
    undoStack.push(copySnapshot(state));
    redoStack.length = 0;
  }

  return {
    getState(): Snapshot {
      return state;
    },

    setPixel(x: number, y: number, color: string): void {
      if (x < 0 || y < 0 || x >= state.width || y >= state.height) {
        throw new RangeError(`pixel out of bounds: (${x}, ${y})`);
      }
      pushHistory();
      state.pixels[y * state.width + x] = color;
    },

    resize(nextWidth: number, nextHeight: number): void {
      pushHistory();
      const next = createBlank(nextWidth, nextHeight);
      const copyWidth = Math.min(state.width, nextWidth);
      const copyHeight = Math.min(state.height, nextHeight);
      for (let y = 0; y < copyHeight; y += 1) {
        for (let x = 0; x < copyWidth; x += 1) {
          next[y * nextWidth + x] = state.pixels[y * state.width + x];
        }
      }
      state = { width: nextWidth, height: nextHeight, pixels: next };
    },

    undo(): boolean {
      const prev = undoStack.pop();
      if (!prev) return false;
      redoStack.push(copySnapshot(state));
      state = prev;
      return true;
    },

    redo(): boolean {
      const next = redoStack.pop();
      if (!next) return false;
      undoStack.push(copySnapshot(state));
      state = next;
      return true;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    exportPixels(): Snapshot {
      return copySnapshot(state);
    },
  };
}
