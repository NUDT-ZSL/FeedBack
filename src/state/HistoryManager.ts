export class HistoryManager<T> {
  private history: T[] = [];
  private currentIndex: number = -1;
  private maxSize: number;

  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }

  push(state: T): void {
    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(JSON.parse(JSON.stringify(state)));
    if (this.history.length > this.maxSize) {
      this.history.shift();
    } else {
      this.currentIndex++;
    }
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.currentIndex--;
    return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.currentIndex++;
    return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  getHistory(): T[] {
    return this.history.map(s => JSON.parse(JSON.stringify(s)));
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  jumpTo(index: number): T | null {
    if (index < 0 || index >= this.history.length) return null;
    this.currentIndex = index;
    return JSON.parse(JSON.stringify(this.history[index]));
  }

  getCurrent(): T | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.history.length) return null;
    return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
  }
}
