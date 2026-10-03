export interface AudioMetadata {
  duration: number;
  sampleRate: number;
  fileSize: number;
  fileName: string;
}

export interface AudioAnalysisData {
  frequencyData: Uint8Array;
  timeDomainData: Uint8Array;
  currentTime: number;
}

export interface Selection {
  start: number;
  end: number;
}

type AnalysisCallback = (data: AudioAnalysisData) => void;
type StateChangeCallback = (isPlaying: boolean) => void;
type SelectionChangeCallback = (selection: Selection | null) => void;
type EndedCallback = () => void;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/**
 * 播放状态的唯一可信来源。
 *
 * 不变式（任意操作序列下均成立）：
 * - 暂停时 pauseTime 即当前时间；有选区时 pauseTime 一定落在选区内。
 * - 有选区时播放范围严格为 [selection.start, selection.end]，当前时间不越界。
 * - seek 到选区外会清除选区，保证选区与实际播放范围一致。
 * - stop / 自然结束（非循环）/ 重新加载后：pauseTime = 0、选区清空。
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private metadata: AudioMetadata | null = null;

  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private timeDomainData: Uint8Array<ArrayBuffer> | null = null;

  private isPlaying = false;
  private isLooping = false;
  private startTime = 0;
  private pauseTime = 0;
  private selection: Selection | null = null;
  private animationFrameId: number | null = null;

  private analysisCallback: AnalysisCallback | null = null;
  private stateChangeCallback: StateChangeCallback | null = null;
  private selectionChangeCallback: SelectionChangeCallback | null = null;
  private endedCallback: EndedCallback | null = null;

  private readonly FFT_SIZE = 256;
  private readonly SMOOTHING_TIME_CONSTANT = 0.8;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext(): void {
    if (typeof window !== 'undefined' && !this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.FFT_SIZE;
      this.analyser.smoothingTimeConstant = this.SMOOTHING_TIME_CONSTANT;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1;

      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeDomainData = new Uint8Array(this.analyser.frequencyBinCount);
    }
  }

  public async loadAudioFile(file: File): Promise<AudioBuffer> {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    if (!this.audioContext) {
      throw new Error('AudioContext not supported');
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.stop();

    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    this.metadata = {
      duration: this.audioBuffer.duration,
      sampleRate: this.audioBuffer.sampleRate,
      fileSize: file.size,
      fileName: file.name
    };

    return this.audioBuffer;
  }

  public getMetadata(): AudioMetadata | null {
    return this.metadata;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  /**
   * 从 pauseTime 继续播放；有选区时只在选区范围内播放。
   * pauseTime 不在选区内时从选区起点开始。
   */
  public play(): void {
    if (!this.audioContext || !this.audioBuffer || this.isPlaying) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const bufferDuration = this.audioBuffer.duration;
    let offset: number;
    let playDuration: number | undefined;

    if (this.selection) {
      const selStart = clamp(this.selection.start, 0, bufferDuration);
      const selEnd = clamp(this.selection.end, 0, bufferDuration);
      offset = this.pauseTime >= selStart && this.pauseTime < selEnd
        ? this.pauseTime
        : selStart;
      playDuration = Math.max(selEnd - offset, 0);
    } else {
      offset = clamp(this.pauseTime, 0, bufferDuration);
      playDuration = undefined;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.analyser!);
    this.sourceNode = source;

    source.onended = () => {
      if (this.sourceNode !== source) return;
      this.sourceNode = null;
      this.isPlaying = false;
      this.stopAnalysisLoop();

      if (this.isLooping) {
        this.pauseTime = this.selection ? this.selection.start : 0;
        this.play();
      } else {
        this.pauseTime = 0;
        this.selection = null;
        this.selectionChangeCallback?.(null);
        this.stateChangeCallback?.(false);
        this.resetAnalysisData();
        this.endedCallback?.();
      }
    };

    if (playDuration !== undefined) {
      source.start(0, offset, playDuration);
    } else {
      source.start(0, offset);
    }
    this.startTime = this.audioContext.currentTime - offset;

    this.isPlaying = true;
    this.stateChangeCallback?.(true);
    this.startAnalysisLoop();
  }

  public pause(): void {
    if (!this.isPlaying || !this.audioContext) return;

    this.pauseTime = this.computeCurrentTime();
    this.stopSource();

    this.isPlaying = false;
    this.stopAnalysisLoop();
    this.stateChangeCallback?.(false);
  }

  public stop(): void {
    this.stopSource();

    this.isPlaying = false;
    this.pauseTime = 0;
    this.setSelection(null);
    this.stopAnalysisLoop();
    this.stateChangeCallback?.(false);
    this.resetAnalysisData();
  }

  /**
   * 跳转到指定时间。目标在选区外时清除选区，
   * 保证选区与实际播放范围一致；播放中跳转不中断播放状态。
   */
  public seek(time: number): void {
    if (!this.audioBuffer) return;

    const clampedTime = clamp(time, 0, this.audioBuffer.duration);

    if (this.selection && (clampedTime < this.selection.start || clampedTime > this.selection.end)) {
      this.setSelection(null);
    }

    this.pauseTime = clampedTime;

    if (this.isPlaying) {
      this.stopSource();
      this.isPlaying = false;
      this.play();
    }
  }

  /**
   * 设置/清除选区（引擎内统一归一化与夹取）。
   * 暂停状态下建立选区时，pauseTime 会被夹进选区，
   * 之后 play() 一定从选区内开始。
   */
  public setSelection(selection: Selection | null): void {
    let next: Selection | null = null;

    if (selection && this.audioBuffer) {
      const duration = this.audioBuffer.duration;
      const start = clamp(Math.min(selection.start, selection.end), 0, duration);
      const end = clamp(Math.max(selection.start, selection.end), 0, duration);
      if (end > start) {
        next = { start, end };
      }
    }

    this.selection = next;

    if (next && (this.pauseTime < next.start || this.pauseTime > next.end)) {
      this.pauseTime = next.start;
    }

    this.selectionChangeCallback?.(this.selection);
  }

  public getSelection(): Selection | null {
    return this.selection;
  }

  public toggleLoop(): boolean {
    this.isLooping = !this.isLooping;
    return this.isLooping;
  }

  public isLoopingEnabled(): boolean {
    return this.isLooping;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentTime(): number {
    return this.isPlaying ? this.computeCurrentTime() : this.pauseTime;
  }

  private computeCurrentTime(): number {
    if (!this.audioContext) return this.pauseTime;

    const raw = this.audioContext.currentTime - this.startTime;
    if (this.selection) {
      return clamp(raw, this.selection.start, this.selection.end);
    }
    if (this.audioBuffer) {
      return clamp(raw, 0, this.audioBuffer.duration);
    }
    return raw;
  }

  public getDuration(): number {
    return this.audioBuffer?.duration || 0;
  }

  public getWaveformData(samples: number): Float32Array {
    if (!this.audioBuffer) return new Float32Array(0);

    const channelData = this.audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const waveformData = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let sum = 0;

      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[start + j] || 0);
      }

      waveformData[i] = sum / blockSize;
    }

    const max = Math.max(...waveformData);
    if (max > 0) {
      for (let i = 0; i < samples; i++) {
        waveformData[i] /= max;
      }
    }

    return waveformData;
  }

  private stopSource(): void {
    const source = this.sourceNode;
    if (!source) return;

    this.sourceNode = null;
    source.onended = null;
    try {
      source.stop();
      source.disconnect();
    } catch (e) {
      // Already stopped
    }
  }

  private resetAnalysisData(): void {
    if (this.frequencyData) {
      this.frequencyData.fill(0);
    }
    if (this.timeDomainData) {
      this.timeDomainData.fill(128);
    }
  }

  private startAnalysisLoop(): void {
    const analyze = () => {
      if (!this.analyser || !this.frequencyData || !this.timeDomainData) return;

      this.analyser.getByteFrequencyData(this.frequencyData);
      this.analyser.getByteTimeDomainData(this.timeDomainData);

      this.analysisCallback?.({
        frequencyData: this.frequencyData,
        timeDomainData: this.timeDomainData,
        currentTime: this.getCurrentTime()
      });

      if (this.isPlaying) {
        this.animationFrameId = requestAnimationFrame(analyze);
      }
    };

    analyze();
  }

  private stopAnalysisLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public setAnalysisCallback(callback: AnalysisCallback | null): void {
    this.analysisCallback = callback;
  }

  public setStateChangeCallback(callback: StateChangeCallback | null): void {
    this.stateChangeCallback = callback;
  }

  public setSelectionChangeCallback(callback: SelectionChangeCallback | null): void {
    this.selectionChangeCallback = callback;
  }

  public setEndedCallback(callback: EndedCallback | null): void {
    this.endedCallback = callback;
  }

  public dispose(): void {
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
    this.metadata = null;
    this.frequencyData = null;
    this.timeDomainData = null;
  }
}
