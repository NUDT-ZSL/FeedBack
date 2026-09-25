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
type EndedCallback = () => void;

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
  private currentSelection: Selection | null = null;
  private animationFrameId: number | null = null;
  
  private analysisCallback: AnalysisCallback | null = null;
  private stateChangeCallback: StateChangeCallback | null = null;
  private endedCallback: EndedCallback | null = null;
  
  private readonly FFT_SIZE = 256;
  private readonly SMOOTHING_TIME_CONSTANT = 0.8;
  private static readonly MIN_SELECTION_WIDTH = 0.001;

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

  public play(): void {
    if (!this.audioContext || !this.audioBuffer || this.isPlaying) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const selection = this.currentSelection;
    let offset: number;
    let playDuration: number | undefined;

    if (selection) {
      offset = this.pauseTime;
      if (offset < selection.start || offset >= selection.end) {
        offset = selection.start;
      }
      playDuration = Math.max(0, selection.end - offset);
    } else {
      offset = Math.max(0, Math.min(this.pauseTime, this.audioBuffer.duration));
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.analyser!);

    source.onended = () => {
      if (this.sourceNode !== source) return;
      this.sourceNode = null;
      this.isPlaying = false;
      if (this.currentSelection) {
        this.pauseTime = this.currentSelection.start;
        this.play();
      } else if (this.isLooping) {
        this.pauseTime = 0;
        this.play();
      } else {
        this.pauseTime = 0;
        this.stateChangeCallback?.(false);
        this.stopAnalysisLoop();
        this.endedCallback?.();
      }
    };

    this.sourceNode = source;
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

  private restartPlaybackAt(time: number): void {
    if (this.sourceNode) {
      const oldSource = this.sourceNode;
      this.sourceNode = null;
      try {
        oldSource.stop();
        oldSource.disconnect();
      } catch (e) {
        // Already stopped
      }
    }
    this.isPlaying = false;
    this.pauseTime = time;
    this.play();
  }

  public setSelection(selection: Selection | null): Selection | null {
    const duration = this.audioBuffer?.duration ?? 0;
    let normalized: Selection | null = null;

    if (selection && duration > 0) {
      const start = Math.max(0, Math.min(Math.min(selection.start, selection.end), duration));
      const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), duration));
      if (end - start > AudioEngine.MIN_SELECTION_WIDTH) {
        normalized = { start, end };
      }
    }

    this.currentSelection = normalized;

    if (this.isPlaying) {
      const currentTime = this.getCurrentTime();
      let nextTime: number;
      if (normalized) {
        nextTime = currentTime >= normalized.start && currentTime < normalized.end
          ? currentTime
          : normalized.start;
      } else {
        nextTime = Math.max(0, Math.min(currentTime, duration));
      }
      this.restartPlaybackAt(nextTime);
    } else if (normalized && (this.pauseTime < normalized.start || this.pauseTime >= normalized.end)) {
      this.pauseTime = normalized.start;
    }

    this.notifyTimeUpdate();
    return normalized;
  }

  public getSelection(): Selection | null {
    return this.currentSelection;
  }

  public pause(): void {
    if (!this.isPlaying || !this.audioContext || !this.sourceNode) return;

    this.pauseTime = this.audioContext.currentTime - this.startTime;
    this.sourceNode.stop();
    this.sourceNode.disconnect();
    this.sourceNode = null;
    
    this.isPlaying = false;
    this.stateChangeCallback?.(false);
    this.stopAnalysisLoop();
  }

  public stop(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // Already stopped
      }
      this.sourceNode = null;
    }
    
    this.isPlaying = false;
    this.pauseTime = 0;
    this.currentSelection = null;
    this.stateChangeCallback?.(false);
    this.stopAnalysisLoop();
    
    if (this.frequencyData) {
      this.frequencyData.fill(0);
    }
    if (this.timeDomainData) {
      this.timeDomainData.fill(128);
    }
  }

  public seek(time: number): void {
    if (!this.audioBuffer) return;

    let clampedTime = Math.max(0, Math.min(time, this.audioBuffer.duration));
    const selection = this.currentSelection;
    if (selection && (clampedTime < selection.start || clampedTime >= selection.end)) {
      clampedTime = selection.start;
    }

    if (this.isPlaying) {
      this.restartPlaybackAt(clampedTime);
    } else {
      this.pauseTime = clampedTime;
    }
    this.notifyTimeUpdate();
  }

  private notifyTimeUpdate(): void {
    if (this.analysisCallback && this.frequencyData && this.timeDomainData) {
      this.analysisCallback({
        frequencyData: this.frequencyData,
        timeDomainData: this.timeDomainData,
        currentTime: this.getCurrentTime()
      });
    }
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
    if (!this.audioContext || !this.isPlaying) {
      return this.pauseTime;
    }
    const currentTime = this.audioContext.currentTime - this.startTime;
    if (this.currentSelection) {
      return Math.min(currentTime, this.currentSelection.end);
    }
    if (this.audioBuffer) {
      return Math.min(currentTime, this.audioBuffer.duration);
    }
    return currentTime;
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
