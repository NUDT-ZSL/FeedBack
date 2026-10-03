import { describe, it, expect } from 'vitest';
import { timerReducer, deriveTasks, isIdle } from './timerCore';
import type { Task, TimerState } from '../types';

const idleState = (minutes: number): TimerState => ({
  isRunning: false,
  isPaused: false,
  timeLeft: minutes * 60,
  initialTime: minutes * 60,
});

const sampleTasks: Task[] = [
  { id: '1', name: '导入', duration: 5 },
  { id: '2', name: '讲解', duration: 10 },
  { id: '3', name: '练习', duration: 10 },
];

const tick = (state: TimerState, times: number): TimerState => {
  let next = state;
  for (let i = 0; i < times; i++) {
    next = timerReducer(next, { type: 'tick' });
  }
  return next;
};

describe('timerReducer', () => {
  it('暂停后修改总时长被拒绝，再继续时任务进度与状态不跳变', () => {
    let state = idleState(25);
    state = timerReducer(state, { type: 'start' });
    state = tick(state, 120);
    state = timerReducer(state, { type: 'pause' });
    expect(state.isPaused).toBe(true);
    expect(state.timeLeft).toBe(25 * 60 - 120);

    const before = deriveTasks(sampleTasks, state.timeLeft, state.initialTime);

    const rejected = timerReducer(state, { type: 'setTime', minutes: 30 });
    expect(rejected).toEqual(state);

    const after = deriveTasks(sampleTasks, rejected.timeLeft, rejected.initialTime);
    expect(after).toEqual(before);

    const resumed = timerReducer(rejected, { type: 'start' });
    expect(resumed.isRunning).toBe(true);
    expect(resumed.isPaused).toBe(false);
    expect(resumed.timeLeft).toBe(state.timeLeft);
    expect(resumed.initialTime).toBe(state.initialTime);
    expect(deriveTasks(sampleTasks, resumed.timeLeft, resumed.initialTime)).toEqual(before);
  });

  it('运行中修改总时长被拒绝', () => {
    let state = idleState(25);
    state = timerReducer(state, { type: 'start' });
    state = tick(state, 5);
    const rejected = timerReducer(state, { type: 'setTime', minutes: 40 });
    expect(rejected).toEqual(state);
  });

  it('空闲状态下可以修改总时长，重置回到初始值并清空运行状态', () => {
    const idle = idleState(25);
    expect(isIdle(idle)).toBe(true);
    const updated = timerReducer(idle, { type: 'setTime', minutes: 40 });
    expect(updated.initialTime).toBe(2400);
    expect(updated.timeLeft).toBe(2400);

    let running = timerReducer(updated, { type: 'start' });
    running = tick(running, 30);
    const reset = timerReducer(running, { type: 'reset' });
    expect(reset).toEqual({ isRunning: false, isPaused: false, timeLeft: 2400, initialTime: 2400 });
  });

  it('倒计时到 0 自动停止', () => {
    let state = idleState(1);
    state = timerReducer(state, { type: 'start' });
    state = tick(state, 60);
    expect(state.timeLeft).toBe(0);
    expect(state.isRunning).toBe(false);
    state = timerReducer(state, { type: 'tick' });
    expect(state.timeLeft).toBe(0);
  });
});

describe('deriveTasks', () => {
  it('任务状态与剩余时间由同一份计时状态推导', () => {
    const initialTime = 25 * 60;
    const timeLeft = initialTime - 7 * 60;
    const derived = deriveTasks(sampleTasks, timeLeft, initialTime);
    expect(derived.map((t) => t.status)).toEqual(['completed', 'active', 'pending']);
    expect(derived[0].remainingTime).toBe(0);
    expect(derived[0].progress).toBe(100);
    expect(derived[1].remainingTime).toBe(8 * 60);
    expect(derived[1].progress).toBeCloseTo(20);
    expect(derived[2].remainingTime).toBe(10 * 60);
    expect(derived[2].progress).toBe(0);
  });
});
