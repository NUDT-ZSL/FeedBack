import { beforeEach } from 'vitest';

/**
 * 内存版 localStorage：与 Web Storage 接口一致，
 * 让 storage.ts 在纯 Node 环境下离线运行，无需浏览器。
 */
class MemoryLocalStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const mock = new MemoryLocalStorage();

Object.defineProperty(globalThis, 'localStorage', {
  value: mock,
  writable: true,
  configurable: true,
});

// 每个用例前清空存储，保证用例之间互不影响。
beforeEach(() => {
  mock.clear();
});
