import type { StateStorage } from 'zustand/middleware';

export interface MemoryStorage extends StateStorage {
  dump(): Record<string, string>;
}

export const createMemoryStorage = (seed?: Record<string, string>): MemoryStorage => {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
};
