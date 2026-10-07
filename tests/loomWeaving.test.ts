/**
 * 织造推进链路验证：
 * - 连续投梭达到目标长度后，完成只触发一次，长度冻结
 * - 织造过程中调整目标长度，完成判定以调整后目标为准
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Loom } from '../src/Loom';
import {
  advance,
  finishShuttle,
  weaveToCompletion,
  FABRIC_COMPLETE_DELAY_MS,
} from './helpers/animation';

describe('织造推进', () => {
  let loom: Loom;
  let completeCount: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    loom = new Loom();
    completeCount = 0;
    loom.onFabricComplete = () => {
      completeCount += 1;
    };
  });

  afterEach(() => {
    loom.dispose();
    vi.useRealTimers();
  });

  it('连续投梭达到目标长度后，完成恰好触发一次且长度冻结', () => {
    loom.setTargetLength(10);
    const shuttles = weaveToCompletion(loom);

    expect(shuttles).toBe(5);
    expect(loom.state.fabricLength).toBe(10);
    expect(completeCount).toBe(1);

    // 完成后继续投梭：被拒绝，长度不变，完成不重复触发
    expect(loom.fireShuttle()).toBe(false);
    finishShuttle(loom);
    advance(FABRIC_COMPLETE_DELAY_MS * 4);
    loom.update(1 / 60);

    expect(loom.state.fabricLength).toBe(10);
    expect(loom.state.weftThreads.length).toBe(5);
    expect(completeCount).toBe(1);
  });

  it('投梭飞行中不允许重复投梭', () => {
    expect(loom.fireShuttle()).toBe(true);
    expect(loom.fireShuttle()).toBe(false);
    expect(loom.state.isShuttling).toBe(true);
    finishShuttle(loom);
    expect(loom.state.isShuttling).toBe(false);
    expect(loom.fireShuttle()).toBe(true);
  });

  it('织造途中调高目标长度：不按旧目标提前完成，织到新目标后完成一次', () => {
    loom.setTargetLength(10);
    for (let i = 0; i < 5; i++) {
      expect(loom.fireShuttle()).toBe(true);
      finishShuttle(loom);
    }
    expect(loom.state.fabricLength).toBe(10);

    // 完成回调等待期内调高目标
    loom.setTargetLength(30);
    advance(FABRIC_COMPLETE_DELAY_MS * 4);
    loom.update(1 / 60);
    expect(completeCount).toBe(0);

    // 继续织造到新目标
    for (let i = 0; i < 10; i++) {
      expect(loom.fireShuttle()).toBe(true);
      finishShuttle(loom);
    }
    expect(loom.state.fabricLength).toBe(30);
    advance(FABRIC_COMPLETE_DELAY_MS + 1);
    expect(completeCount).toBe(1);

    // 之后不再触发
    advance(FABRIC_COMPLETE_DELAY_MS * 10);
    expect(completeCount).toBe(1);
  });

  it('织造途中调低目标长度到当前长度：立即按新目标完成一次', () => {
    loom.setTargetLength(30);
    for (let i = 0; i < 5; i++) {
      expect(loom.fireShuttle()).toBe(true);
      finishShuttle(loom);
    }
    expect(loom.state.fabricLength).toBe(10);

    loom.setTargetLength(10);
    advance(FABRIC_COMPLETE_DELAY_MS + 1);
    expect(completeCount).toBe(1);

    // 已完成后继续投梭被拒绝
    expect(loom.fireShuttle()).toBe(false);
    expect(loom.state.fabricLength).toBe(10);
  });

  it('完成回调等待期内目标上调后又调回：仍按最终目标完成一次', () => {
    loom.setTargetLength(10);
    for (let i = 0; i < 5; i++) {
      loom.fireShuttle();
      finishShuttle(loom);
    }
    loom.setTargetLength(50);
    loom.setTargetLength(10);
    advance(FABRIC_COMPLETE_DELAY_MS + 1);
    expect(completeCount).toBe(1);
    expect(loom.fireShuttle()).toBe(false);
  });

  it('目标长度取上下限时均可正常完成', () => {
    loom.setTargetLength(10);
    expect(loom.state.targetLength).toBe(10);
    expect(weaveToCompletion(loom)).toBe(5);
    expect(completeCount).toBe(1);

    const loom2 = new Loom();
    let count2 = 0;
    loom2.onFabricComplete = () => {
      count2 += 1;
    };
    loom2.setTargetLength(50);
    expect(loom2.state.targetLength).toBe(50);
    expect(weaveToCompletion(loom2)).toBe(25);
    expect(count2).toBe(1);
    expect(loom2.state.fabricLength).toBe(50);
    loom2.dispose();
  });

  it('批量重复：完整织造-完成流程可复现', () => {
    for (let round = 0; round < 5; round++) {
      const fresh = new Loom();
      let count = 0;
      fresh.onFabricComplete = () => {
        count += 1;
      };
      fresh.setTargetLength(10);
      expect(weaveToCompletion(fresh)).toBe(5);
      expect(count).toBe(1);
      expect(fresh.state.fabricLength).toBe(10);
      expect(fresh.fireShuttle()).toBe(false);
      fresh.dispose();
    }
  });
});
