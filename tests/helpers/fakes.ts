/**
 * 离线测试设施：
 * - FakeClock：可控的 performance.now() 与 requestAnimationFrame，时间不真实流逝
 * - FakeAudioContext：无设备、无网络的 Web Audio 图，BufferSource 可按时钟自动结束
 * - RecordingCanvas2D：记录全部绘制指令，用于断言路径闭合、坐标不越界
 *
 * 被测模块（src/*.ts）直接读取全局 window / performance / requestAnimationFrame，
 * 因此本文件通过 setGlobals / restoreGlobals 替换全局对象。
 */

// ---------- 可控时钟 ----------

export class FakeClock {
  private nowMs: number = 0;
  private rafQueue = new Map<number, FrameCallback>();
  private nextRafId: number = 1;

  set(ms: number): void {
    this.nowMs = ms;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }

  now(): number {
    return this.nowMs;
  }

  /**
   * 运行 count 帧动画；每帧时钟前进 stepMs（模拟真实帧节奏）。
   * 播放中的引擎每帧都会重新排队，因此这里按固定帧数执行而非等到队列清空。
   */
  runFrames(count: number, stepMs: number = 16): void {
    for (let i = 0; i < count; i++) {
      const pending = Array.from(this.rafQueue.entries());
      if (pending.length === 0) return;
      this.rafQueue.clear();
      this.nowMs += stepMs;
      for (const [id, cb] of pending) cb(this.nowMs, id);
    }
  }

  requestFrame(cb: FrameCallback): number {
    const id = this.nextRafId++;
    this.rafQueue.set(id, cb);
    return id;
  }

  cancelFrame(id: number): void {
    this.rafQueue.delete(id);
  }
}

type FrameCallback = (nowMs: number, id: number) => void;

// ---------- 录制式 2D 上下文 ----------

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface Gradient {
  stops: { offset: number; color: string }[];
}

export class RecordingCanvas2D {
  calls: RecordedCall[] = [];
  fillStyle: string | Gradient = '';
  strokeStyle: string | Gradient = '';
  lineCap: string = 'butt';
  lineJoin: string = 'miter';
  globalCompositeOperation: string = 'source-over';
  lineWidthHistory: number[] = [];

  private _lineWidth: number = 1;

  get lineWidth(): number {
    return this._lineWidth;
  }

  set lineWidth(value: number) {
    this._lineWidth = value;
    this.lineWidthHistory.push(value);
  }

  // 路径状态机：beginPath 后必须出现 stroke 或 fill 才算闭合提交
  openPaths = 0;
  submittedPaths = 0;
  fillRects: [number, number, number, number][] = [];

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  beginPath(): void {
    this.record('beginPath', []);
    this.openPaths++;
  }

  moveTo(x: number, y: number): void {
    this.record('moveTo', [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.record('lineTo', [x, y]);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.record('quadraticCurveTo', [cpx, cpy, x, y]);
  }

  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.record('arc', [x, y, r, start, end]);
  }

  closePath(): void {
    this.record('closePath', []);
  }

  stroke(): void {
    this.record('stroke', []);
    if (this.openPaths > 0) {
      this.openPaths--;
      this.submittedPaths++;
    }
  }

  fill(): void {
    this.record('fill', []);
    if (this.openPaths > 0) {
      this.openPaths--;
      this.submittedPaths++;
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [x, y, w, h]);
    this.fillRects.push([x, y, w, h]);
  }

  save(): void {
    this.record('save', []);
  }

  restore(): void {
    this.record('restore', []);
  }

  scale(): void {
    this.record('scale', []);
  }

  createLinearGradient(): Gradient {
    this.record('createLinearGradient', []);
    return makeGradient();
  }

  createRadialGradient(): Gradient {
    this.record('createRadialGradient', []);
    return makeGradient();
  }

  reset(): void {
    this.calls = [];
    this.openPaths = 0;
    this.submittedPaths = 0;
    this.fillRects = [];
  }
}

function makeGradient(): Gradient {
  const g: Gradient = { stops: [] };
  (g as any).addColorStop = (offset: number, color: string) => g.stops.push({ offset, color });
  return g;
}

export interface FakeCanvas {
  width: number;
  height: number;
  ctx: RecordingCanvas2D;
  getContext: () => RecordingCanvas2D;
  getBoundingClientRect: () => DOMRectLike;
  addEventListener: () => void;
}

interface DOMRectLike {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function createCanvas(width: number = 800, height: number = 200): FakeCanvas {
  const ctx = new RecordingCanvas2D();
  return {
    width: 0,
    height: 0,
    ctx,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    addEventListener: () => {}
  };
}

// ---------- Fake Web Audio ----------

export class FakeAnalyser {
  fftSize: number = 2048;
  smoothingTimeConstant: number = 0.8;
  frequencyBinCount: number = 1024;
  connected: unknown[] = [];
  // 测试可覆盖：每次 getByteFrequencyData 写入的数据生成器
  dataProvider: ((index: number) => number) | null = null;

  connect(node: unknown): unknown {
    this.connected.push(node);
    return node;
  }

  disconnect(): void {
    this.connected = [];
  }

  getByteFrequencyData(array: Uint8Array): void {
    for (let i = 0; i < array.length; i++) {
      array[i] = this.dataProvider ? this.dataProvider(i) : 0;
    }
  }
}

export class FakeGain {
  gain: { value: number } = { value: 1 };
  connect(node: unknown): unknown {
    return node;
  }
  disconnect(): void {}
}

interface StartArgs {
  offset: number;
}

export class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  started: boolean = false;
  stopped: boolean = false;
  startArgs: StartArgs | null = null;
  // 由 FakeAudioContext 在 advanceTime 时检查
  endsAt: number | null = null;
  private ctx: FakeAudioContext;

  constructor(ctx: FakeAudioContext) {
    this.ctx = ctx;
  }

  connect(node: unknown): unknown {
    return node;
  }

  disconnect(): void {}

  start(_when: number, offset: number = 0): void {
    if (this.started || this.stopped) throw new Error('FakeBufferSource 已启动/已停止');
    this.started = true;
    this.startArgs = { offset };
    const duration = this.buffer ? this.buffer.duration : 0;
    const remaining = Math.max(0, duration - offset);
    this.endsAt = remaining === 0 ? this.ctx.currentTime : this.ctx.currentTime + remaining;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.endsAt = null;
  }
}

export interface FakeAudioBuffer {
  duration: number;
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
}

export function makeAudioBuffer(
  duration: number,
  sampleRate: number = 44100,
  channelGenerator: (index: number, total: number) => number = () => 0
): FakeAudioBuffer {
  const length = Math.round(duration * sampleRate);
  const channelData = new Float32Array(length);
  for (let i = 0; i < length; i++) channelData[i] = channelGenerator(i, length);
  return {
    duration,
    numberOfChannels: 1,
    length,
    sampleRate,
    getChannelData: () => channelData
  };
}

export class FakeAudioContext {
  currentTime: number = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination: FakeGain = new FakeGain();
  analyser: FakeAnalyser;
  activeSources: Set<FakeBufferSource> = new Set();
  decodeImpl: ((buffer: ArrayBuffer) => Promise<FakeAudioBuffer>) | null = null;

  constructor() {
    this.analyser = new FakeAnalyser();
  }

  resume(): Promise<void> {
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createAnalyser(): FakeAnalyser {
    return this.analyser;
  }

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource(this);
    this.activeSources.add(source);
    return source;
  }

  async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    if (this.decodeImpl) return this.decodeImpl(arrayBuffer);
    return makeAudioBuffer(3);
  }

  /** 推进音频时钟；自然播放结束的 source 会在此刻触发 onended。 */
  advanceTime(seconds: number): void {
    this.currentTime += seconds;
    for (const source of Array.from(this.activeSources)) {
      if (source.endsAt !== null && !source.stopped && this.currentTime >= source.endsAt) {
        source.endsAt = null;
        source.stopped = true;
        this.activeSources.delete(source);
        const cb = source.onended;
        source.onended = null;
        if (cb) cb();
      }
    }
  }
}

// ---------- 全局环境装配 ----------

export interface TestEnvironment {
  clock: FakeClock;
  audioContext: FakeAudioContext;
  windowStub: Record<string, unknown>;
  restore: () => void;
}

const savedGlobals: { name: string; descriptor?: PropertyDescriptor; value?: unknown; had: boolean }[] = [];

function saveGlobal(name: string): void {
  savedGlobals.push({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name), had: name in globalThis });
}

function restoreGlobals(): void {
  for (const item of savedGlobals.reverse()) {
    if (!item.had) {
      delete (globalThis as any)[item.name];
    } else if (item.descriptor) {
      Object.defineProperty(globalThis, item.name, item.descriptor);
    }
  }
  savedGlobals.length = 0;
}

export function setupEnvironment(): TestEnvironment {
  const clock = new FakeClock();
  const audioContext = new FakeAudioContext();

  saveGlobal('window');
  saveGlobal('AudioContext');
  saveGlobal('performance');
  saveGlobal('requestAnimationFrame');
  saveGlobal('cancelAnimationFrame');

  const windowStub: Record<string, unknown> = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    AudioContext: function () {
      return audioContext;
    },
    innerWidth: 1024,
    innerHeight: 768
  };

  (globalThis as any).window = windowStub;
  (globalThis as any).AudioContext = function () {
    return audioContext;
  };
  (globalThis as any).performance = { now: () => clock.now() };
  (globalThis as any).requestAnimationFrame = (cb: FrameCallback) => clock.requestFrame(cb);
  (globalThis as any).cancelAnimationFrame = (id: number) => clock.cancelFrame(id);

  return {
    clock,
    audioContext,
    windowStub,
    restore: restoreGlobals
  };
}

export function fakeFile(bytes: number = 32): File {
  const buffer = new ArrayBuffer(bytes);
  return { arrayBuffer: () => Promise.resolve(buffer) } as unknown as File;
}
