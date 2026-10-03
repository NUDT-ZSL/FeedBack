// comp-* ：同行关系（时间重叠、包含、间隔合并、空间阈值、多目标对）的批量验证。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectCompanionship,
  detectCompanionshipForPair,
  pairKey,
} from '../../src/trajectory/index.ts';
import { COMP, mkStaySeg, offsetMeters, ORIGIN } from './helpers.ts';

const NEAR = offsetMeters(ORIGIN.lng, ORIGIN.lat, 30, 0);
const FAR = offsetMeters(ORIGIN.lng, ORIGIN.lat, 5000, 0);

describe('companionship: interval overlap semantics', () => {
  it('comp-01 部分重叠：交集区间被正确识别', () => {
    const a = [mkStaySeg('A', 0, 60_000, ORIGIN.lng, ORIGIN.lat)];
    const b = [mkStaySeg('B', 30_000, 100_000, NEAR.lng, NEAR.lat)];
    const intervals = detectCompanionshipForPair('A', a, 'B', b, COMP);
    assert.equal(intervals.length, 1);
    assert.deepEqual([intervals[0].startMs, intervals[0].endMs], [30_000, 60_000]);
    assert.equal(intervals[0].id, `comp:A:B:${30_000}:${60_000}`);
  });

  it('comp-02 完全包含与部分重叠走同一规则，判定一致', () => {
    // 完全包含：A 包住 B
    const contained = detectCompanionshipForPair(
      'A',
      [mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat)],
      'B',
      [mkStaySeg('B', 20_000, 50_000, NEAR.lng, NEAR.lat)],
      COMP,
    );
    assert.equal(contained.length, 1);
    assert.deepEqual([contained[0].startMs, contained[0].endMs], [20_000, 50_000]);

    // 交换调用方向，结果不变（pairKey 规范化、交集对称）
    const swapped = detectCompanionshipForPair(
      'B',
      [mkStaySeg('B', 20_000, 50_000, NEAR.lng, NEAR.lat)],
      'A',
      [mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat)],
      COMP,
    );
    assert.deepEqual(swapped, contained);
    assert.equal(pairKey('B', 'A'), 'A|B');

    // 部分重叠同样识别成功——两类情形结论一致（均有 1 个同行区间）
    const partial = detectCompanionshipForPair(
      'A',
      [mkStaySeg('A', 0, 60_000, ORIGIN.lng, ORIGIN.lat)],
      'B',
      [mkStaySeg('B', 30_000, 100_000, NEAR.lng, NEAR.lat)],
      COMP,
    );
    assert.equal(partial.length, contained.length);
  });

  it('comp-03 间隔不超过 gapTolerance 合并，超过则保持两个区间', () => {
    const a = [
      mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat),
      mkStaySeg('A', 200_000, 300_000, ORIGIN.lng, ORIGIN.lat),
    ];
    const b = [mkStaySeg('B', 50_000, 250_000, NEAR.lng, NEAR.lat)];

    const merged = detectCompanionshipForPair('A', a, 'B', b, {
      ...COMP,
      gapToleranceMs: 150_000, // 候选 [50k,100k] 与 [200k,250k] 间隔 100k <= 150k
    });
    assert.equal(merged.length, 1);
    assert.deepEqual([merged[0].startMs, merged[0].endMs], [50_000, 250_000]);

    const split = detectCompanionshipForPair('A', a, 'B', b, {
      ...COMP,
      gapToleranceMs: 50_000,
    });
    assert.equal(split.length, 2);
    assert.deepEqual([split[0].startMs, split[0].endMs], [50_000, 100_000]);
    assert.deepEqual([split[1].startMs, split[1].endMs], [200_000, 250_000]);
  });

  it('comp-04 空间距离超过 maxDistanceMeters 时不判同行', () => {
    const a = [mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat)];
    const b = [mkStaySeg('B', 0, 100_000, FAR.lng, FAR.lat)];
    assert.deepEqual(detectCompanionshipForPair('A', a, 'B', b, COMP), []);
  });

  it('comp-05 重叠时长不足 minOverlapMs 时不判同行；端点接触在阈值 0 时算同行', () => {
    const a = [mkStaySeg('A', 0, 60_000, ORIGIN.lng, ORIGIN.lat)];
    const b = [mkStaySeg('B', 50_000, 120_000, NEAR.lng, NEAR.lat)]; // 重叠 10s
    assert.equal(
      detectCompanionshipForPair('A', a, 'B', b, { ...COMP, minOverlapMs: 30_000 }).length,
      0,
    );
    assert.equal(
      detectCompanionshipForPair('A', a, 'B', b, { ...COMP, minOverlapMs: 10_000 }).length,
      1,
    );

    const touchA = [mkStaySeg('A', 0, 50_000, ORIGIN.lng, ORIGIN.lat)];
    const touchB = [mkStaySeg('B', 50_000, 90_000, NEAR.lng, NEAR.lat)];
    const touch = detectCompanionshipForPair('A', touchA, 'B', touchB, {
      ...COMP,
      minOverlapMs: 0,
    });
    assert.equal(touch.length, 1);
    assert.deepEqual([touch[0].startMs, touch[0].endMs], [50_000, 50_000]);
  });

  it('comp-06 多目标：枚举全部目标对，仅位置相近的对存在同行', () => {
    const byTarget = new Map<string, ReturnType<typeof mkStaySeg>[]>([
      ['A', [mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat)]],
      ['B', [mkStaySeg('B', 10_000, 90_000, NEAR.lng, NEAR.lat)]],
      ['C', [mkStaySeg('C', 0, 100_000, FAR.lng, FAR.lat)]],
    ]);
    const result = detectCompanionship(byTarget, COMP);
    assert.deepEqual([...result.keys()].sort(), ['A|B', 'A|C', 'B|C']);
    assert.equal(result.get('A|B')?.length, 1);
    assert.deepEqual(result.get('A|C'), []);
    assert.deepEqual(result.get('B|C'), []);
  });

  it('comp-07 同行判定可复现：重复运行与反向枚举结果一致', () => {
    const byTarget = new Map([
      ['A', [mkStaySeg('A', 0, 100_000, ORIGIN.lng, ORIGIN.lat)]],
      ['B', [mkStaySeg('B', 10_000, 90_000, NEAR.lng, NEAR.lat)]],
      ['C', [mkStaySeg('C', 50_000, 120_000, NEAR.lng, NEAR.lat)]],
    ]);
    const r1 = detectCompanionship(byTarget, COMP);
    const r2 = detectCompanionship(new Map(byTarget), { ...COMP });
    assert.deepEqual([...r1.entries()], [...r2.entries()]);
  });
});
