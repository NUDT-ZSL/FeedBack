import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, AudioEngineCallbacks } from '../src/audioEngine';
import {
  FakeAudioContext,
  ManualClock,
  installBrowserGlobals,
  makeAudioBuffer,
  makeFile,
  uninstallBrowserGlobals,
} from './helpers/fakes';

interface Harness {
  engine: AudioEngine;
  callbacks: {
    onWaveformData: ReturnType<typeof vi.fn>;
    onFrequencyData: ReturnType<typeof vi.fn>;
    onTimeUpdate: ReturnType<typeof vi.fn>;
    onPlayEnd: ReturnType<typeof vi.fn>;
  };
}

function makeEngine(): Harness {
  const callbacks = {
    onWaveformData: vi.fn(),
    onFrequencyData: vi.fn(),
    onTimeUpdate: vi.fn(),
    onPlayEnd: vi.fn(),
  };
  const engine = new AudioEngine(callbacks as unknown as AudioEngineCallbacks);
  return { engine, callbacks };
}

function lastCallArgs(fn: ReturnType<typeof vi.fn>): unknown[] {
  return fn.mock.calls[fn.mock.calls.length - 1];
}

describe('AudioEngine', () => {
  let clock: ManualClock;

  beforeEach(() => {
    clock = new ManualClock();
    clock.install();
    installBrowserGlobals();
    FakeAudioContext.reset();
  });

  afterEach(() => {
    clock.uninstall();
    uninstallBrowserGlobals();
  });

  describe('加载', () => {
    it('上报时长与初始时间，波形归一化到 0..1 且长度稳定', async () => {
      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(2, 4096, (i) => Math.sin(i / 10)));

      const { engine, callbacks } = makeEngine();
      await engine.loadAudioFile(makeFile());

      expect(engine.getDuration()).toBe(2);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([0, 2]);

      const firstWaveform = callbacks.onWaveformData.mock.calls[0][0] as Float32Array;
      expect(firstWaveform.length).toBe(2048);
      for (const value of firstWaveform) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...firstWaveform)).toBeCloseTo(1, 5);

      await engine.loadAudioFile(makeFile());
      const secondWaveform = callbacks.onWaveformData.mock.calls[1][0] as Float32Array;
      expect(secondWaveform.length).toBe(2048);
    });

    it('时长为零的音频加载后状态稳定且无 NaN', async () => {
      FakeAudioContext.decodeHandler = () => Promise.resolve(makeAudioBuffer(0, 0));

      const { engine, callbacks } = makeEngine();
      await engine.loadAudioFile(makeFile());

      expect(engine.getDuration()).toBe(0);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([0, 0]);

      const waveform = callbacks.onWaveformData.mock.calls[0][0] as Float32Array;
      expect(waveform.length).toBe(2048);
      for (const value of waveform) {
        expect(value).toBe(0);
      }

      expect(() => engine.play()).not.toThrow();
      expect(() => engine.pause()).not.toThrow();
    });

    it('加载失败后再次加载可恢复正常', async () => {
      FakeAudioContext.decodeHandler = () => Promise.reject(new Error('bad file'));

      const { engine, callbacks } = makeEngine();
      await expect(engine.loadAudioFile(makeFile())).rejects.toThrow('bad file');
      expect(engine.getDuration()).toBe(0);
      expect(engine.getIsPlaying()).toBe(false);

      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(4, 2048, () => 0.5));
      await engine.loadAudioFile(makeFile());

      expect(engine.getDuration()).toBe(4);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([0, 4]);
    });
  });

  describe('播放推进与暂停续播', () => {
    async function loadedEngine(duration = 10): Promise<Harness> {
      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(duration, 4096, () => 0.5));
      const harness = makeEngine();
      await harness.engine.loadAudioFile(makeFile());
      return harness;
    }

    it('播放后时间随音频时钟推进', async () => {
      const { engine, callbacks } = await loadedEngine();
      const ctx = FakeAudioContext.latest();

      engine.play();
      expect(engine.getIsPlaying()).toBe(true);

      ctx.currentTime = 3.5;
      expect(engine.getCurrentTime()).toBeCloseTo(3.5, 5);

      clock.runFrame();
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([3.5, 10]);
    });

    it('暂停后时间停在原处，重复暂停无副作用', async () => {
      const { engine } = await loadedEngine();
      const ctx = FakeAudioContext.latest();

      engine.play();
      ctx.currentTime = 3.5;
      engine.pause();

      expect(engine.getIsPlaying()).toBe(false);
      expect(engine.getCurrentTime()).toBeCloseTo(3.5, 5);

      ctx.currentTime = 8;
      expect(engine.getCurrentTime()).toBeCloseTo(3.5, 5);

      expect(() => engine.pause()).not.toThrow();
      expect(engine.getCurrentTime()).toBeCloseTo(3.5, 5);
    });

    it('再次播放从暂停点续播而不是从头开始', async () => {
      const { engine } = await loadedEngine();
      const ctx = FakeAudioContext.latest();

      engine.play();
      ctx.currentTime = 3.5;
      engine.pause();

      engine.play();
      expect(ctx.latestSource().startOffset).toBeCloseTo(3.5, 5);

      ctx.currentTime = 5;
      expect(engine.getCurrentTime()).toBeCloseTo(5, 5);
    });

    it('播放时通过动画帧回调频谱数据', async () => {
      const { engine, callbacks } = await loadedEngine();
      const ctx = FakeAudioContext.latest();
      ctx.analyser.nextFrequencyData = new Uint8Array(128).fill(200);

      engine.play();
      clock.runFrame();

      expect(callbacks.onFrequencyData).toHaveBeenCalled();
      const data = callbacks.onFrequencyData.mock.calls[0][0] as Uint8Array;
      expect(data.length).toBe(128);
      expect(data[0]).toBe(200);
    });
  });

  describe('进度跳转', () => {
    async function loadedEngine(duration = 10): Promise<Harness> {
      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(duration, 4096, () => 0.5));
      const harness = makeEngine();
      await harness.engine.loadAudioFile(makeFile());
      return harness;
    }

    it('seek 后当前时间与目标比例一致', async () => {
      const { engine, callbacks } = await loadedEngine();

      engine.seek(2.5);
      expect(engine.getCurrentTime()).toBeCloseTo(2.5, 5);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([2.5, 10]);

      engine.seek(0);
      expect(engine.getCurrentTime()).toBe(0);
    });

    it('播放中 seek 后仍保持播放并从新位置推进', async () => {
      const { engine } = await loadedEngine();
      const ctx = FakeAudioContext.latest();

      engine.play();
      ctx.currentTime = 2;
      engine.seek(7);

      expect(engine.getIsPlaying()).toBe(true);
      expect(engine.getCurrentTime()).toBeCloseTo(7, 5);

      ctx.currentTime = 3;
      expect(engine.getCurrentTime()).toBeCloseTo(8, 5);
    });

    it('seek 到负数或超过时长会被钳制到边界', async () => {
      const { engine, callbacks } = await loadedEngine();

      engine.seek(-5);
      expect(engine.getCurrentTime()).toBe(0);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([0, 10]);

      engine.seek(999);
      expect(engine.getCurrentTime()).toBe(10);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([10, 10]);
    });

    it('播放中 seek 超出范围仍钳制且保持播放', async () => {
      const { engine } = await loadedEngine();
      engine.play();

      engine.seek(-3);
      expect(engine.getIsPlaying()).toBe(true);
      expect(engine.getCurrentTime()).toBe(0);

      engine.seek(42);
      expect(engine.getIsPlaying()).toBe(true);
      expect(engine.getCurrentTime()).toBe(10);
    });
  });

  describe('播放结束', () => {
    it('自然结束时时间回到起点且播放状态复位', async () => {
      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(10, 4096, () => 0.5));
      const { engine, callbacks } = makeEngine();
      await engine.loadAudioFile(makeFile());
      const ctx = FakeAudioContext.latest();

      engine.play();
      ctx.currentTime = 10;
      ctx.latestSource().simulateEnded();

      expect(callbacks.onPlayEnd).toHaveBeenCalledTimes(1);
      expect(engine.getIsPlaying()).toBe(false);
      expect(engine.getCurrentTime()).toBe(0);

      engine.play();
      expect(ctx.latestSource().startOffset).toBe(0);
    });
  });

  describe('未加载与异常操作', () => {
    it('未加载时播放、暂停、seek 均为安全无操作', () => {
      const { engine, callbacks } = makeEngine();

      expect(() => engine.play()).not.toThrow();
      expect(engine.getIsPlaying()).toBe(false);

      expect(() => engine.pause()).not.toThrow();
      expect(() => engine.stop()).not.toThrow();

      engine.seek(5);
      expect(engine.getCurrentTime()).toBe(0);
      expect(lastCallArgs(callbacks.onTimeUpdate)).toEqual([0, 0]);

      expect(engine.getDuration()).toBe(0);
    });

    it('重复播放调用不会创建额外播放状态', async () => {
      FakeAudioContext.decodeHandler = () =>
        Promise.resolve(makeAudioBuffer(10, 4096, () => 0.5));
      const { engine } = makeEngine();
      await engine.loadAudioFile(makeFile());
      const ctx = FakeAudioContext.latest();

      engine.play();
      engine.play();
      engine.play();

      expect(ctx.sources.length).toBe(1);
      expect(engine.getIsPlaying()).toBe(true);
    });
  });
});
