import { expect } from 'vitest';
import type { Task, TaskWithProgress } from '../../types';

export const makeTasks = (durations: number[]): Task[] =>
  durations.map((duration, i) => ({ id: `t${i}`, name: `任务${i}`, duration }));

/** Invariants that must hold for every derived task, at every second. */
export function assertSelfConsistent(task: TaskWithProgress) {
  const total = task.duration * 60;

  expect(Number.isNaN(task.progress)).toBe(false);
  expect(Number.isNaN(task.remainingTime)).toBe(false);
  expect(task.progress).toBeGreaterThanOrEqual(0);
  expect(task.progress).toBeLessThanOrEqual(100);
  expect(task.remainingTime).toBeGreaterThanOrEqual(0);
  expect(task.remainingTime).toBeLessThanOrEqual(Math.max(0, total));

  if (total <= 0) {
    // Zero/negative durations never stay "active" and hold no remaining time.
    expect(task.status).not.toBe('active');
    expect(task.remainingTime).toBe(0);
    expect(task.progress === 0 || task.progress === 100).toBe(true);
    return;
  }

  // remaining + elapsed must always add up to the task's total duration.
  expect(task.remainingTime + (task.progress / 100) * total).toBeCloseTo(total, 6);

  if (task.status === 'pending') {
    expect(task.progress).toBe(0);
    expect(task.remainingTime).toBe(total);
  } else if (task.status === 'completed') {
    expect(task.progress).toBe(100);
    expect(task.remainingTime).toBe(0);
  } else {
    expect(task.progress).toBeLessThan(100);
    expect(task.remainingTime).toBeGreaterThan(0);
  }
}
