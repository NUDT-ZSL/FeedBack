/**
 * 可观察结果 2：调整某一层参数时，其它层渲染结果（引用与内容）不变，
 * 已生成的导出产物作为不可变快照不被后续参数变更打乱。
 */

import { describe, expect, it } from 'vitest';
import { PaperPipeline } from '@/core/pipeline';
import type { PaperRecipe } from '@/core/types';
import { richRecipe, withGoldDensity } from './fixtures';

describe('层间隔离：参数变化只影响真正相关的部分', () => {
  it('改底色：只重算底色层，纹样/洒金/题字层引用不变', () => {
    const pipeline = new PaperPipeline();
    const before = pipeline.update(richRecipe());
    const after = pipeline.update({ ...richRecipe(), baseColorId: 'ehuang' });

    expect(after.layers.base).not.toBe(before.layers.base);
    expect(after.layers.patterns).toEqual(before.layers.patterns);
    expect(after.layers.goldFoil).toBe(before.layers.goldFoil);
    expect(after.layers.inscription).toBe(before.layers.inscription);
  });

  it('改洒金密度：只重算洒金层', () => {
    const pipeline = new PaperPipeline();
    const before = pipeline.update(richRecipe());
    const after = pipeline.update(withGoldDensity(richRecipe(), 100));

    expect(after.layers.goldFoil).not.toBe(before.layers.goldFoil);
    expect(after.layers.base).toBe(before.layers.base);
    expect(after.layers.inscription).toBe(before.layers.inscription);
    after.layers.patterns.forEach((layer, i) => {
      expect(layer).toBe(before.layers.patterns[i]);
    });
  });
 it('改题字：只重算题字层', () => {
    const pipeline = new PaperPipeline();
    const before = pipeline.update(richRecipe());
    const next: PaperRecipe = {
      ...richRecipe(),
      inscription: { ...richRecipe().inscription, text: '松风煮茶' },
    };
    const after = pipeline.update(next);

    expect(after.layers.inscription).not.toBe(before.layers.inscription);
    expect(after.layers.base).toBe(before.layers.base);
    expect(after.layers.goldFoil).toBe(before.layers.goldFoil);
    after.layers.patterns.forEach((layer, i) => {
      expect(layer).toBe(before.layers.patterns[i]);
    });
  });

  it('改一层纹样的缩放：其它纹样层与底色/洒金/题字都不重算', () => {
    const pipeline = new PaperPipeline();
    const before = pipeline.update(richRecipe());
    const next = {
      ...richRecipe(),
      patterns: richRecipe().patterns.map((p) => (p.id === 'b' ? { ...p, scale: 2.6 } : p)),
    };
    const after = pipeline.update(next);

    const beforeB = before.layers.patterns.find((p) => p.key.includes(':b:'));
    const afterB = after.layers.patterns.find((p) => p.key.includes(':b:'));
    expect(afterB).not.toBe(beforeB);
    ['a', 'c'].forEach((id) => {
      expect(after.layers.patterns.find((p) => p.key.includes(`:${id}:`))).toBe(
        before.layers.patterns.find((p) => p.key.includes(`:${id}:`)),
      );
    });
    expect(after.layers.base).toBe(before.layers.base);
    expect(after.layers.goldFoil).toBe(before.layers.goldFoil);
    expect(after.layers.inscription).toBe(before.layers.inscription);
  });

  it('只调整纹样层叠顺序：各纹样层不重算，仅合成顺序变化', () => {
    const pipeline = new PaperPipeline();
    const before = pipeline.update(richRecipe());
    const reordered = {
      ...richRecipe(),
      patterns: richRecipe().patterns.map((p) => (p.id === 'a' ? { ...p, order: 5 } : p)),
    };
    const after = pipeline.update(reordered);

    before.layers.patterns.forEach((layer) => {
      expect(after.layers.patterns.find((p) => p.key === layer.key)).toBe(layer);
    });
    expect(after.hash).not.toBe(before.hash);
  });

  it('已入匣的导出产物在参数变更后保持原样（不可变快照）', () => {
    const pipeline = new PaperPipeline();
    pipeline.update(richRecipe());
    const artifact = pipeline.export('daylight');
    const frozenHash = artifact.hash;
    const frozenOps = artifact.ops;

    pipeline.update(withGoldDensity(richRecipe(), 20));

    expect(artifact.hash).toBe(frozenHash);
    expect(artifact.ops).toBe(frozenOps);
    expect(artifact.recipe.goldFoil.density).toBe(50);
    // 冻结对象不可写（严格模式下直接抛错）
    expect(() => {
      (artifact as unknown as { hash: string }).hash = 'tampered';
    }).toThrow();
  });

  it('参数改回原值：命中缓存，得到与最初完全相同的层结果', () => {
    const pipeline = new PaperPipeline();
    const first = pipeline.update(withGoldDensity(richRecipe(), 50));
    pipeline.update(withGoldDensity(richRecipe(), 20));
    const restored = pipeline.update(withGoldDensity(richRecipe(), 50));

    expect(restored.layers.goldFoil).toBe(first.layers.goldFoil);
    expect(restored.hash).toBe(first.hash);
  });
});
