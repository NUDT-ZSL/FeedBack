import {
  PlaybackState,
  type PlaybackSnapshot,
  type Selection
} from './PlaybackState.ts';

export type { Selection, PlaybackSnapshot } from './PlaybackState.ts';

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

type AnalysisCallback = (data: AudioAnalysisData) => void;
type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

const END_EPSILON = 0.02;

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private metadata: AudioMetadata | null = null;

  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private timeDomainData: Uint8Array<ArrayBuffer> | null = null;

  private readonly playbackState: PlaybackState;
  private readonly playbackListeners = new Set<PlaybackListener>();
  private animationFrameId: number | null = null;

  private analysisCallback: AnalysisCallback | null = null;

  private readonly FFT_SIZE = 256;
  private readonly SMOOTHING_TIME_CONSTANT = 0.8;

  constructor() {
    this.playbackState = new PlaybackState(() => this.audioContext?.currentTime ?? 0);
    this.playbackState.subscribe(() => this.emitPlaybackSnapshot());
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

  /** 订阅播放状态快照：首次订阅立即推送一次，之后状态变更与每帧时间推进都会推送 */
  public subscribe(listener: PlaybackListener): () => void {
    this.playbackListeners.add(listener);
    listener(this.playbackState.getSnapshot());
    return () => {
      this.playbackListeners.delete(listener);
    };
  }

  public getSnapshot(): PlaybackSnapshot {
    return this.playbackState.getSnapshot();
  }

  private emitPlaybackSnapshot(): void {
    const snapshot = this.playbackState.getSnapshot();
    this.playbackListeners.forEach(listener => listener(snapshot));
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

    this.playbackState.load(this.audioBuffer.duration);

    return this.audioBuffer;
  }

  public getMetadata(): AudioMetadata | null {
    return this.metadata;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  public play(): void {
    if (!this.audioContext || !this.audioBuffer) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const wasPlaying = this.playbackState.getSnapshot().isPlaying;
    const snapshot = this.playbackState.play();
    if (wasPlaying || !snapshot.isPlaying) return;

    this.startSource(snapshot.position);
    this.startAnalysisLoop();
  }

  public pause(): void {
    const wasPlaying = this.playbackState.getSnapshot().isPlaying;
    this.playbackState.pause();
    if (!wasPlaying) return;

    this.stopSource();
    this.stopAnalysisLoop();
  }

  public stop(): void {
    this.playbackState.stop();
    this.stopSource();
    this.stopAnalysisLoop();
    this.clearAnalysisData();
  }

  public seek(time: number): void {
    const wasPlaying = this.playbackState.getSnapshot().isPlaying;
    const snapshot = this.playbackState.seek(time);
    if (wasPlaying) {
      this.startSource(snapshot.position);
    }
  }

  public setSelection(selection: Selection | null): void {
    const before = this.playbackState.getSnapshot();
    const after = this.playbackState.setSelection(selection);
    if (!after.isPlaying) return;

    const beforeEnd = before.selection ? before.selection.end : before.duration;
    const afterEnd = after.selection ? after.selection.end : after.duration;
    const beforeStart = before.selection ? before.selection.start : 0;
    const afterStart = after.selection ? after.selection.start : 0;

    if (beforeStart !== afterStart || beforeEnd !== afterEnd) {
      this.startSource(after.position);
    }
  }

  public toggleLoop(): boolean {
    this.playbackState.toggleLoop();
    return this.playbackState.getSnapshot().isLooping;
  }

  public isLoopingEnabled(): boolean {
    return this.playbackState.getSnapshot().isLooping;
  }

  public getIsPlaying(): boolean {
    return this.playbackState.getSnapshot().isPlaying;
  }

  public getCurrentTime(): number {
    return this.playbackState.getSnapshot().position;
  }

  public getDuration(): number {
    return this.playbackState.getSnapshot().duration;
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

  private startSource(position: number): void {
    if (!this.audioContext || !this.audioBuffer) return;

    this.stopSource();

    const snapshot = this.playbackState.getSnapshot();
    const end = snapshot.selection ? snapshot.selection.end : snapshot.duration;
    const offset = Math.min(Math.max(position, 0), end);
    const remaining = Math.max(0, end - offset);

    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.analyser!);
    source.onended = () => this.handleSourceEnded(source);
    this.sourceNode = source;
    source.start(0, offset, remaining);
  }

  private handleSourceEnded(source: AudioBufferSourceNode): void {
    if (source !== this.sourceNode) return;
    this.sourceNode = null;
    source.disconnect();

    const snapshot = this.playbackState.getSnapshot();
    if (!snapshot.isPlaying) {
      this.stopAnalysisLoop();
      this.clearAnalysisData();
      return;
    }

    const effectiveEnd = snapshot.selection ? snapshot.selection.end : snapshot.duration;
    if (snapshot.position < effectiveEnd - END_EPSILON) {
      this.startSource(snapshot.position);
      return;
    }

    const next = this.playbackState.handleEnded();
    if (next.isPlaying) {
      this.startSource(next.position);
    } else {
      this.stopAnalysisLoop();
      this.clearAnalysisData();
    }
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

  private startAnalysisLoop(): void {
    const analyze = () => {
      if (!this.analyser || !this.frequencyData || !this.timeDomainData) return;

      this.analyser.getByteFrequencyData(this.frequencyData);
      this.analyser.getByteTimeDomainData(this.timeDomainData);

      const snapshot = this.playbackState.getSnapshot();
      this.analysisCallback?.({
        frequencyData: this.frequencyData,
        timeDomainData: this.timeDomainData,
        currentTime: snapshot.position
      });
      this.emitPlaybackSnapshot();

      if (snapshot.isPlaying) {
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

  private clearAnalysisData(): void {
    this.frequencyData?.fill(0);
    this.timeDomainData?.fill(128);
  }

  public setAnalysisCallback(callback: AnalysisCallback | null): void {
    this.analysisCallback = callback;
  }

  public dispose(): void {
    this.stop();
    this.playbackListeners.clear();

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
