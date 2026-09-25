import type { PixelData } from './pixel-canvas.ts';

export interface CanvasSnapshot {
  size: number;
  pixels: PixelData;
}

const MAX_HISTORY = 30;
const DEFAULT_COLOR = '#ffffff';

function clonePixels(data: PixelData): PixelData {
  const result: PixelData = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = [...data[i]];
  }
  return result;
}

function blankPixels(size: number): PixelData {
  const rows: PixelData = new Array(size);
  for (let y = 0; y < size; y++) {
    const row: string[] = new Array(size);
    for (let x = 0; x < size; x++) {
      row[x] = DEFAULT_COLOR;
    }
    rows[y] = row;
  }
  return rows;
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

type StoreListener = (snapshot: CanvasSnapshot) => void;

/**
 * 画布状态单一数据源：尺寸、已提交像素、撤销/重做历史都收敛在这里。
 * 画布组件只负责渲染与采集输入，提交（一笔结束）、撤销、重做、
 * 切换尺寸、导出全部读写本 store，保证三者一致。
 */
export class EditorStore {
  private size: number;
  private committed: PixelData;
  private undoStack: CanvasSnapshot[] = [];
  private redoStack: CanvasSnapshot[] = [];
  private listeners: Set<StoreListener> = new Set();

  constructor(initialSize: number) {
    this.size = initialSize;
    this.committed = blankPixels(initialSize);
  }

  public getSize(): number {
    return this.size;
  }

  public getSnapshot(): CanvasSnapshot {
    return { size: this.size, pixels: clonePixels(this.committed) };
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 提交一笔已完成的像素数据。与当前已提交状态相同、或尺寸与当前
   * 画布不一致（例如切换尺寸过程中残留的过期事件）时直接忽略，
   * 返回是否真正产生了新的历史记录。
   */
  public commit(pixels: PixelData): boolean {
    if (pixels.length !== this.size) return false;
    if (pixelsEqual(pixels, this.committed)) return false;
    this.undoStack.push({ size: this.size, pixels: this.committed });
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.committed = clonePixels(pixels);
    this.redoStack = [];
    this.notify();
    return true;
  }

  public undo(): CanvasSnapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push({ size: this.size, pixels: this.committed });
    this.size = prev.size;
    this.committed = prev.pixels;
    this.notify();
    return this.getSnapshot();
  }

  public redo(): CanvasSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push({ size: this.size, pixels: this.committed });
    this.size = next.size;
    this.committed = next.pixels;
    this.notify();
    return this.getSnapshot();
  }

  /**
   * 切换画布尺寸：历史重置为仅含新尺寸的初始快照，
   * 不残留旧尺寸记录，撤销/重做均回到不可用态。
   */
  public resize(newSize: number): void {
    this.size = newSize;
    this.committed = blankPixels(newSize);
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
