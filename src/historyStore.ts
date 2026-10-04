import type { HistoryStore, RoundRecord } from './gameEngine';

export const STORAGE_KEY = 'guess-word-duel-history-v1';

export function createLocalStorageStore(key: string = STORAGE_KEY): HistoryStore {
  return {
    load(): RoundRecord[] {
      if (typeof localStorage === 'undefined') return [];
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as RoundRecord[]) : [];
      } catch {
        return [];
      }
    },
    save(records: RoundRecord[]): void {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(key, JSON.stringify(records));
      } catch {
        // ignore storage errors
      }
    }
  };
}

export interface MemoryHistoryStore extends HistoryStore {
  getStored(): RoundRecord[] | null;
}

export function createMemoryHistoryStore(initial: RoundRecord[] | null = null): MemoryHistoryStore {
  let stored: RoundRecord[] | null = initial;
  return {
    load(): RoundRecord[] {
      return stored === null ? [] : stored.map(record => ({ ...record }));
    },
    save(records: RoundRecord[]): void {
      stored = records.map(record => ({ ...record }));
    },
    getStored(): RoundRecord[] | null {
      return stored === null ? null : stored.map(record => ({ ...record }));
    }
  };
}
