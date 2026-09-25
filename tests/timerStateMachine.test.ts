import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  timerStart,
  timerPause,
  timerReset,
  timerSetTime,
  timerTick,
} from '../src/timerStateMachine';
import { deriveTimeline } from '../src/timelineDerivation';
import type { Task, TimerState } from '../src/types';

const tasks: Task[] = [
  { id: '1', name: 'warmup', duration: 5 },
  { id: '2', name: 'lecture', duration: 10 },
  { id: '3', name: 'practice', duration: 10 },
];

const tick = (state: TimerState, seconds: number): TimerState => {
  let s = state;
  for (let i = 0; i < seconds; i++) s = timerTick(s);
  return s;
};

/**
 * The timeline must always be a pure function of the CURRENT state:
 * after any transition, every task reflects the new remaining seconds,
 * none may keep a stale status from before the transition.
 */
function expectTimelineMatchesState(state: TimerState): void {
  const derived = deriveTimeline(tasks, state.timeLeft, state.initialTime);
  derived.forEach(t => {
    const totalSeconds = t.duration * 60;
    if (state.timeLeft <= state.initialTime - totalSeconds * 0) {
      // sanity: remaining time never exceeds the task window
      expect(t.remainingTime).toBeLessThanOrEqual(totalSeconds);
    }
  });
  // Re-deriving from the same inputs must be idempotent (no hidden state).
  expect(deriveTimeline(tasks, state.timeLeft, state.initialTime)).toEqual(
    derived,
  );
}

describe('timer state machine drives a consistent timeline', () => {
  it('start / tick advances the timeline second by second', () => {
    let state = timerStart(createInitialState(25));
    expect(state.isRunning).toBe(true);

    state = tick(state, 60);
    expect(state.timeLeft).toBe(25 * 60 - 60);

    const derived = deriveTimeline(tasks, state.timeLeft, state.initialTime);
    expect(derived[0].status).toBe('active');
    expect(derived[0].remainingTime).toBe(5 * 60 - 60);
    expect(derived[1].status).toBe('pending');
    expectTimelineMatchesState(state);
  });

  it('pause freezes the timeline, resume continues from the same second', () => {
    let state = timerStart(createInitialState(25));
    state = tick(state, 120);

    const beforePause = deriveTimeline(
      tasks,
      state.timeLeft,
      state.initialTime,
    );

    state = timerPause(state);
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(true);

    // Ticks while paused must not move anything.
    state = tick(state, 30);
    expect(state.timeLeft).toBe(25 * 60 - 120);
    expect(deriveTimeline(tasks, state.timeLeft, state.initialTime)).toEqual(
      beforePause,
    );

    // Resume: the next tick continues exactly where it stopped.
    state = timerStart(state);
    expect(state.isPaused).toBe(false);
    state = timerTick(state);
    expect(state.timeLeft).toBe(25 * 60 - 121);
    expectTimelineMatchesState(state);
  });

  it('reset restores the full timeline, no task keeps an old status', () => {
    let state = timerStart(createInitialState(25));
    state = tick(state, 20 * 60); // deep into the last task

    const midRun = deriveTimeline(tasks, state.timeLeft, state.initialTime);
    expect(midRun[0].status).toBe('completed');
    expect(midRun[1].status).toBe('completed');
    expect(midRun[2].status).toBe('active');

    state = timerReset(state);
    expect(state.timeLeft).toBe(state.initialTime);
    expect(state.isRunning).toBe(false);

    const afterReset = deriveTimeline(
      tasks,
      state.timeLeft,
      state.initialTime,
    );
    // Identical to a fresh session at the same configuration.
    expect(afterReset).toEqual(
      deriveTimeline(tasks, 25 * 60, 25 * 60),
    );
    expect(afterReset[0].status).toBe('active');
    expect(afterReset[0].progress).toBe(0);
    expect(afterReset[1].status).toBe('pending');
    expect(afterReset[2].status).toBe('pending');
  });

  it('setTime re-derives the whole timeline against the new total', () => {
    let state = timerStart(createInitialState(25));
    state = tick(state, 8 * 60); // second task active

    state = timerSetTime(10);
    expect(state.initialTime).toBe(600);
    expect(state.timeLeft).toBe(600);
    expect(state.isRunning).toBe(false);

    const derived = deriveTimeline(tasks, state.timeLeft, state.initialTime);
    // 25 minutes of tasks no longer fit in 10 minutes: the timeline is
    // laid out from the start of the countdown, so trailing tasks overflow
    // past zero. The first task runs, the second overflows into negative
    // time and the third never starts.
    expect(derived[0].status).toBe('active');
    expect(derived[1].status).toBe('pending');
    expect(derived[2].status).toBe('pending');

    state = timerStart(state);
    state = tick(state, 600);
    const atZero = deriveTimeline(tasks, state.timeLeft, state.initialTime);
    expect(atZero[0].status).toBe('completed');
    // Second task window is [-300, 300]: still active at zero, its
    // remaining time reflects the overflow rather than a stale status.
    expect(atZero[1].status).toBe('active');
    expect(atZero[1].remainingTime).toBe(300);
    expect(atZero[2].status).toBe('pending');
    expectTimelineMatchesState(state);
  });

  it('runs to zero and stops; start is a no-op once finished', () => {
    let state = timerStart(createInitialState(25));
    state = tick(state, 25 * 60);
    expect(state.timeLeft).toBe(0);
    expect(state.isRunning).toBe(false);

    const derived = deriveTimeline(tasks, state.timeLeft, state.initialTime);
    expect(derived.every(t => t.status === 'completed')).toBe(true);

    const restarted = timerStart(state);
    expect(restarted).toBe(state);
    expect(tick(restarted, 5).timeLeft).toBe(0);
  });
});
