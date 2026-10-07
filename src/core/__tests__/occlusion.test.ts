/**
 * 可观察结果 4：题字与纹样、底色之间的遮挡关系稳定可预期。
 * 固定层叠（自下而上）：底色 → 纹样（order 升序）→ 洒金 → 题字 → 光源罩染。
 */

import { describe, expect, it } from 'vitest';
import { composeWithLight } from '@/core/compose';
import { PaperPipeline } from '@/core/pipeline';
import { LAYER_Z_ORDER } from '@/core/types';
import { richRecipe } from './fixtures';

describe('层叠与遮挡关系', () => {
  it('层叠契约固定为 底色→纹样→洒金→题字', () => {
    expect([...LAYER_Z_ORDER]).toEqual(['base', 'patterns', 'goldFoil', 'inscription']);
  });

  it('合成指令顺序严格按层叠契约拼接', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const { base, patterns, goldFoil, inscription } = result.layers;

    const baseCount = base.ops.length;
    const patternCount = patterns.reduce((n, p) => n + p.ops.length, 0);
    const goldCount = goldFoil.ops.length;
    const total = baseCount + patternCount + goldCount + inscription.ops.length;

    expect(result.paperOps).toHaveLength(total);
    // 底色段
    expect(result.paperOps.slice(0, baseCount)).toEqual([...base.ops]);
    // 纹样段（按 order/id 升序）
    let cursor = baseCount;
    for (const layer of patterns) {
      expect(result.paperOps.slice(cursor, cursor + layer.ops.length)).toEqual([...layer.ops]);
      cursor += layer.ops.length;
    }
    // 洒金段
    expect(result.paperOps.slice(cursor, cursor + goldCount)).toEqual([...goldFoil.ops]);
    cursor += goldCount;
    // 题字段在最上
    expect(result.paperOps.slice(cursor)).toEqual([...inscription.ops]);
  });

  it('纹样之间按 order 叠放：order 大者的指令在后（遮挡小的）', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const indexOf = (id: string) => {
      const layer = result.layers.patterns.find((p) => p.key.includes(`:${id}:`))!;
      return result.paperOps.indexOf(layer.ops[0]);
    };
    // 配方中 a(order 0) < b(order 1) = c(order 1，id 更大)
    expect(indexOf('a')).toBeLessThan(indexOf('b'));
    expect(indexOf('b')).toBeLessThan(indexOf('c'));
  });

  it('题字永远盖在洒金与纹样之上', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const firstInscription = result.paperOps.indexOf(result.layers.inscription.ops[0]);
    const lastGold = result.paperOps.lastIndexOf(
      result.layers.goldFoil.ops[result.layers.goldFoil.ops.length - 1],
    );
    expect(firstInscription).toBeGreaterThan(lastGold);
  });

  it('光源罩染是纸面最上一条指令，且导出与预览使用同一罩染值', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const composed = composeWithLight(result.layers, result.size, 'candlelight');
    const tint = composed.at(-1);
    expect(tint?.kind).toBe('rect');
    if (tint?.kind === 'rect') {
      expect(tint.fill).toBe('rgba(255, 168, 64, 0.22)');
    }
    // 罩染只追加一条，不改变纸面指令
    expect(composed.slice(0, -1)).toEqual([...result.paperOps]);
  });
});
