import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Task, TimerState } from '../src/types';
import {
  createInitialState,
  startTimer,
  pauseTimer,
  resetTimer,
  tickTimer,
  setDuration,
  restoreTimerState,
  deriveTasksWithProgress,
  configFromState,
} from '../src/timerLogic';
import { createConfigStore, TIMER_STORAGE_KEY, type StorageLike } from '../src/persistence';

const tasks: Task[] = [
  { id: '1', name: '导入', duration: 5 },
  { id: '2', name: '讲解', duration: 10 },
  { id: '3', name: '练习', duration: 5 },
];

function advanceSeconds(state: TimerState, seconds: number): TimerState {
  let current = state;
  for (let i = 0; i < seconds; i++) {
    current = tickTimer(current).state;
  }
  return current;
}

function createMockStorage(): StorageLike & { writes: number; dump: () => string | null } {
  const data = new Map<string, string>();
  let writes = 0;
  return {
    getItem: key => data.has(key) ? data.get(key)! : null,
    setItem: (key, value) => {
      data.set(key, value);
      writes += 1;
    },
    get writes() {
      return writes;
    },
    dump: () => data.get(TIMER_STORAGE_KEY) ?? null,
  };
}

describe('计时状态机：非空闲状态下总时长不可修改', () => {
  it('运行中调用 setDuration 不改变任何状态', () => {
    const running = startTimer(createInitialState(25));
    expect(running.isRunning).toBe(true);
    const rejected = setDuration(running, 30);
    expect(rejected).toBe(running);
    expect(rejected.initialTime).toBe(1500);
    expect(rejected.timeLeft).toBe(1500);
  });

  it('暂停中调用 setDuration 不改变任何状态', () => {
    const paused = pauseTimer(startTimer(createInitialState(25)));
    const rejected = setDuration(paused, 30);
    expect(rejected).toBe(paused);
    expect(rejected.isPaused).toBe(true);
    expect(rejected.initialTime).toBe(1500);
    expect(rejected.timeLeft).toBe(1500);
  });

  it('空闲状态下 setDuration 才生效', () => {
    const idle = createInitialState(25);
    const changed = setDuration(idle, 30);
    expect(changed.initialTime).toBe(1800);
    expect(changed.timeLeft).toBe(1800);
    expect(changed.isRunning).toBe(false);
    expect(changed.isPaused).toBe(false);
  });
});

describe('暂停后（即使入口尝试改总时长）再继续，任务进度与状态不跳变', () => {
  it('暂停期间的非法改时长被忽略，继续后进度按秒连续推进', () => {
    let state = startTimer(createInitialState(25));
    state = advanceSeconds(state, 5 * 60 + 30);

    const paused = pauseTimer(state);
    expect(paused.isPaused).toBe(true);
    expect(paused.timeLeft).toBe(1170);

    const before = deriveTasksWithProgress(tasks, paused.timeLeft, paused.initialTime);
    const statusesBefore = before.map(t => t.status);
    expect(statusesBefore).toEqual(['completed', 'active', 'pending']);
    expect(before[1].remainingTime).toBe(570);

    // 任意入口尝试在暂停时改总时长，状态机一律拒绝
    const rejected = setDuration(paused, 40);
    expect(rejected).toBe(paused);

    // 继续：剩余时间与时间线进度与暂停前完全衔接，仅推进 1 秒
    const resumed = startTimer(paused);
    const afterOneTick = tickTimer(resumed).state;
    const after = deriveTasksWithProgress(tasks, afterOneTick.timeLeft, afterOneTick.initialTime);

    expect(after.map(t => t.status)).toEqual(statusesBefore);
    expect(afterOneTick.timeLeft).toBe(1169);
    expect(after[1].remainingTime).toBe(before[1].remainingTime - 1);
    expect(after[1].progress - before[1].progress).toBeCloseTo((1 / 600) * 100, 5);
  });

  it('重置后任务时间线回到初始进度', () => {
    let state = startTimer(createInitialState(25));
    state = advanceSeconds(state, 600);
    state = resetTimer(state);
    const derived = deriveTasksWithProgress(tasks, state.timeLeft, state.initialTime);
    expect(state.timeLeft).toBe(state.initialTime);
    expect(derived.every(t => t.progress === 0)).toBe(true);
    expect(derived.map(t => t.remainingTime)).toEqual([300, 600, 300]);
  });
});

describe('持久化：只在真正需要时写盘', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('连续修改总时长合并为一次写盘，内容为最终值', () => {
    const storage = createMockStorage();
    const store = createConfigStore(storage);

    let timerState = createInitialState(25);
    timerState = setDuration(timerState, 26);
    store.save(configFromState(timerState, tasks));
    timerState = setDuration(timerState, 27);
    store.save(configFromState(timerState, tasks));
    timerState = setDuration(timerState, 28);
    store.save(configFromState(timerState, tasks));

    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(200);
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.dump()!).time).toBe(28);
  });

  it('重复保存同一份配置不写盘，恢复配置本身也不触发回写', () => {
    const storage = createMockStorage();
    const store = createConfigStore(storage);

    const paused = pauseTimer(advanceSeconds(startTimer(createInitialState(25)), 100));
    const config = configFromState(paused, tasks);
    store.save(config);
    vi.advanceTimersByTime(200);
    expect(storage.writes).toBe(1);

    store.save(config);
    vi.advanceTimersByTime(200);
    expect(storage.writes).toBe(1);

    // 模拟刷新页面：load 标记已保存内容，随后恢复流程回存相同快照被去重
    const reloadedStore = createConfigStore(storage);
    expect(reloadedStore.load()).not.toBeNull();
    reloadedStore.save(config);
    vi.advanceTimersByTime(200);
    expect(storage.writes).toBe(1);
  });
});

describe('恢复配置后暂停状态与剩余时间与保存时一致', () => {
  it('保存暂停现场 -> 重新加载 -> 还原出相同的可观察状态', () => {
    const storage = createMockStorage();
    const store = createConfigStore(storage);

    let state = startTimer(createInitialState(25));
    state = advanceSeconds(state, 237);
    state = pauseTimer(state);
    expect(state.isPaused).toBe(true);
    expect(state.timeLeft).toBe(1263);

    const config = configFromState(state, tasks);
    store.save(config);
    expect(store.flush()).toBe(true);

    // 模拟重新打开应用
    const reloadedStore = createConfigStore(storage);
    const loaded = reloadedStore.load();
    expect(loaded).not.toBeNull();
    const restored = restoreTimerState(loaded!, 25);

    expect(restored.isPaused).toBe(true);
    expect(restored.isRunning).toBe(false);
    expect(restored.timeLeft).toBe(1263);
    expect(restored.initialTime).toBe(1500);

    const before = deriveTasksWithProgress(tasks, state.timeLeft, state.initialTime);
    const after = deriveTasksWithProgress(tasks, restored.timeLeft, restored.initialTime);
    expect(after).toEqual(before);
  });

  it('旧版本配置（无暂停/剩余字段）按初始时长完整恢复', () => {
    const storage = createMockStorage();
    storage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({ time: 20, tasks: [] })
    );
    const loaded = createConfigStore(storage).load()!;
    const restored = restoreTimerState(loaded, 25);
    expect(restored.isPaused).toBe(false);
    expect(restored.timeLeft).toBe(1200);
    expect(restored.initialTime).toBe(1200);
  });
});

describe('倒计时结束', () => {
  it('最后一秒 tick 后归零、停止运行并标记 finished（提示音在 hook 中触发）', () => {
    let state = startTimer({ isRunning: true, isPaused: false, timeLeft: 1, initialTime: 10 });
    const result = tickTimer(state);
    expect(result.finished).toBe(true);
    expect(result.state.timeLeft).toBe(0);
    expect(result.state.isRunning).toBe(false);
    expect(result.state.isPaused).toBe(false);
  });
});
