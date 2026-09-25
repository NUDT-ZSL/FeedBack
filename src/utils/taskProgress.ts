import type { Task, TaskWithProgress } from '../types';

/**
 * Pure derivation of a single task's timeline state.
 *
 * Everything (status / remainingTime / progress) is derived arithmetically
 * from `initialTime` (total seconds) and `timeLeft` (remaining seconds),
 * so the same inputs always produce the same output and no real clock is
 * needed to evaluate it.
 */
export function calculateTaskProgress(
  tasks: Task[],
  index: number,
  timeLeft: number,
  initialTime: number,
): TaskWithProgress {
  let cumulativeTime = 0;
  for (let i = 0; i < index; i++) {
    cumulativeTime += tasks[i].duration * 60;
  }

  const task = tasks[index];
  const taskTotalSeconds = task.duration * 60;
  const taskEndTime = initialTime - cumulativeTime;
  const taskStartTime = taskEndTime - taskTotalSeconds;

  let status: 'pending' | 'active' | 'completed';
  if (timeLeft > taskEndTime) {
    status = 'pending';
  } else if (timeLeft > taskStartTime) {
    status = 'active';
  } else {
    status = 'completed';
  }

  if (taskTotalSeconds <= 0) {
    // Zero/negative durations occupy no time on the timeline: they can never
    // be "active" and their progress must stay inside [0, 100] (never NaN).
    return {
      ...task,
      status,
      remainingTime: 0,
      progress: status === 'completed' ? 100 : 0,
    };
  }

  const elapsedInTask = Math.max(0, Math.min(taskTotalSeconds, taskEndTime - timeLeft));
  const progress = (elapsedInTask / taskTotalSeconds) * 100;
  const remainingInTask = Math.max(0, taskTotalSeconds - elapsedInTask);

  return {
    ...task,
    status,
    remainingTime: remainingInTask,
    progress: Math.min(100, Math.max(0, progress)),
  };
}

/** Derive the whole timeline for a given remaining-seconds value. */
export function calculateTasksProgress(
  tasks: Task[],
  timeLeft: number,
  initialTime: number,
): TaskWithProgress[] {
  return tasks.map((_, index) => calculateTaskProgress(tasks, index, timeLeft, initialTime));
}

export function getDotColor(status: TaskWithProgress['status']): string {
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
    const taskTotalSeconds = task.duration * 60;
    if (task.remainingTime <= 10) return '#f44336';
    if (task.remainingTime < taskTotalSeconds * 0.5) return '#ff9800';
    return '#2196F3';
  }
  return '#9e9e9e';
}

export function isBlinking(task: TaskWithProgress): boolean {
  return task.status === 'active' && task.remainingTime <= 10 && task.remainingTime > 0;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
