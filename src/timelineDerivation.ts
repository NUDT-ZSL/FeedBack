import type { Task, TaskWithProgress } from './types';

/**
 * Pure derivation of the task timeline.
 *
 * Everything the timeline renders (status, remaining time, progress, colors)
 * is derived here from the initial total time and the current remaining
 * seconds, so it can be tested offline without a real clock.
 */

export type TaskStatus = TaskWithProgress['status'];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Derive the progress of a single task within the timeline.
 *
 * Tasks are laid out backwards from the end of the countdown: the last task
 * finishes when timeLeft hits 0, and each earlier task occupies the window
 * before it. Tasks whose cumulative duration exceeds initialTime simply
 * never start (they stay pending with 0 progress).
 */
export function deriveTaskProgress(
  tasks: Task[],
  index: number,
  timeLeft: number,
  initialTime: number,
): TaskWithProgress {
  const task = tasks[index];
  let cumulativeTime = 0;
  for (let i = 0; i < index; i++) {
    // Clamp each contribution so zero/negative durations cannot drag the
    // windows of later tasks around and break the timeline ordering.
    cumulativeTime += Math.max(0, tasks[i].duration * 60);
  }

  // Zero or negative durations are treated as an empty window so progress
  // and remaining time stay finite and inside their valid ranges.
  const taskTotalSeconds = Math.max(0, task.duration * 60);
  const taskEndTime = initialTime - cumulativeTime;
  const taskStartTime = taskEndTime - taskTotalSeconds;
  const elapsedInTask = clamp(taskEndTime - timeLeft, 0, taskTotalSeconds);
  const remainingInTask = Math.max(0, taskTotalSeconds - elapsedInTask);

  let status: TaskStatus;
  if (timeLeft > taskEndTime) {
    status = 'pending';
  } else if (timeLeft > taskStartTime) {
    status = 'active';
  } else {
    status = 'completed';
  }

  const progress =
    taskTotalSeconds > 0
      ? (elapsedInTask / taskTotalSeconds) * 100
      : status === 'completed'
        ? 100
        : 0;

  return {
    ...task,
    status,
    remainingTime: remainingInTask,
    progress: clamp(progress, 0, 100),
  };
}

/** Derive the whole timeline for the current remaining seconds. */
export function deriveTimeline(
  tasks: Task[],
  timeLeft: number,
  initialTime: number,
): TaskWithProgress[] {
  return tasks.map((_, index) =>
    deriveTaskProgress(tasks, index, timeLeft, initialTime),
  );
}

export function getDotColor(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return '#4CAF50';
    case 'active':
      return '#2196F3';
    default:
      return '#9e9e9e';
  }
}

export function getProgressBarColor(task: TaskWithProgress): string {
  if (task.status === 'completed') return '#4CAF50';
  if (task.status === 'active') {
    const taskTotalSeconds = Math.max(0, task.duration * 60);
    if (task.remainingTime <= 10) return '#f44336';
    if (task.remainingTime < taskTotalSeconds * 0.5) return '#ff9800';
    return '#2196F3';
  }
  return '#9e9e9e';
}

export function isBlinking(task: TaskWithProgress): boolean {
  return (
    task.status === 'active' &&
    task.remainingTime <= 10 &&
    task.remainingTime > 0
  );
}
