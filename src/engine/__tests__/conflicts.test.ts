import { describe, expect, it } from 'vitest';
import { BackpressureEngine } from '../engine';
import { generateEvents, makeConflictPair, makeDuplicatePair } from '../sampleData';

/** 重复/冲突事件：保留双方、标记待裁决、裁决前不参与结论、裁决后依据可追溯 */
describe('重复与冲突事件处理', () => {
  it('同源同时刻事件双方保留并标记待裁决，绝不静默丢弃', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(makeConflictPair('sensor-a', 45));
    const groups = engine.store.pendingGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('conflict');
    expect(groups[0].events).toHaveLength(2);
    expect(groups[0].status).toBe('pending');
  });

  it('内容完全一致时标记为重复（duplicate）', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(makeDuplicatePair('sensor-b', 60));
    const groups = engine.store.pendingGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('duplicate');
  });

  it('待裁决区间不参与背压结论，且其到达量不计入积压', () => {
    const engine = new BackpressureEngine({ consumeRate: 1, threshold: 5, burstLimit: 100 });
    engine.store.ingest(makeConflictPair('sensor-a', 10));
    const result = engine.compute();
    const tainted = result.intervals.find((r) => r.start === 10);
    expect(tainted).toBeDefined();
    expect(tainted!.tainted).toBe(true);
    expect(tainted!.withheld).toBe(true);
    expect(tainted!.decisions).toHaveLength(0);
    expect(tainted!.arrivals).toBe(0);
    expect(tainted!.excludedArrivals).toBe(12 + 30);
    // 裁决前积压为零：冲突事件不参与推算
    expect(result.currentBacklog).toBe(0);
  });

  it('裁决后事件生效，受影响区间结论更新且依据版本可追溯', () => {
    const engine = new BackpressureEngine({ consumeRate: 1, threshold: 5, burstLimit: 100 });
    engine.store.ingest(makeConflictPair('sensor-a', 10));
    const before = engine.compute();
    const versionBefore = before.eventVersion;
    expect(before.decisions).toHaveLength(0);

    engine.store.adjudicate('sensor-a@10', 'c-2');
    const after = engine.compute();
    expect(after.eventVersion).toBeGreaterThan(versionBefore);

    const resolved = after.intervals.find((r) => r.start === 10);
    expect(resolved!.withheld).toBe(false);
    expect(resolved!.arrivals).toBe(30);
    // 裁决后结论必须基于新的事件版本，不允许"结论变了依据还是旧的"
    const trigger = after.decisions.find((d) => d.kind === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger!.basis.eventVersion).toBe(after.eventVersion);
    expect(trigger!.explanation).toContain('30');
    expect(trigger!.explanation).toContain('阈值 5');
  });

  it('修正事件后受影响区间结论的依据同步更新', () => {
    const engine = new BackpressureEngine({ consumeRate: 1, threshold: 5, burstLimit: 100 });
    engine.store.ingest([
      { id: 'x1', source: 's', time: 4, size: 3, payload: 'p' },
    ]);
    const before = engine.compute();
    expect(before.decisions.filter((d) => d.kind === 'trigger')).toHaveLength(0);

    engine.store.correctEvent('x1', { size: 20 });
    const after = engine.compute();
    const trigger = after.decisions.find((d) => d.kind === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger!.basis.eventVersion).toBe(after.eventVersion);
    expect(trigger!.basis.eventVersion).toBeGreaterThan(before.eventVersion);
    expect(trigger!.explanation).toContain('20');
  });

  it('冲突事件不影响积压峰值的正确性：裁决哪条就按哪条算', () => {
    const engine = new BackpressureEngine({ consumeRate: 1, threshold: 100, burstLimit: 100 });
    engine.store.ingest(makeConflictPair('sensor-a', 10));
    engine.store.adjudicate('sensor-a@10', 'c-1');
    const r1 = engine.compute();
    expect(r1.intervals.find((r) => r.start === 10)!.peak).toBe(12);

    const engine2 = new BackpressureEngine({ consumeRate: 1, threshold: 100, burstLimit: 100 });
    engine2.store.ingest(makeConflictPair('sensor-a', 10));
    engine2.store.adjudicate('sensor-a@10', 'c-2');
    const r2 = engine2.compute();
    expect(r2.intervals.find((r) => r.start === 10)!.peak).toBe(30);
  });

  it('同一事件集合上的样本摄入与冲突共存时行为确定', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.store.ingest(makeDuplicatePair('sensor-b', 60));
    const result = engine.compute();
    const tainted = result.intervals.filter((r) => r.tainted);
    expect(tainted).toHaveLength(1);
    expect(tainted[0].start).toBe(60);
    // 其余区间不受影响，结论照常给出
    const others = result.intervals.filter((r) => !r.tainted);
    expect(others.every((r) => !r.withheld)).toBe(true);
  });
});
