import type { TimerState } from './types';

/**
 * Pure timer state transitions.
 *
 * Every control action (start / pause / reset / setTime) and every elapsed
 * second (tick) is a pure function of the previous state, so the whole
 * lifecycle can be simulated deterministically in tests without real timers.
 */

export function createInitialState(initialMinutes: number): TimerState {
  const seconds = initialMinutes * 60;
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

/** Start (or resume) the countdown. No-op when no time remains. */
export function timerStart(prev: TimerState): TimerState {
  if (prev.timeLeft <= 0) {
    return prev;
  }
  return { ...prev, isRunning: true, isPaused: false };
}

/** Pause the countdown, keeping the remaining seconds. */
export function timerPause(prev: TimerState): TimerState {
  return { ...prev, isRunning: false, isPaused: true };
}

/** Reset back to the configured initial time. */
export function timerReset(prev: TimerState): TimerState {
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: prev.initialTime,
    initialTime: prev.initialTime,
  };
}

/** Set a new total duration (in minutes) and stop the countdown. */
export function timerSetTime(minutes: number): TimerState {
  const seconds = minutes * 60;
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

/**
 * Advance the countdown by one second.
 * Only runs while the timer is running and not paused; clamps at zero and
 * stops the timer when the countdown finishes.
 */
export function timerTick(prev: TimerState): TimerState {
  if (!prev.isRunning || prev.isPaused) {
    return prev;
  }
  if (prev.timeLeft <= 1) {
    return { ...prev, timeLeft: 0, isRunning: false };
  }
  return { ...prev, timeLeft: prev.timeLeft - 1 };
}
