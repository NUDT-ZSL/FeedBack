import { describe, it, expect } from 'vitest';
import type { TaskWithProgress } from '../../types';
import { calculateTaskProgress, calculateTasksProgress } from '../taskProgress';
import { makeTasks, assertSelfConsistent } from './helpers';

describe('calculateTasksProgress 边界与自洽性', () => {
  it('任务列表为空时不产生任何派生结果', () => {
    expect(calculateTasksProgress([], 1500, 1500)).toEqual([]);
    expect(calculateTasksProgress([], 0, 1500)).toEqual([]);
  });

  it('累计任务时长超过初始总时长时结果仍在合理区间', () => {
    const tasks = makeTasks([30, 30]); // 60 分钟任务塞进 25 分钟
    const initial = 25 * 60;
    for (let timeLeft = initial; timeLeft >= 0; timeLeft--) {
      const derived = calculateTasksProgress(tasks, timeLeft, initial);
      derived.forEach(assertSelfConsistent);
      // 超出总时长的尾部任务时间窗为负，永远不会被进入：
      // 全程保持未开始、进度 0、剩余时间等于自身时长
      expect(derived[1].status).toBe('pending');
      expect(derived[1].progress).toBe(0);
      expect(derived[1].remainingTime).toBe(30 * 60);
    }
  });

  it('计时器满额时刻首个任务处于进行中起点（边界语义）', () => {
    const tasks = makeTasks([5, 10, 5]);
    const initial = 20 * 60;
    const derived = calculateTasksProgress(tasks, initial, initial);
    // timeLeft == taskEndTime 时按 active 处理，进度为 0
    expect(derived[0].status).toBe('active');
    expect(derived[0].progress).toBe(0);
    expect(derived[0].remainingTime).toBe(5 * 60);
    expect(derived[1].status).toBe('pending');
    expect(derived[2].status).toBe('pending');
  });

  it('任务时长为零时进度不为 NaN 且状态自洽', () => {
    const tasks = makeTasks([5, 0, 5]);
    const initial = 10 * 60;
    for (let timeLeft = initial; timeLeft >= 0; timeLeft--) {
      calculateTasksProgress(tasks, timeLeft, initial).forEach(assertSelfConsistent);
    }
  });

  it('任务时长为负值时进度不为 NaN 且状态自洽', () => {
    const tasks = makeTasks([5, -3, 5]);
    const initial = 10 * 60;
    for (let timeLeft = initial; timeLeft >= 0; timeLeft--) {
      calculateTasksProgress(tasks, timeLeft, initial).forEach(assertSelfConsistent);
    }
  });

  it('剩余秒数为零时所有任务均为已完成、剩余为零、进度为 100', () => {
    const tasks = makeTasks([5, 10, 5]);
    const derived = calculateTasksProgress(tasks, 0, 20 * 60);
    for (const task of derived) {
      expect(task.status).toBe('completed');
      expect(task.remainingTime).toBe(0);
      expect(task.progress).toBe(100);
    }
  });

  it('恰好落在任务起止边界时状态唯一确定', () => {
    const tasks = makeTasks([10]);
    const initial = 10 * 60; // end=600, start=0
    // 终点边界：timeLeft == taskEndTime -> 进入 active，进度为 0
    const atEnd = calculateTaskProgress(tasks, 0, 600, initial);
    expect(atEnd.status).toBe('active');
    expect(atEnd.progress).toBe(0);
    expect(atEnd.remainingTime).toBe(600);
    // 起点边界：timeLeft == taskStartTime -> 恰好完成
    const atStart = calculateTaskProgress(tasks, 0, 0, initial);
    expect(atStart.status).toBe('completed');
    expect(atStart.progress).toBe(100);
    expect(atStart.remainingTime).toBe(0);
    // 边界前后一秒状态互不相同，不会同时进行中又已完成
    expect(calculateTaskProgress(tasks, 0, 601, initial).status).toBe('pending');
    expect(calculateTaskProgress(tasks, 0, 1, initial).status).toBe('active');
  });

  it('多任务整段扫描：任意时刻至多一个进行中且状态单调推进', () => {
    const tasks = makeTasks([5, 10, 5]);
    const initial = 20 * 60;
    let previous: TaskWithProgress[] | null = null;
    for (let timeLeft = initial; timeLeft >= 0; timeLeft--) {
      const derived = calculateTasksProgress(tasks, timeLeft, initial);
      derived.forEach(assertSelfConsistent);
      expect(derived.filter(t => t.status === 'active').length).toBeLessThanOrEqual(1);
      if (previous) {
        const order = { pending: 0, active: 1, completed: 2 };
        derived.forEach((task, i) => {
          // 状态只能向前推进，不会从已完成退回进行中或未开始
          expect(order[task.status]).toBeGreaterThanOrEqual(order[previous![i].status]);
        });
      }
      previous = derived;
    }
  });
});
