import type { PersistedConfig } from './types';
import { configFingerprint, parseConfig } from './timerLogic';

export const TIMER_STORAGE_KEY = 'classroom-timer-config';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ConfigStore {
  save: (config: PersistedConfig) => void;
  flush: () => boolean;
  load: () => PersistedConfig | null;
}

export function createConfigStore(
  storage: StorageLike,
  key: string = TIMER_STORAGE_KEY,
  debounceMs: number = 200
): ConfigStore {
  let lastSavedFingerprint: string | null = null;
  let pending: PersistedConfig | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (config: PersistedConfig): boolean => {
    const fingerprint = configFingerprint(config);
    if (fingerprint === lastSavedFingerprint) {
      return false;
    }
    try {
      storage.setItem(key, JSON.stringify(config));
      lastSavedFingerprint = fingerprint;
      return true;
    } catch {
      return false;
    }
  };

  return {
    save(config: PersistedConfig): void {
      pending = config;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        const configToWrite = pending;
        pending = null;
        if (configToWrite) {
          write(configToWrite);
        }
      }, debounceMs);
    },

    flush(): boolean {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const configToWrite = pending;
      pending = null;
      return configToWrite ? write(configToWrite) : false;
    },

    load(): PersistedConfig | null {
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        return null;
      }
      const config = parseConfig(raw);
      if (config) {
        lastSavedFingerprint = configFingerprint(config);
      }
      return config;
    },
  };
}
