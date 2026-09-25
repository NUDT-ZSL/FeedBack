import type { TimerState } from '../types';

/**
 * Pure timer state transitions, mirroring the controls exposed by useTimer.
 * They take and return plain state objects so tests can drive pause / resume /
 * reset / setTime / tick sequences without a real clock or React.
 */

export function createTimerState(initialMinutes: number): TimerState {
  const seconds = initialMinutes * 60;
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

export function startTimer(state: TimerState): TimerState {
  if (state.timeLeft <= 0) {
    return state;
  }
  return { ...state, isRunning: true, isPaused: false };
}

export function pauseTimer(state: TimerState): TimerState {
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

export function setTimerMinutes(_state: TimerState, minutes: number): TimerState {
  const seconds = minutes * 60;
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

/**
 * One one-second tick. Returns the next state and whether the timer reached
 * zero on this tick (the hook uses `ended` to fire the beep / onEnd callback).
 */
export function tickTimer(state: TimerState): { state: TimerState; ended: boolean } {
  if (state.timeLeft <= 1) {
    return { state: { ...state, timeLeft: 0, isRunning: false }, ended: true };
  }
  return { state: { ...state, timeLeft: state.timeLeft - 1 }, ended: false };
}
