export interface MemoryStorageHandle {
  storage: Storage;
  dump: () => Record<string, string>;
}

export function installMemoryLocalStorage(): MemoryStorageHandle {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  globalThis.localStorage = storage;
  return {
    storage,
    dump: () => Object.fromEntries(store.entries()),
  };
}
