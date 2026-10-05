import { describe, expect, it } from 'vitest';
import {
  applyChange,
  buildAcceptanceDataset,
  conflictKeyFor,
  deriveFull,
  type Adjudication,
  type Change,
  type DerivationInput,
  type DerivationState,
} from '..';

function conclusionsOf(state: DerivationState) {
  return new Map(state.conclusions.map((c) => [c.segmentId, c]));
}

/** 对任意变更断言：增量重推结果与整体重推逐条一致 */
function expectIncrementalMatchesFull(prev: DerivationState, change: Change) {
  const result = applyChange(prev, change);
  const full = deriveFull(result.input);
  expect(result.state.sortedIds).toEqual(full.sortedIds);
  expect(result.state.conclusions).toEqual(full.conclusions);
  expect(result.state.conflicts).toEqual(full.conflicts);
  expect(result.state.anomalies).toEqual(full.anomalies);
  return result;
}

describe('数据进入：异常保留而非静默择一', () => {
  const state = deriveFull(buildAcceptanceDataset());

  it('倒序时刻片段被保留并标记', () => {
    expect(state.segments.some((s) => s.id === 'S2')).toBe(true);
    expect(state.anomalies).toContainEqual({
      kind: 'reversed', segmentId: 'S2', startMs: 20_000, endMs: 18_000,
    });
  });

  it('重叠区间被标记且双方保留', () => {
    expect(state.anomalies).toContainEqual({ kind: 'overlap', segmentId: 'S5', otherSegmentId: 'S4' });
    expect(state.segments.some((s) => s.id === 'S4')).toBe(true);
    expect(state.segments.some((s) => s.id === 'S5')).toBe(true);
  });

  it('指向缺失片段的锚点被标记为悬空', () => {
    expect(state.anomalies).toContainEqual({ kind: 'dangling-anchor', anchorId: 'A3', segmentId: 'S_MISSING' });
  });

  it('矛盾来源片段双方保留并标记为待裁决，不静默择一', () => {
    const conflict = state.conflicts.find((c) => c.key === conflictKeyFor(30_000));
    expect(conflict).toBeDefined();
    expect(conflict!.status).toBe('pending');
    expect(conflict!.segmentIds.sort()).toEqual(['S3a', 'S3b']);
    // 双方都仍在片段集合与结论中，状态为待裁决
    const conclusions = conclusionsOf(state);
    expect(conclusions.get('S3a')!.status).toBe('pending-adjudication');
    expect(conclusions.get('S3b')!.status).toBe('pending-adjudication');
    expect(conclusions.get('S3a')!.offsetMs).toBeNull();
    // 待裁决片段不参与锚点/插值，但其余片段仍正常推导
    expect(conclusions.get('S4')!.status).toBe('derived');
  });
});

describe('偏移推导与漂移趋势', () => {
  const state = deriveFull(buildAcceptanceDataset());
  const conclusions = conclusionsOf(state);

  it('锚点处偏移与锚点声明一致', () => {
    expect(conclusions.get('S1')!.offsetMs).toBe(0); // A1: 10000 - 10000
    expect(conclusions.get('S4')!.offsetMs).toBe(500); // A2: 50500 - 50000
  });

  it('锚点间线性插值并给出漂移趋势', () => {
    // S2 位于 A1(0ms@10s) 与 A2(+500ms@50s) 之间：偏移 500*(20000-10000)/40000 = +125ms
    expect(conclusions.get('S2')!.offsetMs).toBe(125);
    expect(conclusions.get('S2')!.driftTrend).toBe('drifting-later');
    expect(conclusions.get('S2')!.driftSlopeMsPerSec).toBeCloseTo(12.5);
  });

  it('区间外沿用最近锚点偏移', () => {
    expect(conclusions.get('S6')!.offsetMs).toBe(500);
  });

  it('帧偏移按帧率换算', () => {
    expect(conclusions.get('S4')!.offsetFrames).toBe(13); // 500ms * 25fps = 12.5 -> 13
  });
});

describe('裁决后增量重推', () => {
  const initial = deriveFull(buildAcceptanceDataset());
  const adjudication: Adjudication = {
    id: 'ADJ-1',
    conflictKey: conflictKeyFor(30_000),
    winnerSegmentId: 'S3b',
    note: '人工校对文本为准',
  };

  it('只重推受影响区间，且与整体重推一致', () => {
    const result = expectIncrementalMatchesFull(initial, { type: 'adjudicate', adjudication });
    // 受影响的是冲突双方及其排序邻居，而不是全部片段
    expect(result.affectedIds).toContain('S3a');
    expect(result.affectedIds).toContain('S3b');
    expect(result.affectedIds.length).toBeLessThan(initial.sortedIds.length);
    // 未受影响片段沿用缓存结论（对象引用不变）
    const before = conclusionsOf(initial);
    const after = conclusionsOf(result.state);
    for (const id of initial.sortedIds) {
      if (!result.affectedIds.includes(id)) {
        expect(after.get(id)).toBe(before.get(id));
      }
    }
  });

  it('裁决后胜方参与推导、负方标记为排除，且结论可追溯到裁决记录', () => {
    const { state } = applyChange(initial, { type: 'adjudicate', adjudication });
    const conclusions = conclusionsOf(state);
    expect(conclusions.get('S3b')!.status).toBe('derived');
    expect(conclusions.get('S3b')!.offsetMs).toBe(250); // 与 S2 同区间插值
    expect(conclusions.get('S3a')!.status).toBe('excluded');
    expect(conclusions.get('S3b')!.basis!.adjudicationIds).toContain('ADJ-1');
    expect(conclusions.get('S3a')!.basis!.adjudicationIds).toContain('ADJ-1');
    expect(state.conflicts.find((c) => c.key === conflictKeyFor(30_000))!.status).toBe('resolved');
  });
});

describe('锚点/片段/帧率变更的增量重推', () => {
  const initial = deriveFull(buildAcceptanceDataset());

  it('锚点修正与整体重推一致', () => {
    const result = expectIncrementalMatchesFull(initial, {
      type: 'anchor-upsert',
      anchor: { id: 'A2', mediaTimeMs: 51_000, segmentId: 'S4' },
    });
    expect(result.affectedIds).toContain('S4');
    const conclusions = conclusionsOf(result.state);
    expect(conclusions.get('S4')!.offsetMs).toBe(1000);
    expect(conclusions.get('S6')!.offsetMs).toBe(1000);
  });

  it('多锚点场景下锚点修正只重推受影响区间，其余片段沿用缓存', () => {
    const input: DerivationInput = {
      media: { durationMs: 60_000, frameRate: 25 },
      anchors: [
        { id: 'K1', mediaTimeMs: 10_000, segmentId: 'K1S' },
        { id: 'K2', mediaTimeMs: 20_000, segmentId: 'K2S' },
        { id: 'K3', mediaTimeMs: 30_000, segmentId: 'K3S' },
        { id: 'K4', mediaTimeMs: 40_000, segmentId: 'K4S' },
      ],
      segments: [
        { id: 'K1S', startMs: 10_000, endMs: 11_000, text: '一', source: 'asr' },
        { id: 'K2S', startMs: 20_000, endMs: 21_000, text: '二', source: 'asr' },
        { id: 'K3S', startMs: 30_000, endMs: 31_000, text: '三', source: 'asr' },
        { id: 'K4S', startMs: 40_000, endMs: 41_000, text: '四', source: 'asr' },
      ],
      adjudications: [],
    };
    const before = deriveFull(input);
    const result = expectIncrementalMatchesFull(before, {
      type: 'anchor-upsert',
      anchor: { id: 'K2', mediaTimeMs: 20_800, segmentId: 'K2S' },
    });
    // K2 扰动影响 K1..K3 区间，K4 之后不受影响且结论对象被复用
    expect(result.affectedIds).toContain('K2S');
    expect(result.affectedIds).not.toContain('K4S');
    const beforeById = conclusionsOf(before);
    const afterById = conclusionsOf(result.state);
    expect(afterById.get('K4S')).toBe(beforeById.get('K4S'));
    expect(afterById.get('K2S')!.offsetMs).toBe(800);
    expect(afterById.get('K2S')!.driftTrend).toBe('drifting-earlier');
  });

  it('新增锚点与整体重推一致', () => {
    expectIncrementalMatchesFull(initial, {
      type: 'anchor-upsert',
      anchor: { id: 'A4', mediaTimeMs: 69_000, segmentId: 'S6' },
    });
  });

  it('删除锚点与整体重推一致', () => {
    const result = expectIncrementalMatchesFull(initial, { type: 'anchor-remove', anchorId: 'A2' });
    // 仅剩 A1：所有片段偏移归零、趋势未知
    expect(conclusionsOf(result.state).get('S6')!.offsetMs).toBe(0);
    expect(conclusionsOf(result.state).get('S6')!.driftTrend).toBe('unknown');
  });

  it('片段增删与整体重推一致', () => {
    const added = expectIncrementalMatchesFull(initial, {
      type: 'segment-upsert',
      segment: { id: 'S7', startMs: 40_000, endMs: 42_000, text: '新插入的一句。', source: 'manual' },
    });
    expect(added.affectedIds).toContain('S7');
    expectIncrementalMatchesFull(added.state, { type: 'segment-remove', segmentId: 'S7' });
  });

  it('片段时刻修改与整体重推一致', () => {
    expectIncrementalMatchesFull(initial, {
      type: 'segment-upsert',
      segment: { id: 'S6', startMs: 68_000, endMs: 71_000, text: '结尾台词。', source: 'manual' },
    });
  });

  it('帧率调整触发全量帧偏移重算且与整体重推一致', () => {
    const result = expectIncrementalMatchesFull(initial, {
      type: 'media',
      media: { durationMs: 120_000, frameRate: 30 },
    });
    expect(result.affectedIds.length).toBe(initial.sortedIds.length);
    expect(conclusionsOf(result.state).get('S4')!.offsetFrames).toBe(15); // 500ms * 30fps
  });

  it('连续多次变更的累积增量结果仍与整体重推一致', () => {
    let state = initial;
    const changes: Change[] = [
      { type: 'adjudicate', adjudication: { id: 'ADJ-1', conflictKey: conflictKeyFor(30_000), winnerSegmentId: 'S3a' } },
      { type: 'anchor-upsert', anchor: { id: 'A2', mediaTimeMs: 49_000, segmentId: 'S4' } },
      { type: 'segment-upsert', segment: { id: 'S8', startMs: 60_000, endMs: 61_500, text: '补充台词。', source: 'asr' } },
      { type: 'anchor-remove', anchorId: 'A1' },
      { type: 'media', media: { durationMs: 120_000, frameRate: 30 } },
    ];
    for (const change of changes) {
      const result = applyChange(state, change);
      const full = deriveFull(result.input);
      expect(result.state.conclusions).toEqual(full.conclusions);
      state = result.state;
    }
  });
});

describe('结论可追溯性', () => {
  it('每条结论可追溯到锚点、片段顺序与裁决记录', () => {
    const adjudication: Adjudication = {
      id: 'ADJ-1',
      conflictKey: conflictKeyFor(30_000),
      winnerSegmentId: 'S3b',
    };
    const { state } = applyChange(deriveFull(buildAcceptanceDataset()), {
      type: 'adjudicate',
      adjudication,
    });
    const conclusions = conclusionsOf(state);

    // 锚点依据
    expect(conclusions.get('S2')!.basis!.anchorIds).toEqual(['A1', 'A2']);
    expect(conclusions.get('S6')!.basis!.anchorIds).toEqual(['A1', 'A2']);
    // 片段顺序依据：与排序序列中的实际邻居一致
    state.sortedIds.forEach((id, idx) => {
      const basis = conclusions.get(id)!.basis!;
      expect(basis.prevSegmentId).toBe(idx > 0 ? state.sortedIds[idx - 1] : null);
      expect(basis.nextSegmentId).toBe(idx < state.sortedIds.length - 1 ? state.sortedIds[idx + 1] : null);
    });
    // 裁决依据
    expect(conclusions.get('S3b')!.basis!.adjudicationIds).toEqual(['ADJ-1']);
    expect(conclusions.get('S1')!.basis!.adjudicationIds).toEqual([]);
  });

  it('无锚点时结论标记为未知趋势且依据为空锚点', () => {
    const input: DerivationInput = {
      media: { durationMs: 10_000, frameRate: 25 },
      segments: [{ id: 'X1', startMs: 1_000, endMs: 2_000, text: '孤立片段', source: 'asr' }],
      anchors: [],
      adjudications: [],
    };
    const state = deriveFull(input);
    const conclusion = conclusionsOf(state).get('X1')!;
    expect(conclusion.offsetMs).toBe(0);
    expect(conclusion.driftTrend).toBe('unknown');
    expect(conclusion.basis!.anchorIds).toEqual([]);
  });
});
