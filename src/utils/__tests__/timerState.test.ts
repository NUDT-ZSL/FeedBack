import { describe, it, expect } from 'vitest';
import type { TimerState } from '../../types';
import {
  createTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  setTimerMinutes,
  tickTimer,
} from '../timerState';
import { calculateTasksProgress } from '../taskProgress';
import { makeTasks, assertSelfConsistent } from './helpers';

const tasks = makeTasks([5, 10, 5]);

/** The whole timeline must always reflect the state's current timeLeft. */
function assertTimelineMatches(state: TimerState) {
  const derived = calculateTasksProgress(tasks, state.timeLeft, state.initialTime);
  derived.forEach(assertSelfConsistent);
  return derived;
}

function tick(state: TimerState, seconds: number): TimerState {
  let current = state;
  for (let i = 0; i < seconds; i++) {
    current = tickTimer(current).state;
  }
  return current;
}

describe('计时器状态迁移驱动整条时间线一致变化', () => {
  it('开始后逐秒推进，每个任务状态随剩余秒数更新', () => {
    let state = startTimer(createTimerState(20));
    expect(state.isRunning).toBe(true);
    const seen = new Set<string>();
    while (state.isRunning) {
      const derived = assertTimelineMatches(state);
      seen.add(derived.map(t => t.status).join(','));
      const next = tickTimer(state);
      state = next.state;
      if (next.ended) {
        expect(state.timeLeft).toBe(0);
        expect(state.isRunning).toBe(false);
      }
    }
    // 记录归零后的最终时间线
    assertTimelineMatches(state).forEach(t => expect(t.status).toBe('completed'));
    seen.add(calculateTasksProgress(tasks, state.timeLeft, state.initialTime)
      .map(t => t.status).join(','));
    // 完整经历了 首任务进行中 -> 各任务依次推进 -> 全部完成
    expect(seen.has('active,pending,pending')).toBe(true);
    expect(seen.has('completed,active,pending')).toBe(true);
    expect(seen.has('completed,completed,active')).toBe(true);
    expect(seen.has('completed,completed,completed')).toBe(true);
  });

  it('暂停冻结剩余秒数，继续后从同一秒恢复，时间线不出现旧状态', () => {
    let state = startTimer(createTimerState(20));
    state = tick(state, 300); // 走到第二个任务进行中
    const beforePause = calculateTasksProgress(tasks, state.timeLeft, state.initialTime);

    state = pauseTimer(state);
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(true);
    // 暂停期间时间线保持冻结
    expect(calculateTasksProgress(tasks, state.timeLeft, state.initialTime))
      .toEqual(beforePause);

    state = startTimer(state); // 继续
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(false);
    const frozenTimeLeft = state.timeLeft;
    state = tick(state, 1);
    // 恢复后从冻结点精确推进一秒，时间线与新的剩余秒数一致
    expect(state.timeLeft).toBe(frozenTimeLeft - 1);
    expect(calculateTasksProgress(tasks, state.timeLeft, state.initialTime))
      .toEqual(calculateTasksProgress(tasks, frozenTimeLeft - 1, state.initialTime));
  });

  it('重置后所有任务回到未开始且剩余时间恢复满额', () => {
    let state = startTimer(createTimerState(20));
    state = tick(state, 700);
    state = resetTimer(state);
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.timeLeft).toBe(state.initialTime);
    const derived = assertTimelineMatches(state);
    // 与全新计时器的推导结果完全一致，无任务停留在旧状态
    expect(derived).toEqual(
      calculateTasksProgress(tasks, createTimerState(20).timeLeft, 20 * 60),
    );
    // 满额时刻首任务位于进行中起点，其余未开始，剩余时间均为满额
    expect(derived[0].status).toBe('active');
    expect(derived[1].status).toBe('pending');
    expect(derived[2].status).toBe('pending');
    for (const task of derived) {
      expect(task.progress).toBe(0);
      expect(task.remainingTime).toBe(task.duration * 60);
    }
  });

  it('修改总时长后整条时间线按新总时长重新推导', () => {
    let state = startTimer(createTimerState(20));
    state = tick(state, 400);
    state = setTimerMinutes(state, 30);
    expect(state.timeLeft).toBe(30 * 60);
    expect(state.initialTime).toBe(30 * 60);
    expect(state.isRunning).toBe(false);
    const derived = assertTimelineMatches(state);
    // 新总时长下整条时间线重新推导：首任务回到进行中起点，其余未开始，
    // 之前进行中的任务不会停留在旧状态
    expect(derived.map(t => t.status)).toEqual(['active', 'pending', 'pending']);
    expect(derived.every(t => t.progress === 0)).toBe(true);
    // 与全新状态机的推导结果完全一致
    expect(derived).toEqual(
      calculateTasksProgress(tasks, createTimerState(30).timeLeft, 30 * 60),
    );
  });

  it('剩余秒数为零时 start 不再生效', () => {
    const zero: TimerState = { isRunning: false, isPaused: false, timeLeft: 0, initialTime: 60 };
    const state = startTimer(zero);
    expect(state.isRunning).toBe(false);
    expect(state.timeLeft).toBe(0);
  });
});
