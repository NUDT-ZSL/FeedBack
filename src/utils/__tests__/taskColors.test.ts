import { describe, it, expect } from 'vitest';
import {
  calculateTaskProgress,
  getDotColor,
  getProgressBarColor,
  isBlinking,
  formatTime,
} from '../taskProgress';
import { makeTasks } from './helpers';

const tasks = makeTasks([1]); // 60 秒任务
const initial = 60;

describe('颜色与闪烁提示', () => {
  it('圆点颜色与状态一一对应', () => {
    expect(getDotColor('pending')).toBe('#9e9e9e');
    expect(getDotColor('active')).toBe('#2196F3');
    expect(getDotColor('completed')).toBe('#4CAF50');
  });

  it('进度条颜色随状态与剩余时间切换', () => {
    // timeLeft 超过任务终点时为未开始（灰）
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 61, initial))).toBe('#9e9e9e');
    // 满额时刻即进入进行中起点（蓝）
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 60, initial))).toBe('#2196F3');
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 50, initial))).toBe('#2196F3');
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 20, initial))).toBe('#ff9800');
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 10, initial))).toBe('#f44336');
    expect(getProgressBarColor(calculateTaskProgress(tasks, 0, 0, initial))).toBe('#4CAF50');
  });

  it('仅在进行中且剩余 1-10 秒时闪烁', () => {
    expect(isBlinking(calculateTaskProgress(tasks, 0, 11, initial))).toBe(false);
    expect(isBlinking(calculateTaskProgress(tasks, 0, 10, initial))).toBe(true);
    expect(isBlinking(calculateTaskProgress(tasks, 0, 1, initial))).toBe(true);
    expect(isBlinking(calculateTaskProgress(tasks, 0, 0, initial))).toBe(false);
  });

  it('formatTime 输出 mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });
});
