/**
 * 容量受限的历史记录存储，支持撤销 / 重做 / 清空 / 定点选择。
 * 所有操作都收敛到确定状态：cursor 永远指向有效项或为 -1（空）。
 */
export class HistoryStore<T extends { id: string }> {
  private entries: T[] = [];
  private cursor = -1;

  constructor(public readonly capacity: number = 10) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity 必须是正整数，收到: ${capacity}`);
    }
  }

  get length(): number {
    return this.entries.length;
  }

  get items(): readonly T[] {
    return this.entries;
  }

  get currentIndex(): number {
    return this.cursor;
  }

  get current(): T | null {
    return this.cursor >= 0 ? this.entries[this.cursor] : null;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  /** 追加新记录：丢弃重做尾部，超出容量时从最旧端驱逐。 */
  push(item: T): T {
    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }
    this.entries.push(item);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }
    this.cursor = this.entries.length - 1;
    return item;
  }

  undo(): T | null {
    if (this.canUndo) {
      this.cursor -= 1;
    }
    return this.current;
  }

  redo(): T | null {
    if (this.canRedo) {
      this.cursor += 1;
    }
    return this.current;
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }

  /** 按 id 恢复历史项；id 不存在时状态保持不变并返回 null。 */
  select(id: string): T | null {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return null;
    }
    this.cursor = index;
    return this.entries[index];
  }

  /** 原位更新当前项（微调 / 换主题 / 改尺寸），不改变序列与游标。 */
  updateCurrent(item: T): T | null {
    if (this.cursor < 0) {
      return null;
    }
    this.entries[this.cursor] = item;
    return item;
  }
}
