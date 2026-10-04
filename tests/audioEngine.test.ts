import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audioEngine.ts';
import {
  setupEnvironment,
  type TestEnvironment,
  fakeFile,
  makeAudioBuffer
} from './helpers/fakes.ts';

let env: TestEnvironment;

function createEngine() {
  const events: {
    timeUpdates: { time: number; duration: number }[];
    waveform: Float32Array | null;
    frequency: Uint8Array[];
    playEnds: number;
  } = { timeUpdates: [], waveform: null, frequency: [], playEnds: 0 };

  const engine = new AudioEngine({
    onWaveformData: (data) => {
      events.waveform = data;
    },
    onFrequencyData: (data) => {
      events.frequency.push(data);
    },
    onTimeUpdate: (time, duration) => {
      events.timeUpdates.push({ time, duration });
    },
    onPlayEnd: () => {
      events.playEnds++;
    }
  });

  return { engine, events };
}

function makeSineLike(index: number, total: number): number {
  return Math.sin((index / total) * Math.PI * 6);
}

beforeEach(() => {
  env = setupEnvironment();
});

afterEach(() => {
  env.restore();
});

// ---------- 加载 ----------

test('加载后上报正确时长，初始时间为 0', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine, events } = createEngine();

  await engine.loadAudioFile(fakeFile());

  assert.equal(engine.getDuration(), 10);
  assert.equal(engine.getCurrentTime(), 0);
  const first = events.timeUpdates[0];
  assert.deepEqual(first, { time: 0, duration: 10 });
  assert.equal(engine.getIsPlaying(), false);
});

test('波形数据长度固定 2048，归一化到 0..1，重复加载结果稳定', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(3, 44100, makeSineLike);
  const { engine, events } = createEngine();

  await engine.loadAudioFile(fakeFile());
  const data = events.waveform!;
  assert.equal(data.length, 2048);
  let max = 0;
  for (const v of data) {
    assert.ok(Number.isFinite(v), '波形值必须是有限数');
    assert.ok(v >= 0 && v <= 1, `波形值越界: ${v}`);
    if (v > max) max = v;
  }
  assert.ok(max > 0, '非静音音频归一化后最大值应为 1 附近');
  assert.ok(Math.abs(max - 1) < 1e-6, `最大值应归一化为 1，实际 ${max}`);

  const snapshot = Array.from(data);
  env.audioContext.decodeImpl = async () => makeAudioBuffer(3, 44100, makeSineLike);
  await engine.loadAudioFile(fakeFile());
  assert.deepEqual(Array.from(events.waveform!), snapshot);
});

test('静音音频波形全为 0 且不产生 NaN', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(2);
  const { engine, events } = createEngine();

  await engine.loadAudioFile(fakeFile());
  const data = events.waveform!;
  assert.equal(data.length, 2048);
  assert.ok(Array.from(data).every((v) => v === 0));
});

// ---------- 播放 / 暂停 / 续播 ----------

test('播放后时间随时钟推进，回调持续上报', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine, events } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.play();
  assert.equal(engine.getIsPlaying(), true);

  env.audioContext.advanceTime(1.5);
  assert.ok(Math.abs(engine.getCurrentTime() - 1.5) < 1e-9);

  env.clock.runFrames(3);
  const reported = events.timeUpdates.map((u) => u.time);
  assert.ok(reported.some((t) => Math.abs(t - 1.5) < 1e-9), '动画帧应上报推进后的时间');
});

test('暂停后时间停住，再次播放从暂停点续播而非从头', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.play();
  env.audioContext.advanceTime(2);
  const pausedAt = engine.getCurrentTime();
  assert.ok(Math.abs(pausedAt - 2) < 1e-9);

  engine.pause();
  assert.equal(engine.getIsPlaying(), false);

  env.audioContext.advanceTime(5);
  assert.ok(Math.abs(engine.getCurrentTime() - 2) < 1e-9, '暂停后时间不应继续推进');

  engine.play();
  const source = getLastSource(env);
  assert.ok(Math.abs(source.startArgs!.offset - 2) < 1e-9, '续播必须从暂停点 offset=2 开始');

  env.audioContext.advanceTime(1);
  assert.ok(Math.abs(engine.getCurrentTime() - 3) < 1e-9, '续播后时间应继续累加');
});

test('播放中持续输出频谱数据', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine, events } = createEngine();
  await engine.loadAudioFile(fakeFile());
  env.audioContext.analyser.dataProvider = (i) => (i % 8 === 0 ? 200 : 20);

  engine.play();
  env.clock.runFrames(3);

  assert.ok(events.frequency.length > 0, '动画帧应读取频谱数据');
  const frame = events.frequency[events.frequency.length - 1];
  assert.ok(frame.some((v) => v === 200));
});

// ---------- seek ----------

test('拖动到任意比例后当前时间与进度比例一致', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine, events } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.seek(0.25 * 10);
  assert.ok(Math.abs(engine.getCurrentTime() - 2.5) < 1e-9);
  assert.equal(engine.getIsPlaying(), false);

  const last = events.timeUpdates[events.timeUpdates.length - 1];
  assert.ok(Math.abs(last.time / last.duration - 0.25) < 1e-9);
});

test('播放中拖动后仍保持播放，且从新位置继续', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.play();
  env.audioContext.advanceTime(1);
  assert.equal(engine.getIsPlaying(), true);

  engine.seek(7);
  assert.equal(engine.getIsPlaying(), true, '拖动不应打断播放状态');
  const source = getLastSource(env);
  assert.ok(Math.abs(source.startArgs!.offset - 7) < 1e-9);

  env.audioContext.advanceTime(1);
  assert.ok(Math.abs(engine.getCurrentTime() - 8) < 1e-9);
});

test('seek 负数被钳制为 0', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.seek(-5);
  assert.equal(engine.getCurrentTime(), 0);
});

test('seek 超过时长被钳制到时长（对应进度比例 > 1）', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.seek(999);
  assert.equal(engine.getCurrentTime(), 10);
});

test('时长为 0 时 seek 不抛错且停留在 0', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(0, 44100);
  const { engine, events } = createEngine();

  await assert.doesNotReject(engine.loadAudioFile(fakeFile()));
  assert.equal(engine.getDuration(), 0);
  assert.doesNotThrow(() => engine.seek(3));
  assert.equal(engine.getCurrentTime(), 0);
  const wave = events.waveform!;
  assert.equal(wave.length, 2048);
  assert.ok(Array.from(wave).every((v) => v === 0));
});

// ---------- 自然结束 ----------

test('播放自然结束时时间回到起点、状态复位、触发 onPlayEnd', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(5);
  const { engine, events } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.play();
  env.audioContext.advanceTime(3);
  engine.pause();
  engine.play();
  env.audioContext.advanceTime(2);

  assert.equal(events.playEnds, 1);
  assert.equal(engine.getIsPlaying(), false);
  assert.equal(engine.getCurrentTime(), 0, '结束后应复位到起点');
});

// ---------- 边界与异常 ----------

test('未加载时播放/暂停/seek 均为安全空操作', () => {
  const { engine } = createEngine();
  assert.doesNotThrow(() => engine.play());
  assert.doesNotThrow(() => engine.pause());
  assert.doesNotThrow(() => engine.pause());
  assert.doesNotThrow(() => engine.seek(1));
  assert.equal(engine.getIsPlaying(), false);
  assert.equal(engine.getCurrentTime(), 0);
  assert.equal(engine.getDuration(), 0);
});

test('重复暂停不改变状态、不抛错', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());

  engine.play();
  env.audioContext.advanceTime(1);
  engine.pause();
  const t = engine.getCurrentTime();
  engine.pause();
  engine.pause();
  assert.equal(engine.getIsPlaying(), false);
  assert.equal(engine.getCurrentTime(), t);
});

test('加载失败后再次加载可正常恢复', async () => {
  const engineBundle = createEngine();
  const { engine } = engineBundle;

  env.audioContext.decodeImpl = async () => {
    throw new Error('decode failed: bad data');
  };
  await assert.rejects(engine.loadAudioFile(fakeFile()), /decode failed/);
  assert.equal(engine.getIsPlaying(), false);
  assert.equal(engine.getDuration(), 0);

  env.audioContext.decodeImpl = async () => makeAudioBuffer(4);
  await assert.doesNotReject(engine.loadAudioFile(fakeFile()));
  assert.equal(engine.getDuration(), 4);
  assert.equal(engine.getCurrentTime(), 0);

  engine.play();
  assert.equal(engine.getIsPlaying(), true);
  env.audioContext.advanceTime(1);
  assert.ok(Math.abs(engine.getCurrentTime() - 1) < 1e-9);
});

test('重新加载会停止旧播放并复位到起点', async () => {
  env.audioContext.decodeImpl = async () => makeAudioBuffer(10);
  const { engine } = createEngine();
  await engine.loadAudioFile(fakeFile());
  engine.play();
  env.audioContext.advanceTime(3);

  env.audioContext.decodeImpl = async () => makeAudioBuffer(8);
  await engine.loadAudioFile(fakeFile());
  assert.equal(engine.getIsPlaying(), false);
  assert.equal(engine.getCurrentTime(), 0);
  assert.equal(engine.getDuration(), 8);
});

function getLastSource(env: TestEnvironment) {
  const sources = Array.from(env.audioContext.activeSources);
  return sources[sources.length - 1];
}
