import { SpectralSmoother, BAND_SMOOTHER_CONFIG, WAVEFORM_SMOOTHER_CONFIG } from './spectralSmoother';

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private gainNode: GainNode | null = null;
  private frequencyData: Float32Array<ArrayBuffer>;
  private startTime: number = 0;
  private pauseTime: number = 0;
  private isPlayingFlag: boolean = false;
  private sampleRate: number = 44100;
  private fftSize: number = 2048;
  private bufferSize: number = 4096;
  private bandSmoother: SpectralSmoother = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  private waveSmoother: SpectralSmoother = new SpectralSmoother(WAVEFORM_SMOOTHER_CONFIG);
  private lastBandTimestamp: number | null = null;
  private lastWaveTimestamp: number | null = null;

  constructor() {
    this.frequencyData = new Float32Array(this.fftSize / 2) as Float32Array<ArrayBuffer>;
  }

  private initAudioContext(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        sampleRate: this.sampleRate,
        latencyHint: 'interactive'
      });
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.maxDecibels = -10;
      this.analyser.minDecibels = -90;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.7;
    }
  }

  async loadAudio(file: File): Promise<void> {
    this.initAudioContext();
    this.stop();

    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
    
    if (this.audioBuffer.sampleRate !== this.sampleRate) {
      console.warn(`Audio sample rate (${this.audioBuffer.sampleRate}Hz) differs from target (${this.sampleRate}Hz)`);
    }
  }

  play(): void {
    if (!this.audioContext || !this.audioBuffer || this.isPlayingFlag) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.connect(this.analyser!);
    this.analyser!.connect(this.gainNode!);
    this.gainNode!.connect(this.audioContext.destination);

    this.source.onended = () => {
      if (this.isPlayingFlag) {
        this.isPlayingFlag = false;
        this.pauseTime = 0;
      }
    };

    this.startTime = this.audioContext.currentTime - this.pauseTime;
    this.source.start(0, this.pauseTime);
    this.isPlayingFlag = true;
  }

  pause(): void {
    if (!this.isPlayingFlag || !this.source) return;
    
    this.pauseTime = this.getCurrentTime();
    this.source.stop();
    this.source.disconnect();
    this.source = null;
    this.isPlayingFlag = false;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (e) {
        // 忽略已停止的源错误
      }
      this.source = null;
    }
    this.isPlayingFlag = false;
    this.pauseTime = 0;
    this.startTime = 0;
    this.bandSmoother.reset();
    this.waveSmoother.reset();
    this.lastBandTimestamp = null;
    this.lastWaveTimestamp = null;
  }

  private consumeDelta(kind: 'band' | 'wave'): number {
    const now = performance.now();
    if (kind === 'band') {
      const dt = this.lastBandTimestamp === null ? 1 / 60 : (now - this.lastBandTimestamp) / 1000;
      this.lastBandTimestamp = now;
      return dt;
    }
    const dt = this.lastWaveTimestamp === null ? 1 / 60 : (now - this.lastWaveTimestamp) / 1000;
    this.lastWaveTimestamp = now;
    return dt;
  }

  seek(time: number): void {
    const wasPlaying = this.isPlayingFlag;
    if (wasPlaying) {
      this.pause();
    }
    this.pauseTime = Math.max(0, Math.min(time, this.getDuration()));
    if (wasPlaying) {
      this.play();
    }
  }

  getFrequencyBands(bands: number = 16): number[] {
    if (!this.analyser) {
      return new Array(bands).fill(0);
    }

    this.analyser.getFloatFrequencyData(this.frequencyData);
    
    const result: number[] = [];
    const dataLength = this.frequencyData.length;
    const bandWidth = Math.floor(dataLength / bands);

    for (let i = 0; i < bands; i++) {
      let sum = 0;
      const start = i * bandWidth;
      const end = Math.min(start + bandWidth, dataLength);
      
      for (let j = start; j < end; j++) {
        const normalized = (this.frequencyData[j] - this.analyser.minDecibels) / 
                          (this.analyser.maxDecibels - this.analyser.minDecibels);
        sum += Math.max(0, Math.min(1, normalized));
      }
      
      result.push(sum / (end - start));
    }

    // 时间维度平滑：抑制相邻帧跳变；暂停/结束时按独立曲线自然回落
    return this.bandSmoother.update(result, this.consumeDelta('band'), this.isPlayingFlag);
  }

  getWaveformData(samples: number = 128): number[] {
    if (!this.analyser) {
      return new Array(samples).fill(0);
    }

    const waveformData = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(waveformData);
    
    const result: number[] = [];
    const step = Math.floor(waveformData.length / samples);

    for (let i = 0; i < samples; i++) {
      result.push(waveformData[i * step] * 0.5 + 0.5);
    }

    // 暂停时时间域数据会冻结，通过平滑器回落到静止值 0.5
    return this.waveSmoother.update(result, this.consumeDelta('wave'), this.isPlayingFlag);
  }

  getCurrentTime(): number {
    if (!this.audioContext) return 0;
    if (this.isPlayingFlag) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pauseTime;
  }

  getDuration(): number {
    return this.audioBuffer?.duration || 0;
  }

  isPlaying(): boolean {
    return this.isPlayingFlag;
  }

  hasAudio(): boolean {
    return this.audioBuffer !== null;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  getBufferSize(): number {
    return this.bufferSize;
  }

  dispose(): void {
    this.stop();
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioBuffer = null;
  }
}
