import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpectrumRenderer } from '../src/spectrumRenderer';
import {
  FakeCanvas,
  FakeCanvasRenderingContext2D,
  ManualClock,
  installBrowserGlobals,
  uninstallBrowserGlobals,
} from './helpers/fakes';

const BAR_COUNT = 64;

function smoothedHeights(renderer: SpectrumRenderer): number[] {
  return (renderer as unknown as { smoothedHeights: number[] }).smoothedHeights;
}

describe('SpectrumRenderer', () => {
  let clock: ManualClock;
  let canvas: FakeCanvas;
  let renderer: SpectrumRenderer;
  let ctx: FakeCanvasRenderingContext2D;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
    installBrowserGlobals();
    canvas = new FakeCanvas(400, 300);
    renderer = new SpectrumRenderer(canvas as unknown as HTMLCanvasElement);
    ctx = canvas.context;
  });

  afterEach(() => {
    clock.uninstall();
    uninstallBrowserGlobals();
  });

  describe('无数据衰减', () => {
    it('无数据时平滑高度逐帧衰减并最终归零', () => {
      renderer.setFrequencyData(new Uint8Array(128).fill(255));
      renderer.setFrequencyData(new Uint8Array(128).fill(255));
      const before = [...smoothedHeights(renderer)];
      expect(before.some((h) => h > 0)).toBe(true);

      renderer.setFrequencyData(null as unknown as Uint8Array);
      const afterOne = smoothedHeights(renderer);
      for (let i = 0; i < BAR_COUNT; i++) {
        expect(afterOne[i]).toBeLessThanOrEqual(before[i]);
      }

      for (let i = 0; i < 200; i++) {
        renderer.setFrequencyData(null as unknown as Uint8Array);
      }
      for (const h of smoothedHeights(renderer)) {
        expect(h).toBe(0);
      }
      expect(ctx.invalidOps).toEqual([]);
    });

    it('从未有数据时渲染不抛错且高度保持为零', () => {
      expect(() => renderer.render()).not.toThrow();
      for (const h of smoothedHeights(renderer)) {
        expect(h).toBe(0);
      }
    });
  });

  describe('有数据聚合', () => {
    it('按 bin 聚合并按 0.7/0.3 系数平滑', () => {
      const data = new Uint8Array(128);
      data[0] = 255;
      data[1] = 255;

      renderer.setFrequencyData(data);
      const heights = smoothedHeights(renderer);

      expect(heights[0]).toBeCloseTo(0.3, 5);
      for (let i = 1; i < BAR_COUNT; i++) {
        expect(heights[i]).toBe(0);
      }

      renderer.setFrequencyData(data);
      expect(smoothedHeights(renderer)[0]).toBeCloseTo(0.3 * 0.7 + 0.3, 5);
    });

    it('满量程输入收敛后柱高不越出画布', () => {
      const full = new Uint8Array(128).fill(255);
      for (let i = 0; i < 100; i++) {
        renderer.setFrequencyData(full);
      }

      const heights = smoothedHeights(renderer);
      for (const h of heights) {
        expect(h).toBeLessThanOrEqual(1);
        expect(h).toBeGreaterThan(0.99);
      }

      const barRects = ctx.fillRects.filter((r) => r.w === 4);
      expect(barRects.length).toBeGreaterThan(0);
      for (const rect of barRects) {
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.h).toBeLessThanOrEqual(300);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(400);
      }
      expect(ctx.invalidOps).toEqual([]);
    });

    it('零数据输入使高度向零衰减且不产生负值', () => {
      renderer.setFrequencyData(new Uint8Array(128).fill(255));
      for (let i = 0; i < 100; i++) {
        renderer.setFrequencyData(new Uint8Array(128));
      }
      for (const h of smoothedHeights(renderer)) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(0.01);
      }
    });

    it('短于柱数的数据数组不产生 NaN', () => {
      expect(() => renderer.setFrequencyData(new Uint8Array(10).fill(128))).not.toThrow();
      for (const h of smoothedHeights(renderer)) {
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
      }
      expect(ctx.invalidOps).toEqual([]);
    });

    it('空数据数组不产生 NaN', () => {
      expect(() => renderer.setFrequencyData(new Uint8Array(0))).not.toThrow();
      for (const h of smoothedHeights(renderer)) {
        expect(Number.isFinite(h)).toBe(true);
      }
    });
  });
});
