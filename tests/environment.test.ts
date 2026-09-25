import { describe, expect, it } from 'vitest';
import { createRenderPlan, planHash } from '../src/art/artEngine';
import { ArtGeneratorSession } from '../src/art/generator';
import { getTheme, shiftHue } from '../src/art/paletteManager';
import type { CanvasSpec } from '../src/art/types';

const DESKTOP: CanvasSpec = { width: 1280, height: 800, dpr: 1 };
const fixedClock = () => 1700000000000;

function makeSession(canvas: CanvasSpec = DESKTOP): ArtGeneratorSession {
  return new ArtGeneratorSession({ canvas, now: fixedClock });
}

describe('环境变化：主题 / 尺寸 / 设备像素比与记录元数据保持对应', () => {
  it('切换主题后，记录中的主题名与调色板同步更新，其余参数不变', () => {
    const session = makeSession();
    session.generate('抽象艺术', 2024);
    const before = session.current!.config;
    session.setTheme('cyberpunk');
    const after = session.current!.config;
    expect(after.themeName).toBe('cyberpunk');
    expect(after.colors).toEqual(getTheme('cyberpunk').colors);
    expect(after.seed).toBe(before.seed);
    expect(after.complexity).toBe(before.complexity);
    expect(after.strokeWidth).toBe(before.strokeWidth);
    expect(after.hueShift).toBe(before.hueShift);
    // 历史记录 id 不变，序列不受主题切换影响
    expect(session.current!.id).toBe(session.history[session.currentIndex].id);
  });

  it('主题切换后画布内容与记录中的参数元数据一致', () => {
    const session = makeSession();
    session.generate('森林 圆', 88);
    session.setTheme('sunset');
    const item = session.current!;
    const preview = session.getPreviewPlan()!;
    // 预览计划与记录中的参数指纹一致
    expect(preview.meta.paramsHash).toBe(
      createRenderPlan(item.config, item.canvas).meta.paramsHash,
    );
    // 计划中的颜色确实来自新主题并应用了色相偏移
    const themeColors = getTheme('sunset').colors.map((c) => shiftHue(c, item.config.hueShift));
    for (const op of preview.ops) {
      expect(themeColors).toContain(op.color);
    }
    // 缩略图指纹同步更新
    expect(item.thumbnail).toBe(`thumb:${planHash(preview)}`);
  });

  it('窗口尺寸变化后，记录中的画布尺寸与预览计划一致', () => {
    const session = makeSession();
    session.generate('ocean wave', 314);
    const resized: CanvasSpec = { width: 640, height: 480, dpr: 1 };
    session.resize(resized);
    const item = session.current!;
    expect(item.canvas).toEqual(resized);
    const preview = session.getPreviewPlan()!;
    expect(preview.meta.canvas).toEqual(resized);
    expect(preview.meta.pixelWidth).toBe(640);
    expect(preview.meta.pixelHeight).toBe(480);
    expect(item.thumbnail).toBe(`thumb:${planHash(preview)}`);
  });

  it('设备像素比变化只影响像素元数据，不改变布局与参数', () => {
    const dpr1 = makeSession({ width: 800, height: 600, dpr: 1 });
    const dpr2 = makeSession({ width: 800, height: 600, dpr: 2 });
    dpr1.generate('日落 三角', 606);
    dpr2.generate('日落 三角', 606);
    const plan1 = dpr1.getPreviewPlan()!;
    const plan2 = dpr2.getPreviewPlan()!;
    // 布局指令完全一致（坐标为分数，与 dpr 解耦）
    expect(plan1.ops).toEqual(plan2.ops);
    expect(plan1.background).toEqual(plan2.background);
    // 像素元数据各自正确
    expect(plan1.meta.pixelWidth).toBe(800);
    expect(plan2.meta.pixelWidth).toBe(1600);
    expect(plan2.meta.canvas.dpr).toBe(2);
    // 参数指纹不受 dpr 影响
    expect(plan1.meta.paramsHash).toBe(plan2.meta.paramsHash);
  });

  it('同一会话内连续变更尺寸与 dpr，记录始终跟随最新环境', () => {
    const session = makeSession();
    session.generate('morandi 矩形', 47);
    const environments: CanvasSpec[] = [
      { width: 1920, height: 1080, dpr: 1 },
      { width: 1920, height: 1080, dpr: 2 },
      { width: 375, height: 667, dpr: 3 },
    ];
    for (const env of environments) {
      session.resize(env);
      const item = session.current!;
      expect(item.canvas).toEqual(env);
      const preview = session.getPreviewPlan()!;
      expect(preview.meta.pixelWidth).toBe(Math.round(env.width * env.dpr));
      expect(preview.meta.pixelHeight).toBe(Math.round(env.height * env.dpr));
      expect(item.thumbnail).toBe(`thumb:${planHash(preview)}`);
    }
  });

  it('色相偏移准确反映在渲染计划的颜色中', () => {
    const session = makeSession();
    session.generate('cyberpunk neon', 9);
    session.adjust({ hueShift: 120 });
    const item = session.current!;
    const preview = session.getPreviewPlan()!;
    const expected = item.config.colors.map((c) => shiftHue(c, 120));
    for (const op of preview.ops) {
      expect(expected).toContain(op.color);
    }
    expect(preview.background.from).toBe(shiftHue(item.config.colors[0], 120));
  });
});
