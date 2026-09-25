import type { Task } from '../types';

export const STORAGE_KEY = 'classroom-timer-config';

export interface SavedConfig {
  time: number;
  tasks: Task[];
  timestamp: number;
}

export interface LoadedConfig {
  time: number;
  tasks: Task[];
}

/**
 * Serialize the persisted configuration exactly the way useTimer.saveConfig
 * does. `now` is injected so tests do not depend on the wall clock.
 */
export function serializeConfig(
  initialTimeSeconds: number,
  tasks: Task[],
  now: number,
): string {
  const config: SavedConfig = {
    time: initialTimeSeconds / 60,
    tasks,
    timestamp: now,
  };
  return JSON.stringify(config);
}

/**
 * Parse a persisted configuration exactly the way useTimer.loadConfig does.
 * Returns null when nothing is stored or the payload is not valid JSON.
 */
export function parseConfig(
  json: string | null,
  fallbackMinutes: number,
): LoadedConfig | null {
  if (json === null) {
    return null;
  }
  try {
    const config = JSON.parse(json);
    return {
      time: config.time || fallbackMinutes,
      tasks: config.tasks || [],
    };
  } catch {
    return null;
  }
}
