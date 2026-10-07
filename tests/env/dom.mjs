// Installs minimal browser-global stand-ins (DOM canvas, Web Audio, fake timers).
import { clock } from './clock.mjs';

function createFakeCanvas2DContext() {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    arc() {},
    fill() {},
    stroke() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
}

function createFakeCanvas() {
  return {
    width: 300,
    height: 150,
    context: null,
    getContext() {
      if (!this.context) this.context = createFakeCanvas2DContext();
      return this.context;
    },
  };
}

class FakeAudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeAudioNode {
  connect() {}
}

class FakeOscillator extends FakeAudioNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new FakeAudioParam();
  }
  start() {}
  stop() {}
}

class FakeGainNode extends FakeAudioNode {
  constructor() {
    super();
    this.gain = new FakeAudioParam();
  }
}

class FakeAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index) {
    return this.channels[index];
  }
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.destination = new FakeAudioNode();
  }
  createOscillator() { return new FakeOscillator(); }
  createGain() { return new FakeGainNode(); }
  createBuffer(channels, length, rate) {
    return new FakeAudioBuffer(channels, length, rate);
  }
}

export function installDomStubs() {
  clock.reset();

  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => clock.now() },
  });

  globalThis.setTimeout = (cb, delay, ...rest) => clock.setTimeout(cb, delay, ...rest);
  globalThis.clearTimeout = (id) => clock.clearTimeout(id);

  globalThis.window = {
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return createFakeCanvas();
      return {};
    },
  };

  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'blob:offline-stub';
  globalThis.URL.revokeObjectURL = () => {};
}

installDomStubs();
