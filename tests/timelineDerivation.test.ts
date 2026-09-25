import { describe, it, expect } from 'vitest';
import {
  deriveTimeline,
  getDotColor,
  getProgressBarColor,
  isBlinking,
} from '../src/timelineDerivation';
import type { Task, TaskWithProgress } from '../src/types';

const task = (id: string, duration: number): Task => ({
  id,
  name: `task-${id}`,
  duration,
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Invariants that must hold for every derived task at every second. */
function assertTimelineInvariants(
  tasks: Task[],
  derived: TaskWithProgress[],
): void {
  expect(derived).toHaveLength(tasks.length);

  let seenActive = false;
  let seenPending = false;

  derived.forEach((t, i) => {
    const totalSeconds = Math.max(0, tasks[i].duration * 60);

    // Ranges: everything finite and inside its valid interval.
    expect(['pending', 'active', 'completed']).toContain(t.status);
    expect(Number.isFinite(t.progress)).toBe(true);
    expect(t.progress).toBeGreaterThanOrEqual(0);
    expect(t.progress).toBeLessThanOrEqual(100);
    expect(Number.isFinite(t.remainingTime)).toBe(true);
    expect(t.remainingTime).toBeGreaterThanOrEqual(0);
    expect(t.remainingTime).toBeLessThanOrEqual(totalSeconds);

    // Status <-> remaining time <-> progress must agree with each other.
    if (t.status === 'completed') {
      expect(t.remainingTime).toBe(0);
      expect(t.progress).toBe(100);
    }
    if (t.status === 'pending') {
      expect(t.remainingTime).toBe(totalSeconds);
      expect(t.progress).toBe(0);
    }
    if (t.status === 'active') {
      expect(totalSeconds).toBeGreaterThan(0);
      expect(t.remainingTime).toBeGreaterThan(0);
      // At the exact end boundary a task is already active with its full
      // window remaining, so the bounds are inclusive here.
      expect(t.remainingTime).toBeLessThanOrEqual(totalSeconds);
      expect(t.progress).toBeGreaterThanOrEqual(0);
      expect(t.progress).toBeLessThan(100);
    }

    // progress + remaining must account for the whole task window.
    if (totalSeconds > 0) {
      const elapsed = (t.progress / 100) * totalSeconds;
      expect(elapsed + t.remainingTime).toBeCloseTo(totalSeconds, 6);
    }

    // Statuses are ordered along the timeline: completed -> active -> pending.
    if (t.status === 'active') {
      expect(seenPending).toBe(false);
      expect(seenActive).toBe(false);
      seenActive = true;
    }
    if (t.status === 'pending') {
      seenPending = true;
    }

    // Colors are always valid and consistent with the status.
    expect(getDotColor(t.status)).toMatch(HEX_COLOR);
    expect(getProgressBarColor(t)).toMatch(HEX_COLOR);
    if (t.status === 'completed') {
      expect(getProgressBarColor(t)).toBe('#4CAF50');
    }
    if (t.status === 'pending') {
      expect(getProgressBarColor(t)).toBe('#9e9e9e');
    }
    if (isBlinking(t)) {
      expect(t.status).toBe('active');
      expect(t.remainingTime).toBeLessThanOrEqual(10);
      expect(t.remainingTime).toBeGreaterThan(0);
    }
  });
}

describe('deriveTimeline edge cases', () => {
  it('returns an empty timeline for an empty task list', () => {
    expect(deriveTimeline([], 1500, 1500)).toEqual([]);
    expect(deriveTimeline([], 0, 1500)).toEqual([]);
  });

  it('keeps tasks beyond the total duration pending and self-consistent', () => {
    // 18 minutes of tasks inside a 10 minute countdown: the timeline is
    // laid out from the start of the countdown, so the trailing tasks
    // overflow past zero and can never finish.
    const tasks = [task('a', 8), task('b', 5), task('c', 5)];
    const initialTime = 10 * 60;

    for (let timeLeft = initialTime; timeLeft >= 0; timeLeft--) {
      const derived = deriveTimeline(tasks, timeLeft, initialTime);
      assertTimelineInvariants(tasks, derived);
    }

    // The task overflowing past zero never starts: at zero it is still
    // pending with its full duration remaining and zero progress.
    const atZero = deriveTimeline(tasks, 0, initialTime);
    expect(atZero[0].status).toBe('completed');
    expect(atZero[2].status).toBe('pending');
    expect(atZero[2].progress).toBe(0);
    expect(atZero[2].remainingTime).toBe(5 * 60);
  });

  it('handles zero-duration tasks without NaN progress', () => {
    const tasks = [task('a', 5), task('zero', 0), task('b', 5)];
    const initialTime = 10 * 60;

    for (let timeLeft = initialTime; timeLeft >= 0; timeLeft--) {
      const derived = deriveTimeline(tasks, timeLeft, initialTime);
      assertTimelineInvariants(tasks, derived);
      const zeroTask = derived[1];
      expect(zeroTask.remainingTime).toBe(0);
      expect([0, 100]).toContain(zeroTask.progress);
      expect(zeroTask.status).not.toBe('active');
    }
  });

  it('handles negative-duration tasks without NaN or negative ranges', () => {
    const tasks = [task('a', 5), task('neg', -3), task('b', 5)];
    const initialTime = 10 * 60;

    for (let timeLeft = initialTime; timeLeft >= 0; timeLeft--) {
      const derived = deriveTimeline(tasks, timeLeft, initialTime);
      assertTimelineInvariants(tasks, derived);
      const negTask = derived[1];
      expect(negTask.remainingTime).toBe(0);
      expect([0, 100]).toContain(negTask.progress);
    }
  });

  it('marks every task completed when remaining seconds reach zero', () => {
    const tasks = [task('a', 5), task('b', 10), task('c', 10)];
    const derived = deriveTimeline(tasks, 0, 25 * 60);
    assertTimelineInvariants(tasks, derived);
    for (const t of derived) {
      expect(t.status).toBe('completed');
      expect(t.progress).toBe(100);
      expect(t.remainingTime).toBe(0);
    }
  });
});
