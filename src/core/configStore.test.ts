import { describe, it, expect } from 'vitest';
import {
  createConfigStore,
  serializeSnapshot,
  deserializeSnapshot,
  type StorageLike,
  type TimerSnapshot,
} from './configStore';
import type { Task, TimerState } from '../types';

function createMemoryStorage() {
  const data = new Map<string, string>();
  let writeCount = 0;
  const storage: StorageLike = {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      writeCount += 1;
      data.set(key, value);
    },
  };
  return { storage, getWriteCount: () => writeCount };
}

const pausedSnapshot = (): TimerSnapshot => ({
  state: {
    isRunning: false,
    isPaused: true,
    timeLeft: 730,
    initialTime: 1500,
  },
  tasks: [
    { id: '1', name: '导入', duration: 5 },
    { id: '2', name: '讲解', duration: 10 },
  ] as Task[],
});

describe('configStore', () => {
  it('连续修改总时长只在内容真正变化时写盘', () => {
    const { storage, getWriteCount } = createMemoryStorage();
    const store = createConfigStore(storage);
    const tasks: Task[] = [];
    const makeState = (minutes: number): TimerState => ({
      isRunning: false,
      isPaused: false,
      timeLeft: minutes * 60,
      initialTime: minutes * 60,
    });

    expect(store.save({ state: makeState(25), tasks })).toBe(true);
    expect(store.save({ state: makeState(25), tasks })).toBe(false);
    expect(store.save({ state: makeState(30), tasks })).toBe(true);
    expect(store.save({ state: makeState(30), tasks })).toBe(false);
    expect(store.save({ state: makeState(40), tasks })).toBe(true);
    expect(getWriteCount()).toBe(3);
  });

  it('恢复配置后暂停状态与剩余时间与保存时一致，且不会立即重写', () => {
    const { storage, getWriteCount } = createMemoryStorage();
    const writer = createConfigStore(storage);
    const snapshot = pausedSnapshot();
    expect(writer.save(snapshot)).toBe(true);
    const writesAfterSave = getWriteCount();

    const reader = createConfigStore(storage);
    const restored = reader.load(25);
    expect(restored).not.toBeNull();
    expect(restored!.state.isPaused).toBe(true);
    expect(restored!.state.isRunning).toBe(false);
    expect(restored!.state.timeLeft).toBe(730);
    expect(restored!.state.initialTime).toBe(1500);
    expect(restored!.tasks).toEqual(snapshot.tasks);

    expect(reader.save(restored!)).toBe(false);
    expect(getWriteCount()).toBe(writesAfterSave);
  });

  it('序列化-反序列化往返保持可观察状态稳定', () => {
    const snapshot = pausedSnapshot();
    const roundTripped = deserializeSnapshot(serializeSnapshot(snapshot), 25);
    expect(roundTripped).toEqual(snapshot);
    expect(serializeSnapshot(roundTripped!)).toBe(serializeSnapshot(snapshot));
  });

  it('旧格式（仅时长与任务）也能恢复为空闲状态', () => {
    const { storage } = createMemoryStorage();
    storage.setItem(
      'classroom-timer-config',
      JSON.stringify({ time: 30, tasks: [{ id: '1', name: '旧任务', duration: 5 }] }),
    );
    const store = createConfigStore(storage);
    const restored = store.load(25);
    expect(restored).not.toBeNull();
    expect(restored!.state).toEqual({
      isRunning: false,
      isPaused: false,
      timeLeft: 1800,
      initialTime: 1800,
    });
    expect(restored!.tasks).toHaveLength(1);
  });
});
