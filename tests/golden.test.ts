import { describe, expect, it } from 'vitest';
import { planHash } from '../src/art/artEngine';
import { ArtGeneratorSession } from '../src/art/generator';
import type { CanvasSpec } from '../src/art/types';

const CANVAS: CanvasSpec = { width: 800, height: 600, dpr: 1 };
const fixedClock = () => 1700000000000;

/**
 * 黄金基线：锁定当前实现的确定性输出指纹。
 * 任何改动渲染算法 / 解析规则 / 调色板的代码都会使此处失败，
 * 用于在参数调整后快速发现肉眼难以察觉的输出退化。
 * 若变更属于预期行为，重新生成基线值并随变更一起提交。
 */
describe('黄金基线：固定输入的输出指纹不漂移', () => {
  it('固定 prompt + 种子的渲染计划指纹', () => {
    const session = new ArtGeneratorSession({ canvas: CANVAS, now: fixedClock });
    session.generate('温暖的日落海浪', 20260925);
    expect(planHash(session.getPreviewPlan()!)).toBe('c6b4619f');
    expect(session.current!.thumbnail).toBe('thumb:c6b4619f');
    expect(session.exportCurrent()!.contentHash).toBe('b0f144e4');
  });

  it('微调后的渲染计划指纹', () => {
    const session = new ArtGeneratorSession({ canvas: CANVAS, now: fixedClock });
    session.generate('温暖的日落海浪', 20260925);
    session.adjust({ hueShift: 30, complexity: 7, strokeWidth: 3 });
    expect(planHash(session.getPreviewPlan()!)).toBe('72d6fcb2');
  });

  it('随机惊喜在固定种子下的渲染计划指纹', () => {
    const session = new ArtGeneratorSession({ canvas: CANVAS, now: fixedClock });
    session.surprise(12345);
    expect(planHash(session.getPreviewPlan()!)).toBe('38642b32');
  });
});
