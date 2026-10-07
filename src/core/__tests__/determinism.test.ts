/**
 * 可观察结果 1：同一份参数，无论渲染/导出多少次，
 * 纹样层叠顺序与洒金分布完全一致，导出产物与页面所见一致。
 */

import { describe, expect, it } from 'vitest';
import { composeWithLight } from '@/core/compose';
import { hashOps } from '@/core/displayList';
import { PaperPipeline } from '@/core/pipeline';
import { richRecipe } from './fixtures';

describe('确定性：同参数任意次渲染/导出结果一致', () => {
  it('两条独立管线渲染同一配方，逐层哈希与整体哈希一致', () => {
    const recipe = richRecipe();
    const a = new PaperPipeline().update(recipe);
    const b = new PaperPipeline().update(recipe);

    expect(a.hash).toBe(b.hash);
    expect(a.layers.base.hash).toBe(b.layers.base.hash);
    expect(a.layers.patterns.map((p) => p.hash)).toEqual(b.layers.patterns.map((p) => p.hash));
    expect(a.layers.goldFoil.hash).toBe(b.layers.goldFoil.hash);
    expect(a.layers.inscription.hash).toBe(b.layers.inscription.hash);
  });

  it('同一管线重复 update 同参数，各层复用同一渲染结果（引用不变）', () => {
    const pipeline = new PaperPipeline();
    const recipe = richRecipe();
    const first = pipeline.update(recipe);
    const second = pipeline.update({ ...recipe });

    expect(second.hash).toBe(first.hash);
    expect(second.layers.base).toBe(first.layers.base);
    expect(second.layers.goldFoil).toBe(first.layers.goldFoil);
    expect(second.layers.inscription).toBe(first.layers.inscription);
    second.layers.patterns.forEach((layer, i) => {
      expect(layer).toBe(first.layers.patterns[i]);
    });
  });

  it('洒金分布在多次渲染与多次导出间逐片一致', () => {
    const recipe = richRecipe();
    const p1 = new PaperPipeline();
    const p2 = new PaperPipeline();
    p1.update(recipe);
    p2.update(recipe);

    expect(p1.export('daylight').hash).toBe(p2.export('daylight').hash);
    expect(p1.export('candlelight').hash).toBe(p2.export('candlelight').hash);
    // 同一管线重复导出返回同一不可变实例
    expect(p1.export('daylight')).toBe(p1.export('daylight'));
  });

  it('导出产物中的笺纸与页面预览是同一份指令（所见即所出）', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const artifact = pipeline.export('candlelight');

    const paperGroup = artifact.ops.find((op) => op.kind === 'group');
    expect(paperGroup).toBeDefined();
    if (paperGroup?.kind !== 'group') return;

    // 匣内笺纸指令 == 预览纸面指令 + 同值光源罩染
    const previewWithLight = composeWithLight(result.layers, result.size, 'candlelight');
    expect(hashOps(paperGroup.ops)).toBe(hashOps(previewWithLight));
    // 预览纸面指令是匣内指令的前缀（仅多了光源罩染一条）
    expect(hashOps(paperGroup.ops.slice(0, result.paperOps.length))).toBe(result.hash);
  });

  it('切换光源不改变任何渲染层（仅罩染变化）', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update(richRecipe());
    const day = composeWithLight(result.layers, result.size, 'daylight');
    const candle = composeWithLight(result.layers, result.size, 'candlelight');

    expect(day.slice(0, -1)).toEqual(candle.slice(0, -1));
    expect(day.at(-1)).not.toEqual(candle.at(-1));
  });
});
