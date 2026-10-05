// 验收测试：
// 1. 倒序/重叠/缺失锚点/矛盾来源都被保留并标记，绝不静默择一
// 2. 裁决后只重推受影响区间，且结果与整体重推一致
// 3. 锚点修正、片段增删、帧率调整后，未受影响部分与整体重推一致
// 4. 每条结论可追溯到锚点、片段顺序与裁决记录
import { describe, expect, it } from 'vitest';
import { computeAlignment } from './engine';
import { recomputeAlignment, type ChangeSpec, type IncrementalState } from './incremental';
import type { Adjudication, AlignmentInputs, AlignmentResult } from './types';

function sampleInputs(): AlignmentInputs {
  return {
    media: { durationSec: 120, frameRate: 25 },
    anchors: [
      { id: 'anchor-1', mediaTimeSec: 10, subtitleTimeSec: 10, segmentId: 'seg-1' },
      { id: 'anchor-2', mediaTimeSec: 40, subtitleTimeSec: 42 },
      { id: 'anchor-3', mediaTimeSec: 80, subtitleTimeSec: 85, segmentId: 'seg-missing' },
    ],
    segments: [
      { id: 'seg-1', startSec: 5, endSec: 8, text: '开场白', source: '人工' },
      { id: 'seg-2', startSec: 12, endSec: 15, text: '第一句台词', source: 'ASR' },
      { id: 'seg-3', startSec: 20, endSec: 14, text: '时刻倒序的片段', source: 'ASR' },
      { id: 'seg-4', startSec: 30, endSec: 36, text: '重叠片段甲', source: 'ASR' },
      { id: 'seg-5', startSec: 34, endSec: 38, text: '重叠片段乙', source: '人工' },
      { id: 'seg-6', startSec: 50, endSec: 54, text: '同一时刻的版本A', source: 'ASR' },
      { id: 'seg-7', startSec: 50, endSec: 54, text: '同一时刻的版本B', source: 'OCR' },
      { id: 'seg-8', startSec: 90, endSec: 95, text: '片尾台词', source: '人工' },
      { id: 'seg-9', startSec: 118, endSec: 130, text: '超出媒体时长的片段', source: 'ASR' },
    ],
    adjudications: [],
  };
}

function applyChange(state: IncrementalState, next: AlignmentInputs, change: ChangeSpec) {
  const out = recomputeAlignment(state, next, change);
  return { state: { inputs: next, result: out.result } as IncrementalState, out };
}

/** 断言增量结果与整体重推逐字段一致 */
function expectMatchesFullRebuild(result: AlignmentResult, inputs: AlignmentInputs) {
  expect(result).toEqual(computeAlignment(inputs));
}

describe('数据问题与矛盾片段的保留', () => {
  const inputs = sampleInputs();
  const result = computeAlignment(inputs);

  it('倒序片段被保留并标记 reversed-time', () => {
    expect(result.issues.some((i) => i.kind === 'reversed-time' && i.segmentIds?.includes('seg-3'))).toBe(true);
    expect(result.conclusions.some((c) => c.segmentId === 'seg-3')).toBe(true);
  });

  it('重叠片段双方都被保留并标记 overlap', () => {
    const overlap = result.issues.find((i) => i.kind === 'overlap');
    expect(overlap?.segmentIds?.sort()).toEqual(['seg-4', 'seg-5']);
    expect(result.conclusions.some((c) => c.segmentId === 'seg-4')).toBe(true);
    expect(result.conclusions.some((c) => c.segmentId === 'seg-5')).toBe(true);
  });

  it('指向缺失片段的锚点被标记 dangling-anchor 而非静默忽略', () => {
    expect(result.issues.some((i) => i.kind === 'dangling-anchor' && i.anchorId === 'anchor-3')).toBe(true);
  });

  it('同一时刻来源矛盾的片段组成矛盾组，双方全部保留且待裁决', () => {
    const conflict = result.conflicts.find((c) => c.segmentIds.includes('seg-6'));
    expect(conflict).toBeDefined();
    expect(conflict!.segmentIds.sort()).toEqual(['seg-6', 'seg-7']);
    expect(conflict!.adjudicationId).toBeNull();
    expect(conflict!.chosenSegmentId).toBeNull();
    const c6 = result.conclusions.find((c) => c.segmentId === 'seg-6')!;
    const c7 = result.conclusions.find((c) => c.segmentId === 'seg-7')!;
    expect(c6.rejected).toBe(false);
    expect(c7.rejected).toBe(false);
  });

  it('越界片段被标记 out-of-media', () => {
    expect(result.issues.some((i) => i.kind === 'out-of-media' && i.segmentIds?.includes('seg-9'))).toBe(true);
  });
});

describe('矛盾裁决后的增量重推', () => {
  it('裁决只重推矛盾组成员，结果与整体重推一致，未受影响结论保持引用', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    let state: IncrementalState = { inputs, result: initial.result };

    const conflict = initial.result.conflicts.find((c) => c.segmentIds.includes('seg-6'))!;
    const adjudication: Adjudication = {
      id: 'adj-1',
      conflictId: conflict.id,
      chosenSegmentId: 'seg-6',
      rejectedSegmentIds: ['seg-7'],
      seq: 1,
      createdAt: 1,
    };
    const nextInputs: AlignmentInputs = { ...inputs, adjudications: [adjudication] };
    const { state: nextState, out } = applyChange(state, nextInputs, {
      type: 'adjudication',
      conflictId: conflict.id,
    });
    state = nextState;

    // 只重推矛盾组成员
    expect(out.affected.conclusionSegmentIds.sort()).toEqual(['seg-6', 'seg-7']);
    // 与整体重推一致
    expectMatchesFullRebuild(out.result, nextInputs);
    // 未受影响结论对象引用不变
    const prevById = new Map(initial.result.conclusions.map((c) => [c.segmentId, c]));
    for (const c of out.result.conclusions) {
      if (!out.affected.conclusionSegmentIds.includes(c.segmentId)) {
        expect(c).toBe(prevById.get(c.segmentId));
      }
    }
    // 驳回方保留但标记 rejected，采纳方可追溯裁决记录
    const c6 = out.result.conclusions.find((c) => c.segmentId === 'seg-6')!;
    const c7 = out.result.conclusions.find((c) => c.segmentId === 'seg-7')!;
    expect(c6.rejected).toBe(false);
    expect(c7.rejected).toBe(true);
    expect(c6.basis.adjudicationIds).toContain('adj-1');
    expect(c7.basis.adjudicationIds).toContain('adj-1');
  });
});

describe('锚点修正的增量重推', () => {
  it('修改锚点时刻：只重推相邻护栏区间，结果与整体重推一致', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    const state: IncrementalState = { inputs, result: initial.result };

    const nextInputs: AlignmentInputs = {
      ...inputs,
      anchors: inputs.anchors.map((a) => (a.id === 'anchor-2' ? { ...a, subtitleTimeSec: 45 } : a)),
    };
    const { out } = applyChange(state, nextInputs, { type: 'anchor', anchorId: 'anchor-2' });

    expectMatchesFullRebuild(out.result, nextInputs);
    // 受影响的是 anchor-1..anchor-3 之间的片段；anchor-3 之后的 seg-8/seg-9 不受影响
    expect(out.affected.conclusionSegmentIds).not.toContain('seg-8');
    expect(out.affected.conclusionSegmentIds).not.toContain('seg-9');
    const prevById = new Map(initial.result.conclusions.map((c) => [c.segmentId, c]));
    expect(out.result.conclusions.find((c) => c.segmentId === 'seg-8')).toBe(prevById.get('seg-8'));
    // 受影响的 seg-2 偏移确实变化（anchor-2 字幕时刻 42 -> 45）
    const seg2 = out.result.conclusions.find((c) => c.segmentId === 'seg-2')!;
    expect(seg2.offsetSec).toBeCloseTo(computeAlignment(nextInputs).conclusions.find((c) => c.segmentId === 'seg-2')!.offsetSec);
  });

  it('新增与删除锚点：结果与整体重推一致', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    let state: IncrementalState = { inputs, result: initial.result };

    const withNew: AlignmentInputs = {
      ...inputs,
      anchors: [...inputs.anchors, { id: 'anchor-4', mediaTimeSec: 60, subtitleTimeSec: 63 }],
    };
    let r = applyChange(state, withNew, { type: 'anchor', anchorId: 'anchor-4' });
    expectMatchesFullRebuild(r.out.result, withNew);
    state = r.state;

    const without2: AlignmentInputs = { ...withNew, anchors: withNew.anchors.filter((a) => a.id !== 'anchor-2') };
    r = applyChange(state, without2, { type: 'anchor', anchorId: 'anchor-2' });
    expectMatchesFullRebuild(r.out.result, without2);
  });
});

describe('片段增删的增量重推', () => {
  it('新增片段：结果与整体重推一致，远处结论保持引用', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    const state: IncrementalState = { inputs, result: initial.result };

    const nextInputs: AlignmentInputs = {
      ...inputs,
      segments: [...inputs.segments, { id: 'seg-10', startSec: 100, endSec: 103, text: '新增片段', source: '人工' }],
    };
    const { out } = applyChange(state, nextInputs, { type: 'segment', segmentId: 'seg-10' });
    expectMatchesFullRebuild(out.result, nextInputs);
    expect(out.affected.conclusionSegmentIds).toContain('seg-10');
    // 新增片段排在末尾，前面的片段排序不变，引用保持
    const prevById = new Map(initial.result.conclusions.map((c) => [c.segmentId, c]));
    expect(out.result.conclusions.find((c) => c.segmentId === 'seg-1')).toBe(prevById.get('seg-1'));
  });

  it('删除片段：结果与整体重推一致，指向它的锚点变为 dangling', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    const state: IncrementalState = { inputs, result: initial.result };

    const nextInputs: AlignmentInputs = { ...inputs, segments: inputs.segments.filter((s) => s.id !== 'seg-1') };
    const { out } = applyChange(state, nextInputs, { type: 'segment', segmentId: 'seg-1' });
    expectMatchesFullRebuild(out.result, nextInputs);
    expect(out.result.issues.some((i) => i.kind === 'dangling-anchor' && i.anchorId === 'anchor-1')).toBe(true);
  });

  it('新增与现有片段矛盾的片段：双方进入矛盾组，结果与整体重推一致', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    const state: IncrementalState = { inputs, result: initial.result };

    const nextInputs: AlignmentInputs = {
      ...inputs,
      segments: [...inputs.segments, { id: 'seg-10', startSec: 12, endSec: 15, text: '与seg-2矛盾', source: 'OCR' }],
    };
    const { out } = applyChange(state, nextInputs, { type: 'segment', segmentId: 'seg-10' });
    expectMatchesFullRebuild(out.result, nextInputs);
    const conflict = out.result.conflicts.find((c) => c.segmentIds.includes('seg-10'));
    expect(conflict?.segmentIds.sort()).toEqual(['seg-10', 'seg-2']);
  });
});

describe('帧率调整的增量重推', () => {
  it('只重投影帧字段，偏移与漂移趋势不变，结果与整体重推一致', () => {
    const inputs = sampleInputs();
    const initial = recomputeAlignment(null, inputs, { type: 'full', reason: 'init' });
    const state: IncrementalState = { inputs, result: initial.result };

    const nextInputs: AlignmentInputs = { ...inputs, media: { ...inputs.media, frameRate: 30 } };
    const { out } = applyChange(state, nextInputs, { type: 'frame-rate' });

    expect(out.affected.frameProjectionOnly).toBe(true);
    expectMatchesFullRebuild(out.result, nextInputs);
    // 秒级偏移不变，帧偏移按新帧率折算
    for (const c of out.result.conclusions) {
      const prev = initial.result.conclusions.find((p) => p.segmentId === c.segmentId)!;
      expect(c.offsetSec).toBe(prev.offsetSec);
      expect(c.offsetFrames).toBe(Math.round(c.offsetSec * 30));
    }
  });
});

describe('结论可追溯性', () => {
  it('每条结论都能追溯到锚点、片段顺序与裁决记录', () => {
    const inputs = sampleInputs();
    const adjudication: Adjudication = {
      id: 'adj-1',
      conflictId: 'conflict:seg-6|seg-7',
      chosenSegmentId: 'seg-6',
      rejectedSegmentIds: ['seg-7'],
      seq: 1,
      createdAt: 1,
    };
    const withAdj: AlignmentInputs = { ...inputs, adjudications: [adjudication] };
    const result = computeAlignment(withAdj);

    const sortedIds = [...inputs.segments]
      .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec || a.id.localeCompare(b.id))
      .map((s) => s.id);

    for (const c of result.conclusions) {
      // 片段顺序可追溯
      expect(sortedIds[c.orderIndex]).toBe(c.segmentId);
      // 锚点依据可追溯（有锚点时至少 1 个）
      expect(c.basis.anchorIds.length).toBeGreaterThanOrEqual(1);
      for (const aid of c.basis.anchorIds) {
        expect(inputs.anchors.some((a) => a.id === aid)).toBe(true);
      }
      // 区间与漂移趋势一致
      const interval = result.intervals.find((iv) => iv.id === c.intervalId)!;
      expect(interval.anchorIds).toEqual(c.basis.anchorIds);
      expect(interval.trend).toBe(c.driftTrend);
    }
    // 裁决记录可追溯
    const c7 = result.conclusions.find((c) => c.segmentId === 'seg-7')!;
    expect(c7.basis.adjudicationIds).toEqual(['adj-1']);
    expect(c7.conflictId).toBe('conflict:seg-6|seg-7');
  });

  it('漂移趋势方向正确：锚点间偏移增大为 ahead，外推区间标记 extrapolated', () => {
    const inputs = sampleInputs();
    const result = computeAlignment(inputs);
    const between = result.intervals.find((iv) => iv.anchorIds.join('|') === 'anchor-1|anchor-2')!;
    // anchor-1 偏移 0，anchor-2 偏移 2 → 字幕超前
    expect(between.trend).toBe('ahead');
    expect(between.driftRateSecPerSec).toBeGreaterThan(0);
    const tail = result.intervals[result.intervals.length - 1];
    expect(tail.extrapolated).toBe(true);
    expect(tail.trend).toBe('extrapolated');
  });
});
