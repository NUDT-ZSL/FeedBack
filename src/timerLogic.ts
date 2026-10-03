import type { Task, TaskWithProgress, TimerState, PersistedConfig } from './types';

export type TimerPhase = 'idle' | 'running' | 'paused';

export function getTimerPhase(state: Pick<TimerState, 'isRunning' | 'isPaused'>): TimerPhase {
  if (state.isRunning) return 'running';
  if (state.isPaused) return 'paused';
  return 'idle';
}

export function isTimerIdle(state: Pick<TimerState, 'isRunning' | 'isPaused'>): boolean {
  return getTimerPhase(state) === 'idle';
}

export function createInitialState(initialMinutes: number): TimerState {
  const seconds = Math.max(0, Math.round(initialMinutes * 60));
  return { isRunning: false, isPaused: false, timeLeft: seconds, initialTime: seconds };
}

export function startTimer(state: TimerState): TimerState {
  if (state.isRunning || state.timeLeft <= 0) return state;
  return { ...state, isRunning: true, isPaused: false };
}

export function pauseTimer(state: TimerState): TimerState {
  if (!state.isRunning) return state;
  return { ...state, isRunning: false, isPaused: true };
}

export function resetTimer(state: TimerState): TimerState {
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: state.initialTime,
    initialTime: state.initialTime,
  };
}

export interface TickResult {
  state: TimerState;
  finished: boolean;
}

export function tickTimer(state: TimerState): TickResult {
  if (!state.isRunning || state.isPaused) {
    return { state, finished: false };
  }
  if (state.timeLeft <= 1) {
    return { state: { ...state, timeLeft: 0, isRunning: false }, finished: true };
  }
  return { state: { ...state, timeLeft: state.timeLeft - 1 }, finished: false };
}

export function setDuration(state: TimerState, minutes: number): TimerState {
  if (!isTimerIdle(state)) return state;
  const seconds = Math.max(0, Math.round(minutes * 60));
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

export function restoreTimerState(saved: PersistedConfig, fallbackMinutes: number): TimerState {
  const baseMinutes = typeof saved.time === 'number' && saved.time > 0 ? saved.time : fallbackMinutes;
  const initialTime = Math.max(0, Math.round(baseMinutes * 60));
  const rawLeft = typeof saved.timeLeft === 'number' ? saved.timeLeft : initialTime;
  const timeLeft = Math.max(0, Math.min(initialTime, Math.round(rawLeft)));
  return {
    isRunning: false,
    isPaused: saved.isPaused === true && timeLeft > 0,
    timeLeft,
    initialTime,
  };
}

export function deriveTasksWithProgress(
  tasks: Task[],
  timeLeft: number,
  initialTime: number
): TaskWithProgress[] {
  let cumulativeTime = 0;
  return tasks.map((task) => {
    const taskTotalSeconds = task.duration * 60;
    const taskEndTime = initialTime - cumulativeTime;
    const taskStartTime = taskEndTime - taskTotalSeconds;
    cumulativeTime += taskTotalSeconds;

    const elapsedInTask = Math.max(0, Math.min(taskTotalSeconds, taskEndTime - timeLeft));
    const progress = Math.min(100, Math.max(0, (elapsedInTask / taskTotalSeconds) * 100));
    const remainingTime = Math.max(0, taskTotalSeconds - elapsedInTask);

    let status: TaskWithProgress['status'];
    if (timeLeft > taskEndTime) {
      status = 'pending';
    } else if (timeLeft > taskStartTime) {
      status = 'active';
    } else {
      status = 'completed';
    }

    return { ...task, status, remainingTime, progress };
  });
}

export function configFromState(
  state: TimerState,
  tasks: Task[],
  timestamp: number = Date.now()
): PersistedConfig {
  return {
    time: state.initialTime / 60,
    tasks,
    isPaused: state.isPaused,
    timeLeft: state.timeLeft,
    timestamp,
  };
}

export function configFingerprint(config: PersistedConfig): string {
  return JSON.stringify({
    time: config.time,
    tasks: config.tasks,
    isPaused: config.isPaused,
    timeLeft: config.timeLeft,
  });
}

export function parseConfig(raw: string | null): PersistedConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const time = typeof parsed.time === 'number' && parsed.time > 0 ? parsed.time : 0;
    if (time <= 0) return null;
    return {
      time,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      isPaused: parsed.isPaused === true,
      timeLeft: typeof parsed.timeLeft === 'number' ? parsed.timeLeft : Math.round(time * 60),
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : 0,
    };
  } catch {
    return null;
  }
}
