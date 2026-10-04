import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WaveRenderer } from '../src/waveRenderer';
import {
  FakeCanvas,
  FakeCanvasRenderingContext2D,
  ManualClock,
  RecordedOp,
  installBrowserGlobals,
  uninstallBrowserGlobals,
} from './helpers/fakes';

function assertPathsWellFormed(ctx: FakeCanvasRenderingContext2D): void {
  let openPath: RecordedOp | null = null;
  let nextOpMustMoveTo = false;

  for (const op of ctx.ops) {
    if (op.name === 'beginPath') {
      if (openPath) {
        throw new Error('beginPath called before the previous path was stroked/filled');
      }
      openPath = op;
      nextOpMustMoveTo = true;
    } else if (op.name === 'moveTo' || op.name === 'lineTo' || op.name === 'quadraticCurveTo') {
      expect(openPath, `path segment ${op.name} without beginPath`).not.toBeNull();
      if (nextOpMustMoveTo) {
        expect(op.name, 'every path must start with moveTo').toBe('moveTo');
        nextOpMustMoveTo = false;
      }
    } else if (op.name === 'stroke' || op.name === 'fill') {
      expect(openPath, `${op.name} called without beginPath`).not.toBeNull();
      openPath = null;
      nextOpMustMoveTo = false;
    }
  }
}

describe('WaveRenderer', () => {
  let clock: ManualClock;
  let canvas: FakeCanvas;
  let renderer: WaveRenderer;
  let ctx: FakeCanvasRenderingContext2D;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
    installBrowserGlobals();
    canvas = new FakeCanvas(800, 200);
    renderer = new WaveRenderer(canvas as unknown as HTMLCanvasElement);
    ctx = canvas.context;
  });

  afterEach(() => {
    renderer.destroy();
    clock.uninstall();
    uninstallBrowserGlobals();
  });

  describe('边界数据绘制', () => {
    it('空数据不抛错且不产生畸形路径', () => {
      expect(() => renderer.setWaveformData(new Float32Array(0))).not.toThrow();
      expect(ctx.invalidOps).toEqual([]);
      assertPathsWellFormed(ctx);
    });

    it('单点数据不抛错、无 NaN 坐标且路径闭合', () => {
      expect(() => renderer.setWaveformData(new Float32Array([0.5]))).not.toThrow();
      expect(ctx.invalidOps).toEqual([]);
      assertPathsWellFormed(ctx);

      const moveTos = ctx.ops.filter((op) => op.name === 'moveTo');
      expect(moveTos.length).toBeGreaterThanOrEqual(2);
      expect(moveTos[0].args[0]).toBe(400);
      expect(moveTos[1].args[0]).toBe(400);
    });

    it('满量程数据不抛错、不越界且路径闭合', () => {
      const fullScale = new Float32Array(2048).fill(1);
      expect(() => renderer.setWaveformData(fullScale)).not.toThrow();
      expect(ctx.invalidOps).toEqual([]);
      assertPathsWellFormed(ctx);

      for (const op of ctx.ops) {
        for (const arg of op.args) {
          if (typeof arg === 'number') {
            expect(arg).toBeGreaterThanOrEqual(0);
            expect(arg).toBeLessThanOrEqual(800);
          }
        }
      }
    });

    it('重复替换数据与多次渲染结果稳定', () => {
      renderer.setWaveformData(new Float32Array(100).fill(0.3));
      const opsAfterFirst = ctx.ops.length;
      renderer.setWaveformData(new Float32Array(100).fill(0.7));
      expect(ctx.ops.length).toBeGreaterThan(opsAfterFirst);
      expect(() => renderer.render()).not.toThrow();
      expect(ctx.invalidOps).toEqual([]);
    });

    it('播放进度扫描线位置与比例一致，超界比例不产生 NaN', () => {
      renderer.setWaveformData(new Float32Array(64).fill(0.5));
      renderer.setPlayProgress(0.5);
      const lineToAtHalf = ctx.ops.filter((op) => op.name === 'lineTo').pop();
      expect(lineToAtHalf?.args[0]).toBe(400);

      expect(() => {
        renderer.setPlayProgress(0);
        renderer.setPlayProgress(1);
        renderer.setPlayProgress(-0.5);
        renderer.setPlayProgress(1.5);
      }).not.toThrow();
      expect(ctx.invalidOps).toEqual([]);
    });
  });

  describe('样式过渡', () => {
    it('样式参数变化后经过过渡最终收敛到目标值', () => {
      clock.setTime(0);
      renderer.setWaveformData(new Float32Array(64).fill(0.5));
      renderer.setStyle({ thickness: 5 });

      clock.advance(400);
      clock.runFrame();
      const strokesBeforeFinalRender = ctx.strokeLineWidths.length;
      renderer.render();

      const finalStrokes = ctx.strokeLineWidths.slice(strokesBeforeFinalRender);
      expect(finalStrokes[0]).toBe(5);
      expect(finalStrokes[1]).toBe(5);
      expect(finalStrokes[2]).toBe(2);
      expect((renderer as unknown as { animationFrameId: number | null }).animationFrameId).toBeNull();
    });

    it('连续快速调整不会卡在中间态，最终收敛到最后目标', () => {
      clock.setTime(0);
      renderer.setWaveformData(new Float32Array(64).fill(0.5));
      renderer.setStyle({ thickness: 5 });

      clock.advance(50);
      clock.runFrame();
      renderer.setStyle({ thickness: 1 });

      clock.advance(50);
      clock.runFrame();
      renderer.setStyle({ thickness: 4 });

      clock.advance(400);
      clock.runFrame();
      const strokesBeforeFinalRender = ctx.strokeLineWidths.length;
      renderer.render();

      const finalStrokes = ctx.strokeLineWidths.slice(strokesBeforeFinalRender);
      expect(finalStrokes[0]).toBe(4);
      expect(finalStrokes[1]).toBe(4);
      expect((renderer as unknown as { animationFrameId: number | null }).animationFrameId).toBeNull();

      renderer.render();
      const extraStroke = ctx.strokeLineWidths.slice(strokesBeforeFinalRender + 3);
      expect(extraStroke[0]).toBe(4);
      expect(extraStroke[1]).toBe(4);
    });

    it('亮度目标收敛后背景色与目标值一致', () => {
      clock.setTime(0);
      renderer.setStyle({ brightness: 0.2 });

      clock.advance(400);
      clock.runFrame();

      const lastBackground = ctx.fillRects[ctx.fillRects.length - 1];
      expect(lastBackground.fillStyle).toBe('rgb(12, 12, 22)');
    });

    it('过渡中途存在插值但不超出绘制数值合法性', () => {
      clock.setTime(0);
      renderer.setWaveformData(new Float32Array(64).fill(0.5));
      renderer.setStyle({ thickness: 5, colorOffset: 0.9 });

      clock.advance(100);
      clock.runFrame();

      expect(ctx.invalidOps).toEqual([]);
      const currentThickness = ctx.strokeLineWidths[ctx.strokeLineWidths.length - 1];
      expect(Number.isFinite(currentThickness)).toBe(true);
    });
  });
});
