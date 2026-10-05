import { describe, expect, it } from 'vitest';
import { BackpressureEngine } from '../engine';
import { generateEvents, makeConflictPair, makeDuplicatePair } from '../sampleData';
import { assertSamePath } from './helpers';

/** 验收核心：同一批事件，"逐区间重推"与"整体重推"必须完全一致 */
describe('增量路径 vs 整体路径 一致性', () => {
  it('初始摄入后两条路径逐点一致', () => {
    const inc = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    const events = generateEvents();
    inc.store.ingest(events);
    const incr = inc.compute();
    const full = inc.fullRecompute();
    assertSamePath(incr, full, '初始摄入');
    expect(incr.curve.length).toBeGreaterThan(0);
  });

  it('调整消费速率后：受影响区间一致，未受影响区间不变', () => {
    const events = generateEvents();
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(events);
    const before = engine.compute();
    const beforeFull = engine.fullRecompute();
    assertSamePath(before, beforeFull, '调整前');

    // 调整时刻对齐到某个事件时刻（即已有区间边界），避免区间被切分
    const changeAt = events[30].time;
    engine.setParams({ consumeRate: 9, threshold: 25, burstLimit: 30 }, changeAt);
    const after = engine.compute();
    const afterFull = engine.fullRecompute();
    assertSamePath(after, afterFull, '调整消费速率');

    // 调整点之前的区间（含其曲线与决策）必须与调整前逐点一致
    const untouchedBefore = before.intervals.filter((r) => r.end <= changeAt);
    const untouchedAfter = after.intervals.filter((r) => r.end <= changeAt);
    expect(untouchedAfter.length).toBe(untouchedBefore.length);
    for (let i = 0; i < untouchedAfter.length; i++) {
      expect(untouchedAfter[i].carryOut).toBe(untouchedBefore[i].carryOut);
      expect(untouchedAfter[i].peak).toBe(untouchedBefore[i].peak);
      expect(JSON.stringify(untouchedAfter[i].decisions)).toBe(
        JSON.stringify(untouchedBefore[i].decisions),
      );
    }
  });

  it('调整阈值后两条路径的触发/解除时刻完全一致', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    engine.setParams({ consumeRate: 6, threshold: 15, burstLimit: 30 }, 10);
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '调整阈值');
    const triggerTimes = incr.decisions.filter((d) => d.kind === 'trigger').map((d) => d.time);
    expect(triggerTimes.length).toBeGreaterThan(0);
  });

  it('调整突发上限后突发判定一致', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    engine.setParams({ consumeRate: 6, threshold: 25, burstLimit: 5 }, 0);
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '调整突发上限');
    expect(incr.decisions.some((d) => d.kind === 'burst')).toBe(true);
  });

  it('存在待裁决冲突时两条路径一致，且结论暂缓', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.store.ingest(makeConflictPair('sensor-a', 45));
    engine.store.ingest(makeDuplicatePair('sensor-b', 60));
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '待裁决状态');
    expect(incr.intervals.find((r) => r.start === 45)?.withheld).toBe(true);
    expect(incr.intervals.find((r) => r.start === 60)?.withheld).toBe(true);
  });

  it('裁决冲突后两条路径一致', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.store.ingest(makeConflictPair('sensor-a', 45));
    engine.compute();
    engine.store.adjudicate('sensor-a@45', 'c-2');
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '裁决后');
  });

  it('修正事件体积后两条路径一致', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    engine.store.correctEvent('e0', { size: 50 });
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '修正事件后');
  });

  it('多次混合调整后两条路径仍然完全一致', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    engine.setParams({ consumeRate: 10, threshold: 20, burstLimit: 8 }, 20);
    engine.store.ingest(makeConflictPair('sensor-c', 70));
    engine.compute();
    engine.store.adjudicate('sensor-c@70', 'c-1');
    engine.store.correctEvent('e5', { size: 40 });
    engine.setParams({ consumeRate: 4, threshold: 30, burstLimit: 50 }, 80);
    const incr = engine.compute();
    const full = engine.fullRecompute();
    assertSamePath(incr, full, '多次混合调整');
  });
});
