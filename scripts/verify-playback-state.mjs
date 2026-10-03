/**
 * 播放状态一致性离线验证（无需浏览器、无需网络）。
 *
 * 用 mock 的 Web Audio API（手动推进的时钟）驱动编译后的 AudioEngine，
 * 验证暂停位置 / 选区 / 循环 / 当前时间在任意操作序列下保持一致。
 *
 * 运行：npm run verify
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const BUFFER_DURATION = 10; // 秒，mock 音频长度

/* ---------------- Mock Web Audio API ---------------- */

class MockBufferSourceNode {
  constructor(context) {
    this.context = context;
    this.buffer = null;
    this.onended = null;
    this.endAt = null;
    this.startedOffset = null;
    this.startedDuration = null;
  }
  connect() {}
  disconnect() {}
  start(when, offset, duration) {
    this.startedOffset = offset;
    this.startedDuration = duration === undefined ? null : duration;
    const playLength = duration === undefined ? this.buffer.duration - offset : duration;
    this.endAt = this.context.currentTime + Math.max(0, playLength);
    this.context._liveSources.add(this);
  }
  stop() {
    if (this.endAt === null) return;
    this.endAt = Math.min(this.endAt, this.context.currentTime);
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.createdSources = [];
    this._liveSources = new Set();
    MockAudioContext.lastInstance = this;
  }
  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      connect() {},
      disconnect() {},
      getByteFrequencyData() {},
      getByteTimeDomainData() {}
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const source = new MockBufferSourceNode(this);
    this.createdSources.push(source);
    return source;
  }
  async decodeAudioData() {
    return {
      duration: BUFFER_DURATION,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(44100)
    };
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }

  /** 推进时钟，并按顺序触发到期的 onended（模拟真实播放结束）。 */
  advance(seconds) {
    const target = this.currentTime + seconds;
    for (;;) {
      let next = null;
      for (const source of this._liveSources) {
        if (source.endAt !== null && source.endAt <= target && (!next || source.endAt < next.endAt)) {
          next = source;
        }
      }
      if (!next) break;
      this.currentTime = next.endAt;
      this._liveSources.delete(next);
      const callback = next.onended;
      if (callback) callback();
    }
    this.currentTime = target;
  }
}

const makeFile = (name = 'test.mp3') => ({
  name,
  size: 12345,
  arrayBuffer: async () => new ArrayBuffer(8)
});

/* ---------------- 加载编译后的 AudioEngine ---------------- */

globalThis.window = { AudioContext: MockAudioContext };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(rootDir, 'src', 'AudioEngine.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 }
});
const tmpDir = mkdtempSync(join(tmpdir(), 'audio-engine-verify-'));
writeFileSync(join(tmpDir, 'AudioEngine.mjs'), outputText);
const { AudioEngine } = await import(pathToFileURL(join(tmpDir, 'AudioEngine.mjs')).href);

/* ---------------- 测试工具 ---------------- */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

async function createEngine() {
  const engine = new AudioEngine();
  const context = MockAudioContext.lastInstance;
  const events = { selection: [], state: [], ended: 0 };
  engine.setSelectionChangeCallback((sel) => events.selection.push(sel));
  engine.setStateChangeCallback((playing) => events.state.push(playing));
  engine.setEndedCallback(() => { events.ended++; });
  await engine.loadAudioFile(makeFile());
  return { engine, context, events };
}

const lastSource = (context) => context.createdSources[context.createdSources.length - 1];

/* ---------------- 场景 ---------------- */

async function testPauseSeekPlay() {
  console.log('\n[1] 暂停后拖动进度条再播放 → 从拖动位置继续');
  const { engine, context } = await createEngine();

  engine.play();
  context.advance(2);
  engine.pause();
  assert(approx(engine.getCurrentTime(), 2), '暂停后当前时间 = 2s');

  engine.seek(5);
  assert(approx(engine.getCurrentTime(), 5), '拖动后（暂停中）时间显示 = 5s');

  engine.play();
  const source = lastSource(context);
  assert(approx(source.startedOffset, 5), '重新播放的音频偏移 = 5s');
  assert(source.startedDuration === null, '无选区时播放到文件末尾');

  context.advance(1);
  assert(approx(engine.getCurrentTime(), 6), '播放 1s 后时间显示 = 6s（与听到的位置一致）');
}

async function testSelectionPauseResume() {
  console.log('\n[2] 带选区暂停再播放 → 仍只播放选区，时间落在选区内');
  const { engine, context, events } = await createEngine();

  engine.setSelection({ start: 2, end: 6 });
  engine.play();
  let source = lastSource(context);
  assert(approx(source.startedOffset, 2) && approx(source.startedDuration, 4), '首次播放范围 = [2, 6]');

  context.advance(1.5);
  engine.pause();
  assert(approx(engine.getCurrentTime(), 3.5), '暂停时间 = 3.5s（选区内）');

  engine.play();
  source = lastSource(context);
  assert(approx(source.startedOffset, 3.5), '续播从暂停位置 3.5s 开始，而非选区起点');
  assert(approx(source.startedDuration, 2.5), '续播在选区终点 6s 结束');

  context.advance(1);
  const t = engine.getCurrentTime();
  assert(t >= 2 && t <= 6, `播放中时间 ${t.toFixed(2)}s 落在选区 [2, 6] 内`);

  context.advance(2); // 越过选区终点 → 自然结束
  assert(!engine.getIsPlaying(), '选区播完自动停止');
  assert(approx(engine.getCurrentTime(), 0), '非循环自然结束后时间归零');
  assert(engine.getSelection() === null, '非循环自然结束后选区清空');
  assert(events.selection.at(-1) === null, '选区清空已通知 UI');
  assert(events.ended === 1, '结束回调触发一次');
}

async function testSeekWithSelection() {
  console.log('\n[3] 有选区时拖动进度 → 选区与实际播放范围保持一致');
  const { engine, context } = await createEngine();

  engine.setSelection({ start: 2, end: 6 });
  engine.seek(4); // 暂停中，选区内
  assert(engine.getSelection() !== null, '选区内 seek：选区保留');
  assert(approx(engine.getCurrentTime(), 4), '选区内 seek：时间 = 4s');
  engine.play();
  let source = lastSource(context);
  assert(approx(source.startedOffset, 4) && approx(source.startedDuration, 2), '选区内 seek 后播放范围 = [4, 6]');

  engine.seek(8); // 播放中，选区外
  assert(engine.getSelection() === null, '选区外 seek：选区清除（不再脱节）');
  source = lastSource(context);
  assert(approx(source.startedOffset, 8) && source.startedDuration === null, '选区外 seek 后从 8s 播到文件末尾');
  assert(engine.getIsPlaying(), '播放中 seek 不中断播放状态');

  engine.pause();
  engine.setSelection({ start: 1, end: 3 });
  engine.seek(9); // 暂停中，选区外
  assert(engine.getSelection() === null, '暂停时选区外 seek 同样清除选区');
  assert(approx(engine.getCurrentTime(), 9), '暂停时选区外 seek 后时间 = 9s');
}

async function testLoop() {
  console.log('\n[4] 循环播放 → 选区/全曲都能真正循环');
  const { engine, context } = await createEngine();

  engine.setSelection({ start: 2, end: 6 });
  engine.toggleLoop();
  engine.play();
  context.advance(10); // 选区长 4s，应循环 2 次以上
  assert(engine.getIsPlaying(), '选区循环：10s 后仍在播放');
  let source = lastSource(context);
  assert(approx(source.startedOffset, 2) && approx(source.startedDuration, 4), '选区循环：每轮都从头播放 [2, 6]');
  const t = engine.getCurrentTime();
  assert(t >= 2 && t <= 6, `选区循环中时间 ${t.toFixed(2)}s 落在选区内`);

  engine.toggleLoop(); // 关闭循环
  context.advance(5); // 当前一轮播完 → 自然结束
  assert(!engine.getIsPlaying(), '关闭循环后本轮结束即停止');
  assert(approx(engine.getCurrentTime(), 0) && engine.getSelection() === null, '停止后时间与选区复位');

  engine.toggleLoop();
  engine.play(); // 无选区全曲循环
  context.advance(15);
  source = lastSource(context);
  assert(approx(source.startedOffset, 0) && source.startedDuration === null, '全曲循环：结束后从 0 重新播放');
  assert(engine.getIsPlaying(), '全曲循环：15s 后仍在播放');
}

async function testStopAndReload() {
  console.log('\n[5] 停止 / 重新加载 → 选区与时间彻底复位');
  const { engine, context, events } = await createEngine();

  engine.setSelection({ start: 2, end: 6 });
  engine.play();
  context.advance(1);
  engine.stop();
  assert(approx(engine.getCurrentTime(), 0), '停止后时间 = 0');
  assert(engine.getSelection() === null, '停止后选区清空');
  assert(events.selection.at(-1) === null, '停止后选区清空已通知 UI');

  engine.play();
  const source = lastSource(context);
  assert(approx(source.startedOffset, 0) && source.startedDuration === null, '停止后再播放：从头播放全曲，无残留选区');

  engine.setSelection({ start: 3, end: 7 });
  context.advance(1);
  await engine.loadAudioFile(makeFile('other.wav'));
  assert(approx(engine.getCurrentTime(), 0), '重新加载后时间 = 0');
  assert(engine.getSelection() === null, '重新加载后选区清空');
  assert(!engine.getIsPlaying(), '重新加载后处于停止状态');
}

async function testContinuousSequence() {
  console.log('\n[6] 连续混合操作 → 各状态不互相覆盖');
  const { engine, context } = await createEngine();

  engine.play();
  context.advance(1);
  engine.pause();                    // t = 1
  engine.seek(3);                    // t = 3
  engine.setSelection({ start: 4, end: 8 }); // 暂停位置在选区外 → 夹到选区起点
  assert(approx(engine.getCurrentTime(), 4), '建立选区后暂停位置夹入选区（t = 4）');

  engine.play();
  let source = lastSource(context);
  assert(approx(source.startedOffset, 4) && approx(source.startedDuration, 4), '播放范围 = [4, 8]');

  context.advance(2);
  engine.pause();                    // t = 6
  engine.seek(5);                    // 选区内
  engine.play();
  source = lastSource(context);
  assert(approx(source.startedOffset, 5) && approx(source.startedDuration, 3), '选区内暂停+seek 后续播范围 = [5, 8]');

  engine.toggleLoop();
  context.advance(10);               // 循环 [4, 8]
  assert(engine.getIsPlaying(), '循环中');
  const t = engine.getCurrentTime();
  assert(t >= 4 && t <= 8, `循环中时间 ${t.toFixed(2)}s 落在选区 [4, 8] 内`);

  engine.stop();
  assert(approx(engine.getCurrentTime(), 0), '停止后时间 = 0');
  assert(engine.getSelection() === null, '停止后选区清空');

  engine.play();
  source = lastSource(context);
  assert(approx(source.startedOffset, 0) && source.startedDuration === null, '停止后再播放：全曲从头，无残留状态');
}

/* ---------------- 运行 ---------------- */

console.log('播放状态一致性验证（离线 mock Web Audio）');
await testPauseSeekPlay();
await testSelectionPauseResume();
await testSeekWithSelection();
await testLoop();
await testStopAndReload();
await testContinuousSequence();

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
