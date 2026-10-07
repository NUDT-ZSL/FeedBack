/**
 * 可观察结果 3：纹样层叠顺序与洒金密度的边界取值有明确稳定表现，
 * 不空白、不错位；越界输入统一收敛。
 */

import { describe, expect, it } from 'vitest';
import { PaperPipeline } from '@/core/pipeline';
import { defaultRecipe } from '@/core/recipe';
import type { PaperRecipe, PatternLayerConfig } from '@/core/types';
import { richRecipe } from './fixtures';

function update(recipe: PaperRecipe): ReturnType<PaperPipeline['update']> {
  return new PaperPipeline().update(recipe);
}

describe('洒金密度边界', () => {
  it('密度 0：洒金层为空但纸面仍渲染（底色层在，不空白）', () => {
    const result = update({ ...richRecipe(), goldFoil: { density: 0 } });
    expect(result.recipe.goldFoil.density).toBe(0);
    expect(result.layers.goldFoil.ops).toHaveLength(0);
    expect(result.paperOps.length).toBeGreaterThan(0);
    expect(result.layers.base.ops.length).toBeGreaterThan(0);
  });

  it('密度超过 100 收敛到 100，与显式 100 结果相同', () => {
    const over = update({ ...richRecipe(), goldFoil: { density: 150 } });
    const max = update({ ...richRecipe(), goldFoil: { density: 100 } });
    expect(over.recipe.goldFoil.density).toBe(100);
    expect(over.layers.goldFoil.hash).toBe(max.layers.goldFoil.hash);
    // 100 片金箔
    expect(over.layers.goldFoil.ops).toHaveLength(100);
  });

  it('密度为负收敛到 0', () => {
    const result = update({ ...richRecipe(), goldFoil: { density: -5 } });
    expect(result.recipe.goldFoil.density).toBe(0);
    expect(result.layers.goldFoil.ops).toHaveLength(0);
  });

  it('非有限密度收敛到 0 且不抛错', () => {
    const result = update({ ...richRecipe(), goldFoil: { density: Number.NaN } });
    expect(result.recipe.goldFoil.density).toBe(0);
  });

  it('任意密度下金箔顶点都在纸面范围内（不错位、不越界）', () => {
    [0, 1, 20, 50, 99, 100].forEach((density) => {
      const result = update({ ...richRecipe(), goldFoil: { density } });
      const { width, height } = result.size;
      for (const op of result.layers.goldFoil.ops) {
        expect(op.kind).toBe('polygon');
        if (op.kind !== 'polygon') continue;
        for (const p of op.points) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(height);
        }
      }
    });
  });
});

describe('纹样参数边界', () => {
  it('缩放/透明度/位置越界收敛到合法区间', () => {
    const result = update({
      ...richRecipe(),
      patterns: [
        {
          id: 'x',
          type: 'plum',
          order: 0,
          scale: 99,
          opacity: 0,
          position: { x: 200, y: -20 },
          rotation: 0,
        },
      ],
    });
    const p = result.recipe.patterns[0];
    expect(p.scale).toBe(3);
    expect(p.opacity).toBe(0.3);
    expect(p.position).toEqual({ x: 100, y: 0 });

    const low = update({
      ...richRecipe(),
      patterns: [
        { id: 'x', type: 'plum', order: 0, scale: 0.1, opacity: 2, position: { x: 0, y: 0 }, rotation: 0 },
      ],
    });
    expect(low.recipe.patterns[0].scale).toBe(0.5);
    expect(low.recipe.patterns[0].opacity).toBe(0.6);
  });

  it('角度按 5 度步长归一到 [0,360)：725→5，-10→350', () => {
    const result = update({
      ...richRecipe(),
      patterns: [
        { id: 'x', type: 'plum', order: 0, scale: 1, opacity: 0.4, position: { x: 50, y: 50 }, rotation: 725 },
      ],
    });
    expect(result.recipe.patterns[0].rotation).toBe(5);

    const neg = update({
      ...richRecipe(),
      patterns: [
        { id: 'x', type: 'plum', order: 0, scale: 1, opacity: 0.4, position: { x: 50, y: 50 }, rotation: -10 },
      ],
    });
    expect(neg.recipe.patterns[0].rotation).toBe(350);
  });

  it('order 相同或输入数组乱序：合成结果稳定一致', () => {
    const layers: PatternLayerConfig[] = [
      { id: 'a', type: 'plum', order: 1, scale: 1, opacity: 0.4, position: { x: 30, y: 30 }, rotation: 0 },
      { id: 'b', type: 'cloud', order: 1, scale: 1, opacity: 0.4, position: { x: 60, y: 60 }, rotation: 0 },
      { id: 'c', type: 'wave', order: 1, scale: 1, opacity: 0.4, position: { x: 50, y: 50 }, rotation: 0 },
    ];
    const h1 = update({ ...richRecipe(), patterns: layers }).hash;
    const h2 = update({ ...richRecipe(), patterns: [layers[2], layers[0], layers[1]] }).hash;
    const h3 = update({ ...richRecipe(), patterns: [layers[1], layers[2], layers[0]] }).hash;
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('没有纹样时渲染不空白、导出不报错', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update({ ...defaultRecipe(), patterns: [] });
    expect(result.paperOps.length).toBeGreaterThan(0);
    const artifact = pipeline.export('daylight');
    expect(artifact.hash).toHaveLength(8);
  });
});

describe('题字边界', () => {
  it('字号越界收敛；超长文本逐字仍在纸面范围内', () => {
    const result = update({
      ...richRecipe(),
      inscription: {
        text: '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏'.repeat(3),
        layout: 'vertical',
        position: { x: 50, y: 50 },
        fontSize: 999,
        color: '#3e2723',
      },
    });
    expect(result.recipe.inscription.fontSize).toBe(48);
    const { width, height } = result.size;
    for (const op of result.layers.inscription.ops) {
      if (op.kind !== 'text') continue;
      expect(op.x).toBeGreaterThanOrEqual(0);
      expect(op.x).toBeLessThanOrEqual(width);
      expect(op.y).toBeGreaterThanOrEqual(0);
      expect(op.y).toBeLessThanOrEqual(height);
    }
    expect(result.layers.inscription.ops.length).toBeGreaterThan(0);
  });

  it('空题字：题字层为空但纸面不空白', () => {
    const result = update({
      ...richRecipe(),
      inscription: { text: '   ', layout: 'vertical', position: { x: 50, y: 50 }, fontSize: 24, color: '#000' },
    });
    expect(result.layers.inscription.ops).toHaveLength(0);
    expect(result.paperOps.length).toBeGreaterThan(0);
  });
});

describe('未知参数回退', () => {
  it('未知尺寸/底色 id 回退到预设，渲染与导出均稳定', () => {
    const pipeline = new PaperPipeline();
    const result = pipeline.update({ ...defaultRecipe(), sizeId: 'nope', baseColorId: 'nope' });
    expect(result.size.id).toBe('standard');
    expect(result.recipe.baseColorId).toBe('yunbai');
    expect(result.paperOps.length).toBeGreaterThan(0);
    expect(pipeline.export('daylight').hash).toHaveLength(8);
  });
});
