import { describe, expect, it } from 'vitest';
import { createRenderPlan, paramsHash, planHash } from '../src/art/artEngine';
import { ArtGeneratorSession } from '../src/art/generator';
import type { CanvasSpec } from '../src/art/types';

const CANVAS: CanvasSpec = { width: 800, height: 600, dpr: 1 };
const fixedClock = () => 1700000000000;

function makeSession(): ArtGeneratorSession {
  return new ArtGeneratorSession({ canvas: CANVAS, now: fixedClock });
}

describe('确定性：同一组种子与参数的输出稳定', () => {
  it('同一 prompt 在两个全新会话中生成完全相同的渲染计划', () => {
    const a = makeSession();
    const b = makeSession();
    a.generate('温暖的日落海浪');
    b.generate('温暖的日落海浪');
    expect(planHash(a.getPreviewPlan()!)).toBe(planHash(b.getPreviewPlan()!));
    expect(a.current!.thumbnail).toBe(b.current!.thumbnail);
  });

  it('同一显式种子重复生成，输出逐字节一致', () => {
    const session = makeSession();
    const first = session.generate('cyberpunk neon city', 42);
    session.generate('forest walk', 7);
    session.generate('ocean wave', 99);
    const again = session.generate('cyberpunk neon city', 42);
    expect(paramsHash(again.config)).toBe(paramsHash(first.config));
    expect(again.thumbnail).toBe(first.thumbnail);
  });

  it('中间穿插其他生成（缓存残留）不影响同一种子的输出', () => {
    const clean = makeSession();
    clean.generate('target prompt', 1234);
    const cleanHash = planHash(clean.getPreviewPlan()!);

    const busy = makeSession();
    for (let i = 0; i < 8; i += 1) {
      busy.generate(`noise prompt ${i}`, i * 31 + 1);
      busy.adjust({ hueShift: i * 10, complexity: (i % 10) + 1 });
    }
    busy.generate('target prompt', 1234);
    expect(planHash(busy.getPreviewPlan()!)).toBe(cleanHash);
  });

  it('生成顺序不影响每个种子各自的输出', () => {
    const seeds = [11, 22, 33, 44];
    const forward = makeSession();
    const reverse = makeSession();
    const forwardHashes = new Map<number, string>();
    const reverseHashes = new Map<number, string>();
    for (const seed of seeds) {
      forward.generate('抽象 渐变 圆', seed);
      forwardHashes.set(seed, planHash(forward.getPreviewPlan()!));
    }
    for (const seed of [...seeds].reverse()) {
      reverse.generate('抽象 渐变 圆', seed);
      reverseHashes.set(seed, planHash(reverse.getPreviewPlan()!));
    }
    for (const seed of seeds) {
      expect(forwardHashes.get(seed)).toBe(reverseHashes.get(seed));
    }
  });

  it('渲染计划内部按图层顺序排列且两次构建完全相同', () => {
    const session = makeSession();
    session.generate('森林 自然 波', 555);
    const config = session.current!.config;
    const planA = createRenderPlan(config, CANVAS);
    const planB = createRenderPlan(config, CANVAS);
    expect(planA).toEqual(planB);
    const layers = planA.ops.map((op) => op.layer);
    expect([...layers].sort((x, y) => x - y)).toEqual(layers);
  });

  it('先生成再微调到某参数，与直接用该参数生成结果一致（无状态残留）', () => {
    const adjusted = makeSession();
    adjusted.generate('日落 圆 渐变', 777);
    adjusted.adjust({ hueShift: 30, complexity: 8, strokeWidth: 4 });
    const adjustedHash = planHash(adjusted.getPreviewPlan()!);

    const direct = makeSession();
    direct.generate('日落 圆 渐变', 777);
    direct.adjust({ hueShift: 30, complexity: 8, strokeWidth: 4 });
    expect(planHash(direct.getPreviewPlan()!)).toBe(adjustedHash);

    // 参数指纹只取决于最终参数值
    expect(paramsHash(adjusted.current!.config)).toBe(paramsHash(direct.current!.config));
  });

  it('越界参数被钳制到合法区间，输出仍然确定', () => {
    const session = makeSession();
    session.generate('ocean wave', 5);
    session.adjust({ hueShift: 999, complexity: 100, strokeWidth: -3 });
    const config = session.current!.config;
    expect(config.hueShift).toBe(180);
    expect(config.complexity).toBe(10);
    expect(config.strokeWidth).toBe(1);
    expect(planHash(session.getPreviewPlan()!)).toBe(
      planHash(createRenderPlan(config, CANVAS)),
    );
  });
});
