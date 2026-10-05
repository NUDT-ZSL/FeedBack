import { describe, expect, it } from 'vitest';
import { BackpressureEngine } from '../engine';
import { generateEvents, makeConflictPair } from '../sampleData';
import { comparable } from './helpers';

/** 增量重推：只有受影响区间被重算，未受影响区间复用缓存且逐点一致 */
describe('逐区间增量重推', () => {
  it('未变更时所有区间均复用缓存，结论逐点不变', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    const first = engine.compute();
    const second = engine.compute();
    expect(second.intervals.every((r) => r.reusedFromCache)).toBe(true);
    // 曲线与决策逐点一致
    expect(JSON.stringify(second.curve)).toBe(JSON.stringify(first.curve));
    expect(JSON.stringify(second.decisions)).toBe(JSON.stringify(first.decisions));
  });

  it('只调整靠后的参数：之前区间全部复用，之后区间重算', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    const boundary = 60;
    engine.setParams({ consumeRate: 12, threshold: 25, burstLimit: 30 }, boundary);
    const result = engine.compute();
    const before = result.intervals.filter((r) => r.end <= boundary && r.start < boundary && r.end !== boundary || r.end < boundary);
    const strictlyBefore = result.intervals.filter((r) => r.end <= boundary && result.intervals.some((x) => x.start === r.start && x.end === r.end));
    void strictlyBefore;
    void before;
    // 60s 之前且未被切分的区间（终点 < 60）必须全部复用
    const untainted = result.intervals.filter((r) => r.end < boundary);
    expect(untainted.length).toBeGreaterThan(0);
    expect(untainted.every((r) => r.reusedFromCache)).toBe(true);
    const from = result.intervals.findIndex((r) => r.start >= boundary);
    expect(before.every((r) => r.reusedFromCache)).toBe(true);
    expect(result.intervals[from].reusedFromCache).toBe(false);
  });

  it('修正靠前事件：该区间起重算；后续若携带状态恰好一致则恢复复用', () => {
    const engine = new BackpressureEngine({ consumeRate: 20, threshold: 1000, burstLimit: 10000 });
    engine.store.ingest(generateEvents());
    engine.compute();
    // 速率足够大，所有区间 carryOut 均为 0：靠前修正的影响消退后，后续区间恢复复用
    engine.store.correctEvent('e0', { size: 1 });
    const result = engine.compute();
    const t0 = engine.store.getEvent('e0')!.time;
    const hit = result.intervals.find((r) => r.start === t0)!;
    expect(hit.reusedFromCache).toBe(false);
    // 影响区间之后的区间重新回到 carry=0 状态，被复用
    const laterReused = result.intervals.slice(2).some((r) => r.reusedFromCache);
    expect(laterReused).toBe(true);
  });

  it('新冲突使区间暂缓：该区间重算，裁决后再次重算且依据版本更新', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    engine.compute();
    engine.store.ingest(makeConflictPair('sensor-a', 45));
    const pendingResult = engine.compute();
    const tainted = pendingResult.intervals.find((r) => r.start === 45)!;
    expect(tainted.reusedFromCache).toBe(false);
    expect(tainted.withheld).toBe(true);

    engine.store.adjudicate('sensor-a@45', 'c-1');
    const resolvedResult = engine.compute();
    const resolved = resolvedResult.intervals.find((r) => r.start === 45)!;
    expect(resolved.withheld).toBe(false);
    expect(resolved.basis.eventVersion).toBe(resolvedResult.eventVersion);
    for (const d of resolved.decisions) {
      expect(d.basis.eventVersion).toBe(resolvedResult.eventVersion);
    }
  });

  it('重算结果与整体重推在多轮调整后仍逐点一致（端到端回归）', () => {
    const engine = new BackpressureEngine({ consumeRate: 6, threshold: 25, burstLimit: 30 });
    engine.store.ingest(generateEvents());
    const check = () => {
      const a = JSON.stringify(comparable(engine.compute()));
      const b = JSON.stringify(comparable(engine.fullRecompute()));
      expect(a).toBe(b);
    };
    check();
    engine.setParams({ consumeRate: 8, threshold: 20, burstLimit: 12 }, 25);
    check();
    engine.store.ingest(makeConflictPair('sensor-b', 55));
    check();
    engine.store.adjudicate('sensor-b@55', 'c-2');
    check();
    engine.store.correctEvent('e10', { size: 60 });
    check();
    engine.setParams({ consumeRate: 3, threshold: 40, burstLimit: 50 }, 90);
    check();
  });
});
