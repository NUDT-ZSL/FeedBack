export interface Instrument {
  id: string;
  name: string;
  icon: string;
  color: string;
  baseFrequency: number;
  type: OscillatorType;
}

export interface InstrumentParams {
  volume: number;
  pan: number;
  detune: number;
  arpEnabled: boolean;
  arpRate: 1 | 2 | 4;
}

export type GridState = boolean[][];

export interface Preset {
  name: string;
  grid: GridState;
}

type EventCallback = (...args: unknown[]) => void;

export class EventEmitter {
  private events: Map<string, EventCallback[]> = new Map();

  on(event: string, cb: EventCallback): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(cb);
  }

  off(event: string, cb: EventCallback): void {
    const list = this.events.get(event);
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.events.get(event);
    if (!list) return;
    for (const cb of list) cb(...args);
  }
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'kick',    name: '底鼓',     icon: '🥁', color: '#ef5350', baseFrequency: 60,   type: 'sine' },
  { id: 'snare',   name: '军鼓',     icon: '🪘', color: '#ff7043', baseFrequency: 200,  type: 'triangle' },
  { id: 'hihat',   name: '镲片',     icon: '🎵', color: '#ffee58', baseFrequency: 800,  type: 'square' },
  { id: 'bass',    name: '低音贝斯', icon: '🎸', color: '#66bb6a', baseFrequency: 55,   type: 'sawtooth' },
  { id: 'chord',   name: '和弦合成器', icon: '🎹', color: '#42a5f5', baseFrequency: 261, type: 'sine' },
  { id: 'lead',    name: '主音合成器', icon: '🎺', color: '#7e57c2', baseFrequency: 440, type: 'sawtooth' },
  { id: 'arp',     name: '琶音器',   icon: '🎼', color: '#ab47bc', baseFrequency: 523, type: 'triangle' },
  { id: 'perc',    name: '打击乐',   icon: '🔔', color: '#ec407a', baseFrequency: 1000, type: 'square' },
];

function createEmptyGrid(rows: number, cols: number): GridState {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
}

export const PRESETS: Preset[] = [
  {
    name: '摇滚',
    grid: (() => {
      const g = createEmptyGrid(8, 16);
      g[0][0] = g[0][8] = true;
      g[1][4] = g[1][12] = true;
      for (let i = 0; i < 16; i += 2) g[2][i] = true;
      g[3][0] = g[3][6] = g[3][8] = g[3][14] = true;
      return g;
    })(),
  },
  {
    name: '电子',
    grid: (() => {
      const g = createEmptyGrid(8, 16);
      for (let i = 0; i < 16; i += 4) g[0][i] = true;
      for (let i = 2; i < 16; i += 4) g[1][i] = true;
      for (let i = 0; i < 16; i++) g[2][i] = true;
      g[3][0] = g[3][4] = g[3][8] = g[3][12] = true;
      g[6][1] = g[6][5] = g[6][9] = g[6][13] = true;
      return g;
    })(),
  },
  {
    name: '嘻哈',
    grid: (() => {
      const g = createEmptyGrid(8, 16);
      g[0][0] = g[0][10] = true;
      g[1][4] = g[1][12] = true;
      g[2][2] = g[2][6] = g[2][10] = g[2][14] = true;
      g[3][0] = g[3][8] = true;
      g[7][3] = g[7][11] = true;
      return g;
    })(),
  },
  {
    name: '拉丁',
    grid: (() => {
      const g = createEmptyGrid(8, 16);
      g[0][0] = g[0][6] = g[0][10] = true;
      g[1][4] = g[1][12] = true;
      g[2][2] = g[2][5] = g[2][8] = g[2][11] = g[2][14] = true;
      g[7][1] = g[7][7] = g[7][9] = g[7][15] = true;
      return g;
    })(),
  },
  {
    name: '爵士',
    grid: (() => {
      const g = createEmptyGrid(8, 16);
      g[0][0] = g[0][7] = g[0][11] = true;
      g[1][4] = g[1][13] = true;
      for (let i = 0; i < 16; i += 3) g[2][i] = true;
      g[4][0] = g[4][5] = g[4][10] = true;
      return g;
    })(),
  },
  {
    name: '自定义',
    grid: createEmptyGrid(8, 16),
  },
];

interface TrackAudio {
  gain: GainNode;
  pan: StereoPannerNode;
}

export class SequencerModule extends EventEmitter {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private analyser: AnalyserNode;
  private streamDest: MediaStreamAudioDestinationNode;
  private tracks: Map<string, TrackAudio> = new Map();
  private grid: GridState;
  private instrumentParams: Map<string, InstrumentParams> = new Map();
  private bpm: number = 140;
  private currentStep: number = 0;
  private isPlaying: boolean = false;
  private scheduledTime: number = 0;
  private schedulerTimer: number | null = null;
  private baseCols: number = 16;
  private currentArpRate: 1 | 2 | 4 = 1;

  constructor(ctx: AudioContext) {
    super();
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;

    this.streamDest = ctx.createMediaStreamDestination();

    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.streamDest);
    this.analyser.connect(ctx.destination);

    this.grid = createEmptyGrid(INSTRUMENTS.length, this.baseCols);

    for (const inst of INSTRUMENTS) {
      const gain = ctx.createGain();
      gain.gain.value = 0.6;
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0;
      gain.connect(pan);
      pan.connect(this.masterGain);
      this.tracks.set(inst.id, { gain, pan });

      this.instrumentParams.set(inst.id, {
        volume: 60,
        pan: 0,
        detune: 0,
        arpEnabled: false,
        arpRate: 1,
      });
    }
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  getMediaStream(): MediaStream {
    return this.streamDest.stream;
  }

  getGrid(): GridState {
    return this.grid.map(row => [...row]);
  }

  getCols(): number {
    return this.baseCols * this.currentArpRate;
  }

  getArpRate(): 1 | 2 | 4 {
    return this.currentArpRate;
  }

  setArpRate(rate: 1 | 2 | 4): void {
    const oldCols = this.getCols();
    this.currentArpRate = rate;
    const newCols = this.baseCols * rate;

    const newGrid: GridState = [];
    for (let r = 0; r < INSTRUMENTS.length; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < newCols; c++) {
        const oldC = Math.floor(c * oldCols / newCols);
        row.push(this.grid[r]?.[oldC] ?? false);
      }
      newGrid.push(row);
    }
    this.grid = newGrid;
    this.currentStep = 0;
    this.emit('arpRateChange', newCols);
    this.emit('gridChange', this.getGrid());
  }

  toggleCell(row: number, col: number): void {
    if (!this.grid[row]) return;
    this.grid[row][col] = !this.grid[row][col];
    this.emit('gridChange', this.getGrid());
  }

  setCell(row: number, col: number, val: boolean): void {
    if (!this.grid[row]) return;
    this.grid[row][col] = val;
  }

  clearGrid(): void {
    this.grid = createEmptyGrid(INSTRUMENTS.length, this.getCols());
    this.emit('gridChange', this.getGrid());
  }

  loadPreset(preset: Preset, keepParams: boolean = true): void {
    const cols = this.getCols();
    const newGrid: GridState = [];
    for (let r = 0; r < INSTRUMENTS.length; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < cols; c++) {
        const srcC = Math.floor(c * preset.grid[r].length / cols);
        row.push(preset.grid[r]?.[srcC] ?? false);
      }
      newGrid.push(row);
    }
    this.grid = newGrid;
    this.currentStep = 0;
    if (!keepParams) {
      // 保留参数不变（按需求）
    }
    this.emit('gridChange', this.getGrid());
  }

  getInstrumentParams(id: string): InstrumentParams | undefined {
    return this.instrumentParams.get(id);
  }

  setVolume(id: string, volume: number): void {
    const p = this.instrumentParams.get(id);
    if (!p) return;
    p.volume = Math.max(0, Math.min(100, volume));
    const t = this.tracks.get(id);
    if (t) {
      t.gain.gain.setTargetAtTime(p.volume / 100, this.ctx.currentTime, 0.02);
    }
    this.emit('paramChange', id, { ...p });
  }

  setPan(id: string, pan: number): void {
    const p = this.instrumentParams.get(id);
    if (!p) return;
    p.pan = Math.max(-100, Math.min(100, pan));
    const t = this.tracks.get(id);
    if (t) {
      t.pan.pan.setTargetAtTime(p.pan / 100, this.ctx.currentTime, 0.02);
    }
    this.emit('paramChange', id, { ...p });
  }

  setDetune(id: string, detune: number): void {
    const p = this.instrumentParams.get(id);
    if (!p) return;
    p.detune = Math.max(-12, Math.min(12, detune));
    this.emit('paramChange', id, { ...p });
  }

  setArpEnabled(id: string, enabled: boolean): void {
    const p = this.instrumentParams.get(id);
    if (!p) return;
    p.arpEnabled = enabled;
    this.emit('paramChange', id, { ...p });
  }

  setInstrumentArpRate(id: string, rate: 1 | 2 | 4): void {
    const p = this.instrumentParams.get(id);
    if (!p) return;
    p.arpRate = rate;
    this.emit('paramChange', id, { ...p });
  }

  getBPM(): number {
    return this.bpm;
  }

  setBPM(bpm: number): void {
    this.bpm = Math.max(120, Math.min(180, bpm));
    this.emit('bpmChange', this.bpm);
  }

  isPlayingState(): boolean {
    return this.isPlaying;
  }

  play(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.scheduledTime = this.ctx.currentTime + 0.05;
    this.currentStep = 0;
    this.scheduler();
    this.emit('play');
  }

  pause(): void {
    this.isPlaying = false;
    if (this.schedulerTimer !== null) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.emit('pause');
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  private scheduler = (): void => {
    if (!this.isPlaying) return;
    const stepDuration = 60 / this.bpm / 4; // 16分音符时长
    while (this.scheduledTime < this.ctx.currentTime + 0.1) {
      this.scheduleStep(this.currentStep, this.scheduledTime);
      this.scheduledTime += stepDuration;
      this.currentStep = (this.currentStep + 1) % this.getCols();
    }
    this.schedulerTimer = window.setTimeout(this.scheduler, 25);
  };

  private scheduleStep(step: number, time: number): void {
    this.emit('step', step);
    for (let r = 0; r < INSTRUMENTS.length; r++) {
      if (this.grid[r]?.[step]) {
        this.triggerInstrument(INSTRUMENTS[r], time, step);
      }
    }
  }

  private triggerInstrument(inst: Instrument, time: number, step: number): void {
    const params = this.instrumentParams.get(inst.id);
    const track = this.tracks.get(inst.id);
    if (!params || !track) return;

    const detuneSemitones = params.detune;
    let freq = inst.baseFrequency * Math.pow(2, detuneSemitones / 12);

    if (params.arpEnabled && inst.id === 'arp') {
      const arpNotes = [0, 4, 7, 12, 7, 4, 12, 7];
      const arpIdx = Math.floor(step / params.arpRate) % arpNotes.length;
      freq = freq * Math.pow(2, arpNotes[arpIdx] / 12);
    } else if (params.arpEnabled) {
      const arpNotes = [0, 3, 5, 7, 10, 12];
      const arpIdx = Math.floor(step / params.arpRate) % arpNotes.length;
      freq = freq * Math.pow(2, arpNotes[arpIdx] / 12);
    }

    const duration = this.getInstrumentDuration(inst.id);

    if (inst.id === 'kick') {
      this.synthesizeKick(freq, time, duration, track.gain);
    } else if (inst.id === 'snare') {
      this.synthesizeSnare(freq, time, duration, track.gain);
    } else if (inst.id === 'hihat') {
      this.synthesizeHiHat(time, duration, track.gain);
    } else if (inst.id === 'perc') {
      this.synthesizePerc(freq, time, duration, track.gain);
    } else {
      this.synthesizeTone(inst.type, freq, time, duration, track.gain);
    }
  }

  private getInstrumentDuration(id: string): number {
    switch (id) {
      case 'kick': return 0.15;
      case 'snare': return 0.12;
      case 'hihat': return 0.05;
      case 'bass': return 0.25;
      case 'chord': return 0.5;
      case 'lead': return 0.35;
      case 'arp': return 0.2;
      case 'perc': return 0.08;
      default: return 0.2;
    }
  }

  private synthesizeTone(type: OscillatorType, freq: number, time: number, duration: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.5, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private synthesizeKick(freq: number, time: number, duration: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.05);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.9, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private synthesizeSnare(freq: number, time: number, duration: number, dest: AudioNode): void {
    const noise = this.createNoiseBuffer(duration);
    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noise;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dest);
    noiseSrc.start(time);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.6, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.6);
    osc.connect(oscGain);
    oscGain.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private synthesizeHiHat(time: number, duration: number, dest: AudioNode): void {
    const noise = this.createNoiseBuffer(duration);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time);
  }

  private synthesizePerc(freq: number, time: number, duration: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * Math.max(duration, 0.1));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  destroy(): void {
    this.pause();
    this.tracks.clear();
    this.instrumentParams.clear();
  }
}
