import type { Task, TimerState } from '../types';

export const STORAGE_KEY = 'classroom-timer-config';

export interface TimerSnapshot {
  state: TimerState;
  tasks: Task[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function serializeSnapshot(snapshot: TimerSnapshot): string {
  const { state, tasks } = snapshot;
  return JSON.stringify({
    time: state.initialTime / 60,
    timeLeft: state.timeLeft,
    isPaused: state.isPaused,
    isRunning: state.isRunning,
    tasks,
  });
}

export function deserializeSnapshot(
  raw: string,
  fallbackMinutes: number,
): TimerSnapshot | null {
  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object') {
      return null;
    }

    const minutes =
      typeof config.time === 'number' && config.time > 0
        ? config.time
        : fallbackMinutes;
    const initialTime = Math.round(minutes * 60);
    const rawTimeLeft =
      typeof config.timeLeft === 'number' ? Math.round(config.timeLeft) : initialTime;
    const timeLeft = Math.max(0, Math.min(initialTime, rawTimeLeft));

    const isPaused = Boolean(config.isPaused) && timeLeft > 0;
    const isRunning = !isPaused && Boolean(config.isRunning) && timeLeft > 0;

    const tasks: Task[] = Array.isArray(config.tasks)
      ? config.tasks.filter((task: unknown): task is Task => {
          if (!task || typeof task !== 'object') {
            return false;
          }
          const candidate = task as Record<string, unknown>;
          return (
            typeof candidate.id === 'string' &&
            typeof candidate.name === 'string' &&
            typeof candidate.duration === 'number'
          );
        })
      : [];

    return { state: { isRunning, isPaused, timeLeft, initialTime }, tasks };
  } catch {
    return null;
  }
}

export function createConfigStore(
  storage: StorageLike,
  key: string = STORAGE_KEY,
) {
  let lastSaved: string | null = null;

  return {
    load(fallbackMinutes: number): TimerSnapshot | null {
      const raw = storage.getItem(key);
      if (raw === null) {
        return null;
      }
      const snapshot = deserializeSnapshot(raw, fallbackMinutes);
      if (!snapshot) {
        return null;
      }
      lastSaved = serializeSnapshot(snapshot);
      return snapshot;
    },

    save(snapshot: TimerSnapshot): boolean {
      const serialized = serializeSnapshot(snapshot);
      if (serialized === lastSaved) {
        return false;
      }
      try {
        storage.setItem(key, serialized);
      } catch {
        return false;
      }
      lastSaved = serialized;
      return true;
    },
  };
}
