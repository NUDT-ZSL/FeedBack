import { describe, it, expect } from 'vitest';
import { serializeConfig, parseConfig } from '../src/configStorage';
import {
  createInitialState,
  timerStart,
  timerSetTime,
  timerTick,
} from '../src/timerStateMachine';
import { deriveTimeline } from '../src/timelineDerivation';
import type { Task } from '../src/types';

const tasks: Task[] = [
  { id: '1', name: 'warmup', duration: 5 },
  { id: '2', name: 'lecture', duration: 10 },
  { id: '3', name: 'practice', duration: 10 },
];

describe('config persistence round-trip', () => {
  it('restored tasks and total time derive the identical timeline', () => {
    // Simulate a running session partway through.
    let state = timerStart(createInitialState(25));
    for (let i = 0; i < 7 * 60 + 30; i++) state = timerTick(state);

    const beforeSave = deriveTimeline(
      tasks,
      state.timeLeft,
      state.initialTime,
    );

    // Persist with a fixed timestamp so the test is fully deterministic.
    const raw = serializeConfig(state.initialTime, tasks, 1700000000000);

    // "Reload the page": parse the config and rebuild the timer state.
    const restored = parseConfig(raw, 25);
    expect(restored).not.toBeNull();
    expect(restored!.time).toBe(25);
    expect(restored!.tasks).toEqual(tasks);

    const restoredState = timerSetTime(restored!.time);
    let replayed = timerStart(restoredState);
    for (let i = 0; i < 7 * 60 + 30; i++) replayed = timerTick(replayed);

    const afterRestore = deriveTimeline(
      restored!.tasks,
      replayed.timeLeft,
      replayed.initialTime,
    );
    expect(afterRestore).toEqual(beforeSave);
  });

  it('round-trips edge-case task lists unchanged', () => {
    const edgeTasks: Task[] = [
      { id: 'z', name: 'zero', duration: 0 },
      { id: 'n', name: 'negative', duration: -2 },
      { id: 'b', name: 'big', duration: 999 },
    ];
    const raw = serializeConfig(10 * 60, edgeTasks, 123);
    const restored = parseConfig(raw, 25)!;
    expect(restored.tasks).toEqual(edgeTasks);
    expect(restored.time).toBe(10);

    for (const timeLeft of [600, 300, 0]) {
      expect(
        deriveTimeline(restored.tasks, timeLeft, restored.time * 60),
      ).toEqual(deriveTimeline(edgeTasks, timeLeft, 600));
    }
  });

  it('returns null when nothing was stored or the payload is corrupt', () => {
    expect(parseConfig(null, 25)).toBeNull();
    expect(parseConfig('not-json{', 25)).toBeNull();
    expect(parseConfig('42', 25)).toBeNull();
  });

  it('falls back to defaults for missing fields', () => {
    const restored = parseConfig('{}', 25);
    expect(restored).toEqual({ time: 25, tasks: [] });

    const noTasks = parseConfig(JSON.stringify({ time: 45 }), 25);
    expect(noTasks).toEqual({ time: 45, tasks: [] });
  });

  it('serialized payload keeps the shape useTimer persists', () => {
    const raw = serializeConfig(1500, tasks, 1700000000000);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      time: 25,
      tasks,
      timestamp: 1700000000000,
    });
  });
});
