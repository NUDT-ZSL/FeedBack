import type { Task } from './types';

export const STORAGE_KEY = 'classroom-timer-config';

export interface PersistedConfig {
  /** Total countdown duration in minutes. */
  time: number;
  tasks: Task[];
  timestamp: number;
}

export interface RestoredConfig {
  time: number;
  tasks: Task[];
}

/**
 * Serialize the timer configuration exactly the way useTimer persists it.
 * `now` is injectable so tests do not depend on the wall clock.
 */
export function serializeConfig(
  initialTimeSeconds: number,
  tasks: Task[],
  now: number = Date.now(),
): string {
  const config: PersistedConfig = {
    time: initialTimeSeconds / 60,
    tasks,
    timestamp: now,
  };
  return JSON.stringify(config);
}

/**
 * Parse a persisted configuration. Returns null when nothing usable was
 * stored, mirroring the fallback behaviour of useTimer.loadConfig.
 */
export function parseConfig(
  raw: string | null,
  fallbackMinutes: number,
): RestoredConfig | null {
  if (raw === null) {
    return null;
  }
  try {
    const config = JSON.parse(raw);
    if (config === null || typeof config !== 'object') {
      return null;
    }
    return {
      time: typeof config.time === 'number' ? config.time : fallbackMinutes,
      tasks: Array.isArray(config.tasks) ? config.tasks : [],
    };
  } catch {
    return null;
  }
}
