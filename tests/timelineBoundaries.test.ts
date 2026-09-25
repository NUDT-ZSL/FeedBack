import { describe, it, expect } from 'vitest';
import { deriveTimeline } from '../src/timelineDerivation';
import type { Task } from '../src/types';

const task = (id: string, duration: number): Task => ({
  id,
  name: `task-${id}`,
  duration,
});

describe('deriveTimeline exact task boundaries', () => {
  // Single 5-minute task inside a 10-minute countdown.
  // Window: task ends at timeLeft=600, starts at timeLeft=300.
  const tasks = [task('a', 5)];
  const initialTime = 600;

  it('is active with 0 progress exactly at the task end boundary', () => {
    const [t] = deriveTimeline(tasks, 600, initialTime);
    expect(t.status).toBe('active');
    expect(t.progress).toBe(0);
    expect(t.remainingTime).toBe(300);
  });

  it('is pending one second before the task end boundary', () => {
    const [t] = deriveTimeline(tasks, 601, initialTime);
    expect(t.status).toBe('pending');
    expect(t.progress).toBe(0);
    expect(t.remainingTime).toBe(300);
  });

  it('is completed with 100 progress exactly at the task start boundary', () => {
    const [t] = deriveTimeline(tasks, 300, initialTime);
    expect(t.status).toBe('completed');
    expect(t.progress).toBe(100);
    expect(t.remainingTime).toBe(0);
  });

  it('is active with 1 second left one second before the start boundary', () => {
    const [t] = deriveTimeline(tasks, 301, initialTime);
    expect(t.status).toBe('active');
    expect(t.remainingTime).toBe(1);
    expect(t.progress).toBeCloseTo((299 / 300) * 100, 6);
  });

  it('hands over cleanly between two adjacent tasks at their shared boundary', () => {
    const two = [task('a', 5), task('b', 5)];
    // Shared boundary at timeLeft=300: first done, second just started.
    const [first, second] = deriveTimeline(two, 300, 600);
    expect(first.status).toBe('completed');
    expect(first.remainingTime).toBe(0);
    expect(second.status).toBe('active');
    expect(second.progress).toBe(0);
    expect(second.remainingTime).toBe(300);

    // One second later the second task owns the only active slot.
    const [first2, second2] = deriveTimeline(two, 299, 600);
    expect(first2.status).toBe('completed');
    expect(second2.status).toBe('active');
    expect(second2.remainingTime).toBe(299);
  });

  it('never has more than one active task at any second', () => {
    const many = [task('a', 3), task('b', 7), task('c', 2), task('d', 8)];
    const initial = 20 * 60;
    for (let timeLeft = initial; timeLeft >= 0; timeLeft--) {
      const derived = deriveTimeline(many, timeLeft, initial);
      const activeCount = derived.filter(t => t.status === 'active').length;
      expect(activeCount).toBeLessThanOrEqual(1);
    }
  });

  it('progress is monotonically non-decreasing as time runs down', () => {
    const many = [task('a', 3), task('b', 7), task('c', 10)];
    const initial = 20 * 60;
    let previous = deriveTimeline(many, initial, initial).map(t => t.progress);
    for (let timeLeft = initial - 1; timeLeft >= 0; timeLeft--) {
      const current = deriveTimeline(many, timeLeft, initial).map(
        t => t.progress,
      );
      current.forEach((progress, i) => {
        expect(progress).toBeGreaterThanOrEqual(previous[i]);
      });
      previous = current;
    }
  });
});
