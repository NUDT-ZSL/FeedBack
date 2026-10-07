import type { RawCollectionState } from '../domain/raw.ts';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const COLLECTION_STORAGE_KEY = 'ancient-scroll-gallery.collection.v1';

/** 浏览器环境取 localStorage；离线/测试环境返回 null（引擎退化为纯内存） */
export function createBrowserStorage(): KeyValueStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* localStorage 不可用时静默降级为内存态 */
  }
  return null;
}

export function loadRawState(storage: KeyValueStorage, key: string): RawCollectionState | null {
  try {
    const text = storage.getItem(key);
    if (!text) return null;
    const parsed = JSON.parse(text) as { version?: number; entries?: unknown };
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return { entries: parsed.entries as RawCollectionState['entries'] };
    }
  } catch {
    /* 损坏的持久化数据不阻断启动，由裁决器在显式构造时处理 */
  }
  return null;
}

export function saveRawState(storage: KeyValueStorage, key: string, state: RawCollectionState): void {
  try {
    storage.setItem(key, JSON.stringify({ version: 1, entries: state.entries }));
  } catch {
    /* 存储失败（如配额满）不影响内存中的单一事实来源 */
  }
}
