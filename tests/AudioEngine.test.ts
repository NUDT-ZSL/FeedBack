/**
 * AudioEngine 离线集成测试（Mock Web Audio API，无浏览器依赖）
 * 验证引擎把状态机变化正确翻译成音频图操作：
 * 暂停/拖动/选区/循环/停止/重新加载在任意操作序列下保持一致。
 * 运行：node tests/AudioEngine.test.ts
 */
import { AudioEngine, type PlaybackSnapshot } from '../src/AudioEngine.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------- Mock Web Audio ----------

class MockSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startArgs: { offset: number; duration?: number } | null = null;
  stopped = false;
  connected = false;

  connect(): void {
    this.connected = true;
  }
  disconnect(): void {}
  start(_when: number, offset: number, duration?: number): void {
    this.startArgs = { offset, duration };
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128;
  connect(): void {}
  disconnect(): void {}
  getByteFrequencyData(arr: Uint8Array): void {
    arr.fill(7);
  }
  getByteTimeDomainData(arr: Uint8Array): void {
    arr.fill(128);
  }
}

class MockGainNode {
  gain = { value: 1 };
  connect(): void {}
  disconnect(): void {}
}

class MockAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  sources: MockSourceNode[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }
  createGain(): MockGainNode {
    return new MockGainNode();
  }
  createBufferSource(): MockSourceNode {
    const source = new MockSourceNode();
    this.sources.push(source);
    return source;
  }
  decodeAudioData(): Promise<{ duration: number; sampleRate: number }> {
    return Promise.resolve({ duration: 10, sampleRate: 44100 });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const g = globalThis as Record<string, unknown>;
g.window = { AudioContext: MockAudioContext };
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

// ---------- 测试辅助 ----------

const DURATION = 10;

async function makeEngine() {
  const engine = new AudioEngine();
  const ctx = (engine as unknown as { audioContext: MockAudioContext }).audioContext;
  const snapshots: PlaybackSnapshot[] = [];
  engine.subscribe(snap => snapshots.push(snap));
  const file = new File([new Uint8Array(8)], 'test.mp3', { type: 'audio/mpeg' });
  await engine.loadAudioFile(file);
  snapshots.length = 0;
  return {
    engine,
    ctx,
    lastSnapshot: () => snapshots[snapshots.length - 1],
    lastSource: () => ctx.sources[ctx.sources.length - 1],
    fireEnded: () => {
      const source = ctx.sources[ctx.sources.length - 1];
      source.onended?.();
    }
  };
}

// 1. 加载后状态复位
{
  const { engine } = await makeEngine();
  const snap = engine.getSnapshot();
  check('加载后时长正确', approx(snap.duration, DURATION));
  check('加载后位置为 0', approx(snap.position, 0));
  check('加载后无选区', snap.selection === null);
  check('加载后未播放', !snap.isPlaying);
}

// 2. 暂停后拖动进度条再播放：从拖动后的位置继续
{
  const { engine, ctx, lastSource } = await makeEngine();
  engine.play();
  ctx.currentTime = 3;
  engine.pause();
  check('暂停位置与听到的一致', approx(engine.getSnapshot().position, 3));
  engine.seek(5);
  check('暂停拖动进度条：时间显示更新到拖动位置', approx(engine.getSnapshot().position, 5));
  engine.play();
  check('再播放：音源从拖动位置开始', approx(lastSource().startArgs!.offset, 5));
  check('再播放：音源播放到曲末', approx(lastSource().startArgs!.duration!, 5));
  ctx.currentTime = 7;
  check('时间显示与实际播放位置一致', approx(engine.getSnapshot().position, 9));
}

// 3. 带选区暂停再播放：仍只播放选区范围，时间落在选区内
{
  const { engine, ctx, lastSource } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.play();
  check('选区播放：从选区起点开始', approx(lastSource().startArgs!.offset, 2));
  check('选区播放：只播放选区长度', approx(lastSource().startArgs!.duration!, 2));
  ctx.currentTime = 1;
  engine.pause();
  check('带选区暂停：位置在选区内', approx(engine.getSnapshot().position, 3));
  engine.play();
  check('带选区再播放：从暂停点继续', approx(lastSource().startArgs!.offset, 3));
  check('带选区再播放：仍只到选区末端', approx(lastSource().startArgs!.duration!, 1));
  const snap = engine.getSnapshot();
  check('选区在播放后依然保留', !!snap.selection && snap.selection.start === 2 && snap.selection.end === 4);
}

// 4. 带选区暂停后拖动进度条：位置夹在选区内，再播放不越界
{
  const { engine, ctx, lastSource } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.play();
  ctx.currentTime = 1;
  engine.pause();
  engine.seek(9);
  check('拖到选区外：时间显示夹回选区内', engine.getSnapshot().position <= 4 + 1e-9);
  engine.play();
  const args = lastSource().startArgs!;
  check('再播放：起点不越出选区', args.offset >= 2 - 1e-9 && args.offset <= 4 + 1e-9);
  check('再播放：范围不越出选区', args.offset + args.duration! <= 4 + 1e-9);
}

// 5. 播放中拖动进度条：立即从新位置继续
{
  const { engine, ctx, lastSource } = await makeEngine();
  engine.play();
  ctx.currentTime = 2;
  engine.seek(6);
  check('播放中拖动：新音源从拖动位置开始', approx(lastSource().startArgs!.offset, 6));
  ctx.currentTime = 3;
  check('播放中拖动后：时间与新位置一致', approx(engine.getSnapshot().position, 7));
}

// 6. 循环：选区循环回到选区起点；开关循环不影响其它状态
{
  const { engine, ctx, lastSource, fireEnded } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.toggleLoop();
  engine.play();
  ctx.currentTime = 2;
  fireEnded();
  check('选区循环：回到选区起点继续', approx(lastSource().startArgs!.offset, 2));
  check('选区循环：选区保留', engine.getSnapshot().selection !== null);
  check('选区循环：仍在播放', engine.getSnapshot().isPlaying);

  const posBefore = engine.getSnapshot().position;
  engine.toggleLoop();
  const after = engine.getSnapshot();
  check('关闭循环：位置不变', approx(after.position, posBefore, 1e-3));
  check('关闭循环：选区不变', after.selection !== null);
  check('关闭循环：播放状态不变', after.isPlaying);
}

// 7. 自然结束（非循环）：等同停止，选区清空、时间归零
{
  const { engine, ctx, fireEnded } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.play();
  ctx.currentTime = 2;
  fireEnded();
  const snap = engine.getSnapshot();
  check('自然结束：停止播放', !snap.isPlaying);
  check('自然结束：时间归零', approx(snap.position, 0));
  check('自然结束：选区彻底清空', snap.selection === null);
}

// 8. 停止：选区与时间彻底清空
{
  const { engine, ctx } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.play();
  ctx.currentTime = 1;
  engine.stop();
  const snap = engine.getSnapshot();
  check('停止：时间归零', approx(snap.position, 0));
  check('停止：选区清空', snap.selection === null);
  check('停止：不再播放', !snap.isPlaying);
  engine.play();
  check('停止后再播放：从头开始', approx(engine.getSnapshot().position, 0, 1e-3));
}

// 9. 重新加载文件：旧选区不残留，时间归零
{
  const { engine, ctx } = await makeEngine();
  engine.setSelection({ start: 2, end: 4 });
  engine.play();
  ctx.currentTime = 1;
  const file = new File([new Uint8Array(8)], 'next.mp3', { type: 'audio/mpeg' });
  await engine.loadAudioFile(file);
  const snap = engine.getSnapshot();
  check('重新加载：时间归零', approx(snap.position, 0));
  check('重新加载：旧选区清空', snap.selection === null);
  check('重新加载：停止播放', !snap.isPlaying);
}

// 10. 连续操作序列：快照推送与引擎查询始终一致，且不变量成立
{
  const { engine, ctx, lastSnapshot } = await makeEngine();
  let ok = true;
  const verify = () => {
    const snap = engine.getSnapshot();
    const pushed = lastSnapshot();
    if (!pushed) return false;
    if (snap.position < -1e-9 || snap.position > snap.duration + 1e-9) return false;
    if (snap.selection) {
      if (snap.selection.end <= snap.selection.start) return false;
      if (snap.position < snap.selection.start - 1e-6 || snap.position > snap.selection.end + 1e-6) return false;
    }
    return pushed.isPlaying === snap.isPlaying &&
      pushed.isLooping === snap.isLooping &&
      (pushed.selection === null) === (snap.selection === null);
  };

  const steps: Array<() => void> = [
    () => engine.play(),
    () => { ctx.currentTime += 1.5; },
    () => engine.pause(),
    () => engine.seek(7),
    () => engine.setSelection({ start: 1, end: 3 }),
    () => engine.play(),
    () => { ctx.currentTime += 0.5; },
    () => engine.toggleLoop(),
    () => engine.seek(0.2),
    () => engine.pause(),
    () => engine.setSelection(null),
    () => engine.seek(8),
    () => engine.play(),
    () => { ctx.currentTime += 0.25; },
    () => engine.stop(),
    () => engine.toggleLoop(),
    () => engine.setSelection({ start: 4, end: 6 }),
    () => engine.stop()
  ];
  for (const step of steps) {
    step();
    if (!verify()) {
      ok = false;
      break;
    }
  }
  check('连续混合操作：状态不被互相覆盖、不变量成立', ok);
  const finalSnap = engine.getSnapshot();
  check('序列结束停止后：时间归零且选区清空',
    approx(finalSnap.position, 0) && finalSnap.selection === null);
}

console.log(`AudioEngine: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
