import { describe, expect, it } from 'vitest';
import { planHash } from '../src/art/artEngine';
import { exportArt, planToSvg } from '../src/art/exportService';
import { ArtGeneratorSession } from '../src/art/generator';
import type { CanvasSpec } from '../src/art/types';

const CANVAS: CanvasSpec = { width: 800, height: 600, dpr: 1 };
const fixedClock = () => 1700000000000;

function makeSession(): ArtGeneratorSession {
  return new ArtGeneratorSession({ canvas: CANVAS, now: fixedClock });
}

describe('导出一致性：导出与预览共用同一份参数快照', () => {
  it('导出产物的内容指纹与预览渲染计划一致', () => {
    const session = makeSession();
    session.generate('温暖的日落海浪', 808);
    const artifact = session.exportCurrent()!;
    const preview = session.getPreviewPlan()!;
    // 导出 SVG 与预览计划同源
    expect(artifact.svg).toBe(planToSvg(preview));
    expect(artifact.meta.paramsHash).toBe(preview.meta.paramsHash);
    expect(artifact.meta.canvas).toEqual(preview.meta.canvas);
    expect(artifact.contentHash).toBe(exportArt(session.current!).contentHash);
  });

  it('同一状态重复导出，产物逐字节一致', () => {
    const session = makeSession();
    session.generate('cyberpunk neon 圆', 66);
    session.adjust({ hueShift: -40, complexity: 7 });
    const first = session.exportCurrent()!;
    const second = session.exportCurrent()!;
    expect(first.svg).toBe(second.svg);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('撤销后导出反映恢复到的状态，而不是被撤销的中间状态', () => {
    const session = makeSession();
    session.generate('forest 波', 1);
    session.generate('ocean 圆', 2);
    session.adjust({ hueShift: 90 });
    const undoneHash = session.exportCurrent()!.contentHash;
    session.undo(); // 回到更早的记录
    const restored = session.exportCurrent()!;
    expect(restored.contentHash).not.toBe(undoneHash);
    expect(restored.meta.params).toEqual(session.current!.config);
    expect(restored.meta.paramsHash).toBe(session.getPreviewPlan()!.meta.paramsHash);
  });

  it('导出后修改参数不会渗入已生成的导出产物（快照隔离）', () => {
    const session = makeSession();
    session.generate('ocean wave', 21);
    const artifact = session.exportCurrent()!;
    const hashBefore = artifact.contentHash;
    const paramsBefore = JSON.stringify(artifact.meta.params);
    session.adjust({ hueShift: 180, complexity: 10, strokeWidth: 5 });
    session.setTheme('morandi');
    expect(artifact.contentHash).toBe(hashBefore);
    expect(JSON.stringify(artifact.meta.params)).toBe(paramsBefore);
    expect(artifact.meta.params.hueShift).toBe(0);
    // 新导出反映新状态，与旧产物不同
    expect(session.exportCurrent()!.contentHash).not.toBe(hashBefore);
  });

  it('尺寸变化后新导出反映新画布，旧导出产物保持不变', () => {
    const session = makeSession();
    session.generate('日落 三角', 31);
    const before = session.exportCurrent()!;
    expect(before.meta.canvas).toEqual(CANVAS);
    session.resize({ width: 400, height: 300, dpr: 2 });
    const after = session.exportCurrent()!;
    expect(after.meta.canvas).toEqual({ width: 400, height: 300, dpr: 2 });
    expect(after.svg).toContain('width="800"'); // 400 * dpr 2
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(before.meta.canvas).toEqual(CANVAS);
  });

  it('导出 SVG 包含主题颜色且结构确定', () => {
    const session = makeSession();
    session.generate('cyberpunk neon', 4242);
    const artifact = session.exportCurrent()!;
    expect(artifact.svg.startsWith('<svg')).toBe(true);
    expect(artifact.svg).toContain('linearGradient');
    const plan = session.getPreviewPlan()!;
    expect(artifact.svg).toContain(plan.background.from);
    expect(artifact.meta.seed).toBe(4242);
    expect(planHash(plan)).toBe(planHash(session.getPreviewPlan()!));
  });
});
