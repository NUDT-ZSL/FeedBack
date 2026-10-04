import { vi } from 'vitest';

export class ManualClock {
  now = 0;
  private rafCallbacks = new Map<number, (time: number) => void>();
  private nextRafId = 1;

  install(): void {
    vi.spyOn(performance, 'now').mockImplementation(() => this.now);
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (time: number) => void): number => {
      const id = this.nextRafId++;
      this.rafCallbacks.set(id, cb);
      return id;
    };
    (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number): void => {
      this.rafCallbacks.delete(id);
    };
  }

  uninstall(): void {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
  }

  setTime(ms: number): void {
    this.now = ms;
  }

  advance(ms: number): void {
    this.now += ms;
  }

  runFrame(): void {
    const callbacks = [...this.rafCallbacks.values()];
    this.rafCallbacks.clear();
    for (const cb of callbacks) cb(this.now);
  }

  runFrames(count: number): void {
    for (let i = 0; i < count; i++) this.runFrame();
  }

  get pendingFrameCount(): number {
    return this.rafCallbacks.size;
  }
}

export class FakeAudioBuffer {
  readonly duration: number;
  private readonly channelData: Float32Array;

  constructor(duration: number, channelData: Float32Array) {
    this.duration = duration;
    this.channelData = channelData;
  }

  getChannelData(_channel: number): Float32Array {
    return this.channelData;
  }
}

export class FakeAudioBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  startOffset = 0;

  connect(): void {}
  disconnect(): void {}

  start(_when = 0, offset = 0): void {
    this.started = true;
    this.startOffset = offset;
  }

  stop(): void {
    this.stopped = true;
  }

  simulateEnded(): void {
    this.onended?.();
  }
}

export class FakeAnalyserNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  nextFrequencyData: Uint8Array | null = null;

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  getByteFrequencyData(target: Uint8Array): void {
    if (this.nextFrequencyData) {
      target.set(this.nextFrequencyData.subarray(0, target.length));
    } else {
      target.fill(0);
    }
  }

  connect(): void {}
  disconnect(): void {}
}

export class FakeGainNode {
  gain = { value: 1 };
  connect(): void {}
  disconnect(): void {}
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static decodeHandler: (arrayBuffer: ArrayBuffer) => Promise<FakeAudioBuffer> = () =>
    Promise.reject(new Error('decodeAudioData not stubbed'));

  static reset(): void {
    FakeAudioContext.instances = [];
    FakeAudioContext.decodeHandler = () => Promise.reject(new Error('decodeAudioData not stubbed'));
  }

  static latest(): FakeAudioContext {
    const ctx = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
    if (!ctx) throw new Error('No FakeAudioContext has been created');
    return ctx;
  }

  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly destination = {};
  readonly analyser = new FakeAnalyserNode();
  readonly sources: FakeAudioBufferSourceNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    return FakeAudioContext.decodeHandler(arrayBuffer);
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const source = new FakeAudioBufferSourceNode();
    this.sources.push(source);
    return source;
  }

  createAnalyser(): FakeAnalyserNode {
    return this.analyser;
  }

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  latestSource(): FakeAudioBufferSourceNode {
    const source = this.sources[this.sources.length - 1];
    if (!source) throw new Error('No buffer source has been created');
    return source;
  }
}

export interface RecordedOp {
  name: string;
  args: unknown[];
}

export class FakeGradient {
  stops: Array<[number, string]> = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

export class FakeCanvasRenderingContext2D {
  ops: RecordedOp[] = [];
  invalidOps: RecordedOp[] = [];
  strokeLineWidths: number[] = [];
  fillRects: Array<{ x: number; y: number; w: number; h: number; fillStyle: unknown }> = [];

  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalCompositeOperation = 'source-over';

  private record(name: string, args: unknown[]): void {
    const op: RecordedOp = { name, args };
    this.ops.push(op);
    const hasInvalidNumber = args.some(
      (arg) => typeof arg === 'number' && !Number.isFinite(arg)
    );
    if (hasInvalidNumber) this.invalidOps.push(op);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [x, y, w, h]);
    this.fillRects.push({ x, y, w, h, fillStyle: this.fillStyle });
  }

  beginPath(): void {
    this.record('beginPath', []);
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

  stroke(): void {
    this.record('stroke', []);
    this.strokeLineWidths.push(this.lineWidth);
  }

  fill(): void {
    this.record('fill', []);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.record('arc', [x, y, radius, startAngle, endAngle]);
  }

  save(): void {
    this.record('save', []);
  }

  restore(): void {
    this.record('restore', []);
  }

  scale(x: number, y: number): void {
    this.record('scale', [x, y]);
  }

  createLinearGradient(...args: number[]): FakeGradient {
    this.record('createLinearGradient', args);
    return new FakeGradient();
  }

  createRadialGradient(...args: number[]): FakeGradient {
    this.record('createRadialGradient', args);
    return new FakeGradient();
  }
}

export class FakeCanvas {
  width = 0;
  height = 0;
  readonly rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  readonly context = new FakeCanvasRenderingContext2D();

  constructor(width = 800, height = 200) {
    this.rect = { left: 0, top: 0, right: width, bottom: height, width, height };
  }

  getContext(kind: string): FakeCanvasRenderingContext2D | null {
    return kind === '2d' ? this.context : null;
  }

  getBoundingClientRect(): typeof this.rect {
    return this.rect;
  }
}

export function installBrowserGlobals(): void {
  (globalThis as Record<string, unknown>).window = {
    AudioContext: FakeAudioContext,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

export function uninstallBrowserGlobals(): void {
  delete (globalThis as Record<string, unknown>).window;
}

export function makeFile(byteLength = 16): File {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(byteLength)) } as unknown as File;
}

export function makeAudioBuffer(duration: number, sampleCount: number, fill?: (index: number) => number): FakeAudioBuffer {
  const data = new Float32Array(sampleCount);
  if (fill) {
    for (let i = 0; i < sampleCount; i++) data[i] = fill(i);
  }
  return new FakeAudioBuffer(duration, data);
}
