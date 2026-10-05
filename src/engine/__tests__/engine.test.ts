import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  adjudicate,
  createEventSet,
  derivationsEqual,
  fullDerive,
  incrementalDerive,
  sampleBurst,
  sampleConflicts,
  sampleEdgeBalanced,
} from '..';
import type { EngineParams, EventSet, StreamEvent } from '..';

function bumpParams(params: EngineParams, patch: Partial<EngineParams>): EngineParams {
  return { ...params, ...patch, version: params.version + 1 };
}

/** 同一样本分别走“逐区间重推”和“整体重推”，断言两条路径完全一致 */
function expectEquivalent(
  set0: EventSet,
  params0: EngineParams,
  set1: EventSet,
  params1: EngineParams,
) {
  const before = fullDerive(set0, params0);
  const incremental = incrementalDerive(set0, params0, before, set1, params1);
  const full = fullDerive(set1, params1);
  const verdict = derivationsEqual(full, incremental);
  expect(verdict.equal, verdict.reason).toBe(true);
  return { before, incremental, full };
}

describe('重复/冲突事件', () => {
  it('同一来源同一时刻的重复与冲突全部保留并标记待裁决，裁决前该区间不参与背压结论', () => {
    const set = createEventSet(sampleConflicts());
    expect(set.conflicts).toHaveLength(2);
    const dup = set.conflicts.find((g) => g.kind === 'duplicate')!;
    const conflict = set.conflicts.find((g) => g.kind === 'conflict')!;
    expect(dup.status).toBe('pending');
    expect(conflict.status).toBe('pending');
    // 双方均保留在事件集合中
    for (const id of [...dup.eventIds, ...conflict.eventIds]) {
      expect(set.events.some((e) => e.id === id)).toBe(true);
    }

    const result = fullDerive(set, DEFAULT_PARAMS);
    expect(result.disputedTicks).toEqual([15, 30]);
    // 待裁决区间不产生任何背压结论
    for (const decision of result.decisions) {
      expect(result.disputedTicks).not.toContain(decision.tick);
    }
    // 待裁决事件不计入积压：区间 15 的到达量只有正常事件的 9
    expect(result.curve[15].arrivals).toBe(9);
  });

  it('裁决后受影响区间结论的依据版本随之更新，且与整体重推一致', () => {
    const set0 = createEventSet(sampleConflicts());
    const before = fullDerive(set0, DEFAULT_PARAMS);
    const conflict = set0.conflicts.find((g) => g.kind === 'conflict')!;

    const set1 = adjudicate(set0, conflict.key, { type: 'keep', eventId: conflict.eventIds[1] });
    const { incremental, full } = expectEquivalent(set0, DEFAULT_PARAMS, set1, DEFAULT_PARAMS);

    // 裁决保留 size=20 的事件后，区间 30 的到达量变为 9+20
    expect(full.curve[30].arrivals).toBe(29);
    expect(full.disputedTicks).toEqual([15]);
    // 所有结论的依据都指向最新事件集版本，不存在“结论变了但依据还是旧的”
    for (const decision of incremental.decisions) {
      expect(decision.basis.eventsVersion).toBe(set1.version);
      expect(decision.explanation).toContain(`事件集 v${set1.version}`);
    }
    expect(before.basis.eventsVersion).toBe(set0.version);
  });

  it('重复组裁决为“都丢弃”后与整体重推一致', () => {
    const set0 = createEventSet(sampleConflicts());
    const dup = set0.conflicts.find((g) => g.kind === 'duplicate')!;
    const set1 = adjudicate(set0, dup.key, { type: 'dropAll' });
    expectEquivalent(set0, DEFAULT_PARAMS, set1, DEFAULT_PARAMS);
  });
});

describe('参数调整只重推受影响区间', () => {
  it('仅阈值变化：积压曲线一个区间都不重推，与调整前逐点一致', () => {
    const set = createEventSet(sampleBurst());
    const params1 = bumpParams(DEFAULT_PARAMS, { highThreshold: 25, lowThreshold: 5 });
    const { before, incremental } = expectEquivalent(set, DEFAULT_PARAMS, set, params1);

    expect(incremental.stats.rederivedTicks).toBe(0);
    expect(incremental.stats.reusedTicks).toBe(before.curve.length);
    expect(incremental.curve.map((p) => p.backlog)).toEqual(before.curve.map((p) => p.backlog));
    // 阈值变化后决策按新阈值重新判定
    expect(incremental.decisions.every((d) => d.basis.paramsVersion === params1.version)).toBe(true);
  });

  it('消费速率变化：与整体重推逐点一致', () => {
    const set = createEventSet(sampleBurst());
    const params1 = bumpParams(DEFAULT_PARAMS, { consumeRate: 14 });
    expectEquivalent(set, DEFAULT_PARAMS, set, params1);
  });

  it('突发上限变化：与整体重推逐点一致', () => {
    const set = createEventSet(sampleBurst());
    const params1 = bumpParams(DEFAULT_PARAMS, { burstLimit: 20 });
    expectEquivalent(set, DEFAULT_PARAMS, set, params1);
  });

  it('修正单个事件：受影响区间之前的曲线逐点不变', () => {
    const events0 = sampleBurst();
    const set0 = createEventSet(events0);
    const target = events0.find((e) => e.timestamp === 40_000)!;
    const events1 = events0.map((e) => (e.id === target.id ? { ...e, size: e.size + 50 } : e));
    const set1 = createEventSet(events1);

    const { before, incremental } = expectEquivalent(set0, DEFAULT_PARAMS, set1, DEFAULT_PARAMS);
    const affectedTick = 40;
    expect(incremental.stats.rederivedTicks).toBeLessThan(before.curve.length);
    for (let tick = 0; tick < affectedTick; tick += 1) {
      expect(incremental.curve[tick]).toEqual(before.curve[tick]);
    }
    expect(incremental.curve[affectedTick].backlog).not.toBe(before.curve[affectedTick].backlog);
  });
});

describe('背压判定可解释', () => {
  it('每条触发/解除结论都包含区间、阈值与当时积压', () => {
    const set = createEventSet(sampleBurst());
    const result = fullDerive(set, DEFAULT_PARAMS);
    expect(result.decisions.length).toBeGreaterThanOrEqual(2);

    const trigger = result.decisions.find((d) => d.type === 'trigger')!;
    expect(trigger.thresholdKind).toBe('high');
    expect(trigger.threshold).toBe(DEFAULT_PARAMS.highThreshold);
    expect(trigger.backlog).toBeGreaterThan(DEFAULT_PARAMS.highThreshold);
    expect(trigger.backlog).toBe(result.curve[trigger.tick].backlog);
    expect(trigger.explanation).toContain(`区间 #${trigger.tick}`);
    expect(trigger.explanation).toContain(`highThreshold=${DEFAULT_PARAMS.highThreshold}`);
    expect(trigger.explanation).toContain(`积压 ${trigger.backlog}`);

    const release = result.decisions.find((d) => d.type === 'release')!;
    expect(release.thresholdKind).toBe('low');
    expect(release.backlog).toBeLessThanOrEqual(DEFAULT_PARAMS.lowThreshold);
    expect(release.tick).toBeGreaterThan(trigger.tick);
  });
});

describe('参数边界', () => {
  it('消费速率等于到达速率：积压恒为 0，不触发背压', () => {
    const set = createEventSet(sampleEdgeBalanced());
    const result = fullDerive(set, DEFAULT_PARAMS);
    expect(result.curve.every((p) => p.backlog === 0)).toBe(true);
    expect(result.decisions).toHaveLength(0);
  });

  it('消费速率为 0：积压单调累积且与整体重推一致', () => {
    const set = createEventSet(sampleBurst());
    const params0 = bumpParams(DEFAULT_PARAMS, { consumeRate: 0 });
    const result = fullDerive(set, params0);
    for (let i = 1; i < result.curve.length; i += 1) {
      expect(result.curve[i].backlog).toBeGreaterThanOrEqual(result.curve[i - 1].backlog);
    }
    const params1 = bumpParams(params0, { consumeRate: 12 });
    expectEquivalent(set, params0, set, params1);
  });

  it('触发阈值为 0：出现任何正积压立即触发；解除阈值为 0：积压清空才解除', () => {
    const set = createEventSet(sampleBurst());
    const params = bumpParams(DEFAULT_PARAMS, { highThreshold: 0, lowThreshold: 0 });
    const result = fullDerive(set, params);
    const trigger = result.decisions.find((d) => d.type === 'trigger')!;
    const firstPositive = result.curve.find((p) => p.backlog > 0)!;
    expect(trigger.tick).toBe(firstPositive.tick);
    const release = result.decisions.find((d) => d.type === 'release')!;
    expect(result.curve[release.tick].backlog).toBe(0);
  });

  it('阈值极大：永不触发背压', () => {
    const set = createEventSet(sampleBurst());
    const params = bumpParams(DEFAULT_PARAMS, { highThreshold: Number.MAX_SAFE_INTEGER });
    const result = fullDerive(set, params);
    expect(result.decisions).toHaveLength(0);
    expect(result.curve.every((p) => !p.bpActive)).toBe(true);
  });

  it('突发上限：超出部分顺延到后续区间，总量守恒', () => {
    const events: StreamEvent[] = [
      { id: 'b1', source: 's', timestamp: 0, size: 100 },
    ];
    const set = createEventSet(events);
    const params = bumpParams(DEFAULT_PARAMS, { burstLimit: 30, consumeRate: 0, highThreshold: Number.MAX_SAFE_INTEGER });
    const result = fullDerive(set, params);
    expect(result.curve[0].arrivals).toBe(30);
    expect(result.curve[0].spilledOut).toBe(70);
    expect(result.curve[1].arrivals).toBe(30);
    expect(result.curve[2].arrivals).toBe(30);
    expect(result.curve[3].arrivals).toBe(10);
    const total = result.curve.reduce((sum, p) => sum + p.arrivals, 0);
    expect(total).toBe(100);
  });
});

describe('逐区间重推 vs 整体重推（全样本回归）', () => {
  const scenarios: [string, (p: EngineParams) => Partial<EngineParams>][] = [
    ['阈值调整', () => ({ highThreshold: 20, lowThreshold: 4 })],
    ['消费速率上调', () => ({ consumeRate: 16 })],
    ['消费速率下调', () => ({ consumeRate: 6 })],
    ['突发上限收紧', () => ({ burstLimit: 15 })],
    ['区间长度变化', () => ({ tickMs: 500 })],
    ['组合调整', () => ({ consumeRate: 12, highThreshold: 30, burstLimit: 25 })],
  ];

  for (const [name, patch] of scenarios) {
    it(`样本A（突发）：${name}`, () => {
      const set = createEventSet(sampleBurst());
      expectEquivalent(set, DEFAULT_PARAMS, set, bumpParams(DEFAULT_PARAMS, patch(DEFAULT_PARAMS)));
    });
    it(`样本B（重复冲突）：${name}`, () => {
      const set = createEventSet(sampleConflicts());
      expectEquivalent(set, DEFAULT_PARAMS, set, bumpParams(DEFAULT_PARAMS, patch(DEFAULT_PARAMS)));
    });
    it(`样本C（速率持平）：${name}`, () => {
      const set = createEventSet(sampleEdgeBalanced());
      expectEquivalent(set, DEFAULT_PARAMS, set, bumpParams(DEFAULT_PARAMS, patch(DEFAULT_PARAMS)));
    });
  }

  it('连续多次调整：每次增量结果都与整体重推一致', () => {
    let set = createEventSet(sampleConflicts());
    let params = DEFAULT_PARAMS;
    let result = fullDerive(set, params);

    const mutations: Array<() => void> = [
      () => { params = bumpParams(params, { consumeRate: 7 }); },
      () => {
        const conflict = set.conflicts.find((g) => g.kind === 'conflict')!;
        set = adjudicate(set, conflict.key, { type: 'keepAll' });
      },
      () => { params = bumpParams(params, { highThreshold: 15 }); },
      () => {
        const dup = set.conflicts.find((g) => g.kind === 'duplicate')!;
        set = adjudicate(set, dup.key, { type: 'keep', eventId: dup.eventIds[0] });
      },
      () => { params = bumpParams(params, { burstLimit: 12, consumeRate: 9 }); },
    ];

    for (const mutate of mutations) {
      const prevSet = set;
      const prevParams = params;
      const prevResult = result;
      mutate();
      result = incrementalDerive(prevSet, prevParams, prevResult, set, params);
      const verdict = derivationsEqual(fullDerive(set, params), result);
      expect(verdict.equal, verdict.reason).toBe(true);
    }
  });
});
