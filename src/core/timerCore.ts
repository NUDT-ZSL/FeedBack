import type { Task, TaskWithProgress, TimerState } from '../types';

export const isIdle = (state: TimerState): boolean =>
  !state.isRunning && !state.isPaused;

export type TimerAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'setTime'; minutes: number }
  | { type: 'tick' }
  | { type: 'restore'; snapshot: TimerState };

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'start':
      if (state.timeLeft <= 0 || state.isRunning) {
        return state;
      }
      return { ...state, isRunning: true, isPaused: false };
    case 'pause':
      if (!state.isRunning || state.isPaused) {
        return state;
      }
      return { ...state, isRunning: false, isPaused: true };
    case 'reset':
      return {
        isRunning: false,
        isPaused: false,
        timeLeft: state.initialTime,
        initialTime: state.initialTime,
      };
    case 'setTime': {
      if (!isIdle(state)) {
        return state;
      }
      const seconds = Math.round(action.minutes * 60);
      return {
        isRunning: false,
        isPaused: false,
        timeLeft: seconds,
        initialTime: seconds,
      };
    }
    case 'tick':
      if (!state.isRunning || state.isPaused) {
        return state;
      }
      if (state.timeLeft <= 1) {
        return { ...state, timeLeft: 0, isRunning: false, isPaused: false };
      }
      return { ...state, timeLeft: state.timeLeft - 1 };
    case 'restore':
      return action.snapshot;
  }
}

export function deriveTasks(
  tasks: Task[],
  timeLeft: number,
  initialTime: number,
): TaskWithProgress[] {
  let cumulativeSeconds = 0;
  return tasks.map((task) => {
    const taskTotalSeconds = task.duration * 60;
    const taskEndTime = initialTime - cumulativeSeconds;
    const taskStartTime = taskEndTime - taskTotalSeconds;
    cumulativeSeconds += taskTotalSeconds;

    const elapsedInTask = Math.max(
      0,
      Math.min(taskTotalSeconds, taskEndTime - timeLeft),
    );
    const remainingTime = Math.max(0, taskTotalSeconds - elapsedInTask);
    const progress = Math.min(
      100,
      Math.max(0, (elapsedInTask / taskTotalSeconds) * 100),
    );

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
