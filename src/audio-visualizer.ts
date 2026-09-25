export type GestureType = 'none' | '1-finger' | '2-finger' | '3-finger' | '4-finger' | '5-finger' | 'fist';

export interface AudioData {
  lowFrequency: number;
  midFrequency: number;
  highFrequency: number;
  isBeat: boolean;
  overallVolume: number;
  frequencyData: Uint8Array;
}

export interface ColorTheme {
  name: string;
  lowColor: [number, number, number];
  midColor: [number, number, number];
  highColor: [number, number, number];
  bgTop: string;
  bgBottom: string;
}

export interface PlaylistItem {
  title: string;
  artist: string;
  duration: number;
  config: SynthConfig;
}

export interface SynthConfig {
  bpm: number;
  rootNote: number;
  scale: 'minor' | 'major' | 'pentatonic';
  bassTimbre: 'sine' | 'sawtooth' | 'square' | 'triangle';
  leadTimbre: 'sine' | 'sawtooth' | 'square' | 'triangle';
  padTimbre: 'sine' | 'sawtooth' | 'square' | 'triangle';
  drumPattern: number[];
  bassPattern: number[];
  chordPattern: number[];
  melodyPattern: number[];
}

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  pentatonic: [0, 3, 5, 7, 10]
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const THEMES: ColorTheme[] = [
  {
    name: '霓虹赛博朋克',
    lowColor: [255, 0, 102],
    midColor: [0, 255, 204],
    highColor: [0, 102, 255],
    bgTop: '#0a0a2e',
    bgBottom: '#1a0a3e'
  },
  {
    name: '日落暖色调',
    lowColor: [255, 69, 0],
    midColor: [255, 215, 0],
    highColor: [255, 105, 180],
    bgTop: '#1a0a0a',
    bgBottom: '#3e1a1a'
  },
  {
    name: '极光冷色调',
    lowColor: [0, 191, 255],
    midColor: [127, 255, 212],
    highColor: [221, 160, 221],
    bgTop: '#0a1a2e',
    bgBottom: '#1a2e3e'
  }
];

export const PLAYLIST: PlaylistItem[] = [
  {
    title: '赛博夜城',
    artist: 'Synthwave AI',
    duration: 60,
    config: {
      bpm: 110,
      rootNote: 48,
      scale: 'minor',
      bassTimbre: 'sawtooth',
      leadTimbre: 'square',
      padTimbre: 'triangle',
      drumPattern: [1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0],
      bassPattern: [0,-1,0,-1, 3,-1,0,-1, 5,-1,3,-1, 0,-1,-1,-1],
      chordPattern: [0,-1,-1,-1, 3,-1,-1,-1, 5,-1,-1,-1, 0,-1,-1,-1],
      melodyPattern: [-1,7,-1,10, -1,12,-1,10, 7,-1,5,-1, 3,-1,0,-1]
    }
  },
  {
    title: '深海漫游',
    artist: 'Ambient Machine',
    duration: 60,
    config: {
      bpm: 80,
      rootNote: 45,
      scale: 'minor',
      bassTimbre: 'sine',
      leadTimbre: 'triangle',
      padTimbre: 'sine',
      drumPattern: [1,0,0,0,0,0,1,0, 0,0,1,0,0,0,0,0],
      bassPattern: [0,-1,-1,-1, 5,-1,-1,-1, 3,-1,-1,-1, -1,-1,0,-1],
      chordPattern: [0,-1,-1,-1, -1,-1,3,-1, -1,-1,5,-1, -1,-1,-1,-1],
      melodyPattern: [12,-1,10,-1, -1,7,-1,-1, 5,-1,-1,3, -1,0,-1,-1]
    }
  },
  {
    title: '日落大道',
    artist: 'Golden Hour',
    duration: 60,
    config: {
      bpm: 100,
      rootNote: 52,
      scale: 'major',
      bassTimbre: 'triangle',
      leadTimbre: 'sawtooth',
      padTimbre: 'sine',
      drumPattern: [1,0,0,1,1,0,0,1, 1,0,0,1,1,0,1,0],
      bassPattern: [0,-1,5,-1, 3,-1,0,-1, 7,-1,5,-1, 0,-1,-1,-1],
      chordPattern: [0,-1,2,-1, 4,-1,0,-1, 5,-1,2,-1, 0,-1,-1,-1],
      melodyPattern: [12,-1,11,-1, 9,-1,7,-1, 5,-1,4,-1, 2,-1,0,-1]
    }
  },
  {
    title: '量子风暴',
    artist: 'Neural Beats',
    duration: 60,
    config: {
      bpm: 140,
      rootNote: 43,
      scale: 'pentatonic',
      bassTimbre: 'square',
      leadTimbre: 'sawtooth',
      padTimbre: 'sawtooth',
      drumPattern: [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
      bassPattern: [0,0,3,3, 5,5,3,3, 7,7,5,5, 3,3,0,0],
      chordPattern: [0,-1,5,-1, 3,-1,0,-1, 5,-1,7,-1, 0,-1,-1,-1],
      melodyPattern: [12,10,12,15, 17,15,12,10, 12,15,17,19, 17,15,12,10]
    }
  },
  {
    title: '极光之梦',
    artist: 'Northern Lights',
    duration: 60,
    config: {
      bpm: 90,
      rootNote: 50,
      scale: 'pentatonic',
      bassTimbre: 'sine',
      leadTimbre: 'sine',
      padTimbre: 'triangle',
      drumPattern: [0,0,1,0,0,0,1,0, 0,0,1,0,1,0,0,0],
      bassPattern: [0,-1,-1,5, -1,-1,3,-1, -1,7,-1,-1, 5,-1,0,-1],
      chordPattern: [0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 5,-1,-1,-1],
      melodyPattern: [-1,10,-1,12, -1,15,-1,12, 10,-1,7,-1, -1,5,-1,3]
    }
  }
];

export class AudioVisualizer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private bufferLength = 0;
  private frequencyArray: Uint8Array = new Uint8Array(0);
  private isPlaying = false;
  private currentSong: PlaylistItem | null = null;
  private startTime = 0;
  private pauseTime = 0;
  private _volume = 0.7;
  private onEndedCallback: (() => void) | null = null;
  private activeNodes: { stop: () => void }[] = [];
  private beatHistory: number[] = [];
  private lastBeatTime = 0;
  private schedulerTimer: number | null = null;
  private nextNoteTime = 0;
  private currentStep = 0;
  private lookahead = 25;
  private scheduleAheadTime = 0.1;

  get volume(): number {
    return this._volume;
  }

  async init(): Promise<void> {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.75;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.frequencyArray = new Uint8Array(this.bufferLength);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  private resumeCtx(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  loadSong(song: PlaylistItem): void {
    this.stopAll();
    this.currentSong = song;
    this.pauseTime = 0;
    this.currentStep = 0;
  }

  play(): void {
    if (!this.ctx || !this.currentSong || this.isPlaying) return;
    this.resumeCtx();
    this.isPlaying = true;
    this.startTime = this.ctx.currentTime - this.pauseTime;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.startScheduler();
  }

  pause(): void {
    if (!this.ctx || !this.isPlaying) return;
    this.isPlaying = false;
    this.pauseTime = this.ctx.currentTime - this.startTime;
    this.stopScheduler();
    this.stopAll();
  }

  private startScheduler(): void {
    this.stopScheduler();
    const tick = () => {
      if (!this.isPlaying || !this.ctx || !this.currentSong) return;
      while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
        this.scheduleStep(this.nextNoteTime);
        const secondsPerBeat = 60.0 / this.currentSong.config.bpm;
        this.nextNoteTime += secondsPerBeat / 4;
        this.currentStep = (this.currentStep + 1) % 16;
      }
      this.schedulerTimer = window.setTimeout(tick, this.lookahead);
    };
    tick();
  }

  private stopScheduler(): void {
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private scheduleStep(time: number): void {
    if (!this.ctx || !this.masterGain || !this.currentSong) return;
    const cfg = this.currentSong.config;
    const step = this.currentStep;
    if (cfg.drumPattern[step]) {
      this.scheduleKick(time);
      if (step % 4 === 2) this.scheduleSnare(time);
      this.scheduleHat(time, step % 2 === 1);
    }
    const bassIdx = cfg.bassPattern[step];
    if (bassIdx >= 0) {
      const semis = SCALES[cfg.scale][bassIdx % SCALES[cfg.scale].length];
      this.scheduleBass(time, midiToFreq(cfg.rootNote + semis), cfg.bassTimbre);
    }
    const chordIdx = cfg.chordPattern[step];
    if (chordIdx >= 0) {
      const semis = SCALES[cfg.scale][chordIdx % SCALES[cfg.scale].length];
      this.scheduleChord(time, cfg.rootNote + semis, cfg.scale, cfg.padTimbre);
    }
    const melIdx = cfg.melodyPattern[step];
    if (melIdx >= 0) {
      const semis = SCALES[cfg.scale][melIdx % SCALES[cfg.scale].length];
      this.scheduleLead(time, midiToFreq(cfg.rootNote + 12 + semis), cfg.leadTimbre);
    }
  }

  private scheduleKick(time: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.4);
    this.trackNode({ stop: () => { try { osc.stop(); } catch {} } });
  }

  private scheduleSnare(time: number): void {
    if (!this.ctx || !this.masterGain) return;
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    noiseGain.gain.setValueAtTime(0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(time);
    noise.stop(time + 0.2);
  }

  private scheduleHat(time: number, open: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const dur = open ? 0.08 : 0.04;
    const bufferSize = this.ctx.sampleRate * dur;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    noise.connect(hp);
    hp.connect(gain);
    gain.connect(this.masterGain);
    noise.start(time);
    noise.stop(time + dur);
  }

  private scheduleBass(time: number, freq: number, type: OscillatorType): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.35, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.25);
    this.trackNode({ stop: () => { try { osc.stop(); } catch {} } });
  }

  private scheduleChord(time: number, root: number, scaleName: string, type: OscillatorType): void {
    if (!this.ctx || !this.masterGain) return;
    const scale = SCALES[scaleName];
    const semis = [0, 2, 4];
    semis.forEach(s => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = type;
      const idx = s % scale.length;
      osc.frequency.value = midiToFreq(root + scale[idx]);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.06, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(time);
      osc.stop(time + 0.55);
    });
  }

  private scheduleLead(time: number, freq: number, type: OscillatorType): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.18, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.3);
    this.trackNode({ stop: () => { try { osc.stop(); } catch {} } });
  }

  private trackNode(node: { stop: () => void }): void {
    this.activeNodes.push(node);
    if (this.activeNodes.length > 200) {
      this.activeNodes.splice(0, 100);
    }
  }

  private stopAll(): void {
    this.activeNodes.forEach(n => { try { n.stop(); } catch {} });
    this.activeNodes = [];
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
    }
  }

  getCurrentTime(): number {
    if (!this.ctx || !this.isPlaying) return this.pauseTime;
    return this.ctx.currentTime - this.startTime;
  }

  getDuration(): number {
    return this.currentSong?.duration ?? 0;
  }

  seek(time: number): void {
    if (!this.currentSong) return;
    const wasPlaying = this.isPlaying;
    const was = this.isPlaying;
    this.pause();
    this.pauseTime = Math.max(0, Math.min(time, this.currentSong.duration));
    this.currentStep = Math.floor((this.pauseTime * this.currentSong.config.bpm / 60) * 4) % 16;
    if (was) this.play();
  }

  onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  getAudioData(): AudioData {
    if (!this.analyser) {
      return {
        lowFrequency: 0, midFrequency: 0, highFrequency: 0,
        isBeat: false, overallVolume: 0,
        frequencyData: new Uint8Array(128)
      };
    }
    this.analyser.getByteFrequencyData(this.frequencyArray);
    const len = this.bufferLength;
    const lowCut = Math.floor(len * 0.15);
    const midCut = Math.floor(len * 0.5);
    let low = 0, mid = 0, high = 0, total = 0;
    for (let i = 0; i < lowCut; i++) { low += this.frequencyArray[i]; total += this.frequencyArray[i]; }
    for (let i = lowCut; i < midCut; i++) { mid += this.frequencyArray[i]; total += this.frequencyArray[i]; }
    for (let i = midCut; i < len; i++) { high += this.frequencyArray[i]; total += this.frequencyArray[i]; }
    low = low / (lowCut * 255);
    mid = mid / ((midCut - lowCut) * 255);
    high = high / ((len - midCut) * 255);
    const overall = total / (len * 255);
    this.beatHistory.push(low);
    if (this.beatHistory.length > 43) this.beatHistory.shift();
    const avg = this.beatHistory.reduce((a, b) => a + b, 0) / this.beatHistory.length;
    const variance = this.beatHistory.reduce((a, b) => a + (b - avg) ** 2, 0) / this.beatHistory.length;
    const threshold = avg + Math.max(variance * 8, 0.08);
    let isBeat = false;
    if (this.ctx && low > threshold && low > 0.2) {
      const now = this.ctx.currentTime;
      if (now - this.lastBeatTime > 0.2) {
        isBeat = true;
        this.lastBeatTime = now;
      }
    }
    if (this.currentSong && this.isPlaying && this.ctx) {
      const elapsed = this.ctx.currentTime - this.startTime;
      if (elapsed >= this.currentSong.duration) {
        this.pause();
        if (this.onEndedCallback) this.onEndedCallback();
      }
    }
    return {
      lowFrequency: low,
      midFrequency: mid,
      highFrequency: high,
      isBeat,
      overallVolume: overall,
      frequencyData: this.frequencyArray
    };
  }

  getCurrentSong(): PlaylistItem | null {
    return this.currentSong;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
