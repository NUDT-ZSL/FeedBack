import { describe, expect, it } from 'vitest';
import { BackpressureEngine } from '../engine';
import { assertSamePath } from './helpers';

const build = (params: Parameters<BackpressureEngine['setParams']> extends never ? never : { consumeRate: number; threshold: number; burstLimit: number }, events: Array<{ time: number; size: number }>) => {
  const engine = new BackpressureEngine(params);
  engine.store.ingest(
    events.map((e, i) => ({ id: `e${i}`, source: 's', time: e.time, size: e.size, payload: `p${i}` })),
  );
  return engine;
};

/** 参数边界：消费速率等于/高于到达速率、速率为零、阈值为零/极大、突发上限为零 */
describe('参数边界条件', () => {
  it('消费速率等于到达速率：无积压、不触发背压', () => {
    // 每 10 秒到达 10，速率 1/s：稳态积压为零
    const engine = build(
      { consumeRate: 1, threshold: 100, burstLimit: 100 },
      [10, 20, 30].map((t) => ({ time: t, size: 10 })),
    );
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '速率等于到达速率');
    expect(result.currentBacklog).toBe(0);
    expect(result.decisions.filter((d) => d.kind === 'trigger')).toHaveLength(0);
    // 每个事件在下一事件到来前恰好被消费完
    const peaks = result.intervals.map((r) => r.peak);
    expect(peaks).toContain(10);
    expect(Math.max(...peaks)).toBe(10);
  });

  it('消费速率高于到达速率：同样无积压', () => {
    const engine = build(
      { consumeRate: 10, threshold: 100, burstLimit: 100 },
      [0, 5, 10].map((t) => ({ time: t, size: 10 })),
    );
    const result = engine.compute();
    expect(result.currentBacklog).toBe(0);
    expect(result.decisions.filter((d) => d.kind === 'trigger')).toHaveLength(0);
  });

  it('消费速率为零：积压只增不减，触发后永不解除', () => {
    const engine = build(
      { consumeRate: 0, threshold: 5, burstLimit: 100 },
      [{ time: 0, size: 3 }, { time: 10, size: 4 }],
    );
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '速率为零');
    expect(result.currentBacklog).toBe(7);
    const triggers = result.decisions.filter((d) => d.kind === 'trigger');
    const releases = result.decisions.filter((d) => d.kind === 'release');
    expect(triggers.length).toBe(1);
    expect(releases).toHaveLength(0);
  });

  it('阈值为零：任何积压即触发，排空到零时解除', () => {
    const engine = build(
      { consumeRate: 2, threshold: 0, burstLimit: 100 },
      [{ time: 0, size: 4 }],
    );
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '阈值为零');
    const trigger = result.decisions.find((d) => d.kind === 'trigger');
    const release = result.decisions.find((d) => d.kind === 'release');
    expect(trigger).toBeDefined();
    expect(trigger!.time).toBe(0);
    expect(release).toBeDefined();
    expect(release!.time).toBe(2);
    expect(result.currentBacklog).toBe(0);
  });

  it('阈值极大：永不触发', () => {
    const engine = build(
      { consumeRate: 1, threshold: Number.MAX_SAFE_INTEGER, burstLimit: Number.MAX_SAFE_INTEGER },
      [{ time: 0, size: 999999 }],
    );
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '阈值极大');
    expect(result.decisions).toHaveLength(0);
    expect(Math.max(...result.intervals.map((r) => r.peak))).toBe(999999);
  });

  it('突发上限为零：任何到达都判突发，但触发/解除仍按阈值独立判定', () => {
    const engine = build(
      { consumeRate: 1, threshold: 5, burstLimit: 0 },
      [{ time: 0, size: 3 }],
    );
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '突发上限为零');
    const burst = result.decisions.find((d) => d.kind === 'burst');
    expect(burst).toBeDefined();
    expect(burst!.rule).toBe('burst-limit-exceeded');
    expect(burst!.backlog).toBe(3);
    // size 3 未超阈值 5：不触发背压
    expect(result.decisions.filter((d) => d.kind === 'trigger')).toHaveLength(0);
  });

  it('积压恰好等于阈值：不触发（严格大于），回落至阈值时解除', () => {
    const engine = build(
      { consumeRate: 1, threshold: 5, burstLimit: 100 },
      [{ time: 0, size: 5 }, { time: 10, size: 6 }],
    );
    const result = engine.compute();
    // 第一次到达恰好等于阈值，不触发；第二次超过才触发
    const triggers = result.decisions.filter((d) => d.kind === 'trigger');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].time).toBe(10);
  });

  it('参数在事件中间切换（速率提高）：切换时刻被切分为区间边界', () => {
    const engine = build(
      { consumeRate: 1, threshold: 100, burstLimit: 100 },
      [{ time: 0, size: 10 }, { time: 10, size: 10 }],
    );
    engine.compute();
    engine.setParams({ consumeRate: 5, threshold: 100, burstLimit: 100 }, 5);
    const result = engine.compute();
    assertSamePath(result, engine.fullRecompute(), '中途提速');
    const starts = result.intervals.map((r) => r.start);
    expect(starts).toContain(5);
  });
});
