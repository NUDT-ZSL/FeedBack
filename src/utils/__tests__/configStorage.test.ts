import { describe, it, expect } from 'vitest';
import { serializeConfig, parseConfig } from '../configStorage';
import { calculateTasksProgress } from '../taskProgress';
import { createTimerState, setTimerMinutes } from '../timerState';
import { makeTasks } from './helpers';

describe('配置持久化与重新加载后的推导一致性', () => {
  it('保存再加载后，相同剩余秒数下的时间线推导结果完全一致', () => {
    const tasks = makeTasks([5, 10, 5]);
    const initialSeconds = 20 * 60;

    // 保存（时间戳注入固定值，测试不依赖真实时钟）
    const json = serializeConfig(initialSeconds, tasks, 1727000000000);

    // 重新加载并恢复计时器状态
    const loaded = parseConfig(json, 25);
    expect(loaded).not.toBeNull();
    expect(loaded!.time).toBe(20);
    expect(loaded!.tasks).toEqual(tasks);

    const restored = setTimerMinutes(createTimerState(25), loaded!.time);
    expect(restored.initialTime).toBe(initialSeconds);

    // 恢复出的任务与总时长在每一秒上的推导结果都与保存前一致
    for (let timeLeft = initialSeconds; timeLeft >= 0; timeLeft -= 37) {
      expect(calculateTasksProgress(loaded!.tasks, timeLeft, restored.initialTime))
        .toEqual(calculateTasksProgress(tasks, timeLeft, initialSeconds));
    }
  });

  it('序列化格式与字段语义保持稳定', () => {
    const tasks = makeTasks([5]);
    const parsed = JSON.parse(serializeConfig(90, tasks, 123));
    expect(parsed.time).toBe(1.5); // 秒 -> 分钟
    expect(parsed.tasks).toEqual(tasks);
    expect(parsed.timestamp).toBe(123);
  });

  it('无存储或数据损坏时返回 null，缺失字段回退默认值', () => {
    expect(parseConfig(null, 25)).toBeNull();
    expect(parseConfig('{not json', 25)).toBeNull();
    expect(parseConfig('{}', 25)).toEqual({ time: 25, tasks: [] });
    // 损坏后回退默认配置时，推导仍然自洽
    const fallback = parseConfig('{not json', 25);
    expect(fallback).toBeNull();
    const restored = parseConfig('{}', 25)!;
    const state = setTimerMinutes(createTimerState(25), restored.time);
    expect(calculateTasksProgress(restored.tasks, state.timeLeft, state.initialTime))
      .toEqual([]);
  });
});
