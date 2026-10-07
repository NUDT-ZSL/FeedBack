/**
 * 绘制冒烟：paintOps 能把全量指令（含木匣导出产物）画到任意
 * 兼容 CanvasRenderingContext2D 的表面——离线用记录型 mock 验证。
 */

import { describe, expect, it } from 'vitest';
import { paintOps, type PaintContext } from '@/core/displayList';
import { PaperPipeline } from '@/core/pipeline';
import { opKinds, richRecipe } from './fixtures';

function createMockContext(): PaintContext & { calls: string[] } {
 const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : String(a))).join(',')})`);
    };
  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    ellipse: record('ellipse'),
    arc: record('arc'),
    rect: record('rect'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    createRadialGradient: () => ({ addColorStop: record('addColorStop') }),
    clip: record('clip'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
  };
}

describe('paintOps 冒烟', () => {
  it('完整配方 + 入匣产物：所有指令类型都能绘制且不抛错', () => {
    const pipeline = new PaperPipeline();
    pipeline.update(richRecipe());
    const artifact = pipeline.export('daylight');

    // 覆盖全部指令类型
    const kinds = opKinds(artifact.ops);
    ['rect', 'polygon', 'ellipse', 'line', 'text', 'group', 'clip'].forEach((k) => {
      expect(kinds.has(k), `缺少指令类型 ${k}`).toBe(true);
    });

    const ctx = createMockContext();
    expect(() => paintOps(ctx, artifact.ops)).not.toThrow();
    expect(ctx.calls.length).toBeGreaterThan(50);
    // 木匣：先铺底，再装纸（group 内 translate+scale），save/restore 配对
    expect(ctx.calls[0]).toContain('fillRect');
    expect(ctx.calls.filter((c) => c.startsWith('save')).length).toBe(
      ctx.calls.filter((c) => c.startsWith('restore')).length,
    );
  });

  it('同一产物绘制两次，调用序列完全一致（绘制无副作用）', () => {
    const pipeline = new PaperPipeline();
    pipeline.update(richRecipe());
    const artifact = pipeline.export('candlelight');

    const ctx1 = createMockContext();
    const ctx2 = createMockContext();
    paintOps(ctx1, artifact.ops);
    paintOps(ctx2, artifact.ops);
    expect(ctx1.calls).toEqual(ctx2.calls);
  });
});
