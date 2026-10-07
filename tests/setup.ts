/**
 * 离线测试环境替身：
 * 将 Loom / ScrollViewer 依赖的浏览器能力（Canvas 2D、WebAudio、Howler、
 * URL.createObjectURL）替换为本地无操作实现，使状态链路验证无需浏览器与网络。
 */
import { vi } from 'vitest';

vi.mock('howler', () => {
  class HowlMock {
    static instances: HowlMock[] = [];
    public playCount = 0;
    constructor(public options: Record<string, unknown>) {
      HowlMock.instances.push(this);
    }
    play(): number {
      this.playCount += 1;
      return 0;
    }
    stop(): this {
      return this;
    }
    unload(): void {}
  }
  return { Howl: HowlMock, Howler: { volume: () => 1 } };
});

class CanvasGradientMock {
  addColorStop(): void {}
}

class CanvasRenderingContext2DMock {
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  globalAlpha = 1;
  lineWidth = 1;
  font = '';
  textAlign = '';
  constructor(public canvas: HTMLCanvasElementMock) {}
  fillRect(): void {}
  strokeRect(): void {}
  clearRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
  stroke(): void {}
  fill(): void {}
  fillText(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  drawImage(): void {}
  createRadialGradient(): CanvasGradientMock {
    return new CanvasGradientMock();
  }
  createLinearGradient(): CanvasGradientMock {
    return new CanvasGradientMock();
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {}
}

class HTMLCanvasElementMock {
  width = 300;
  height = 150;
  getContext(): CanvasRenderingContext2DMock {
    return new CanvasRenderingContext2DMock(this);
  }
  toDataURL(): string {
    return 'data:,';
  }
}

const globalScope = globalThis as Record<string, unknown>;

if (typeof globalScope.document === 'undefined') {
  globalScope.document = {
    createElement(tag: string) {
      if (tag === 'canvas') return new HTMLCanvasElementMock();
      return { style: {} };
    },
    createElementNS() {
      return { style: {} };
    },
  };
}

if (typeof globalScope.window === 'undefined') {
  globalScope.window = globalThis;
}

class AudioBufferMock {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
    private channels: Float32Array[]
  ) {}
  getChannelData(index: number): Float32Array {
    return this.channels[index];
  }
}

class AudioContextMock {
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: () => {} },
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return new AudioBufferMock(channels, length, sampleRate, data);
  }
}

globalScope.AudioContext = AudioContextMock;
(globalScope.window as Record<string, unknown>).AudioContext = AudioContextMock;

URL.createObjectURL = () => 'blob:offline-mock';
URL.revokeObjectURL = () => {};
