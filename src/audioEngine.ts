export interface AudioEngineCallbacks {
  onWaveformData: (data: Float32Array) => void;
  onFrequencyData: (data: Uint8Array) => void;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onPlayEnd: () => void;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private waveformData: Float32Array | null = null;
  private frequencyData: Uint8Array | null = null;
  private startTime: number = 0;
  private pausedAt: number = 0;
  private isPlaying: boolean = false;
  private animationFrameId: number | null = null;
  private callbacks: AudioEngineCallbacks;
  private duration: number = 0;

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  async loadAudioFile(file: File): Promise<void> {
    const ctx = this.ensureAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    
    this.stop();
    this.audioBuffer = audioBuffer;
    this.duration = audioBuffer.duration;
    this.pausedAt = 0;

    this.waveformData = this.extractWaveformData(audioBuffer, 2048);
    this.callbacks.onWaveformData(this.waveformData);

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 1;

    this.callbacks.onTimeUpdate(0, this.duration);
  }

  private extractWaveformData(audioBuffer: AudioBuffer, samples: number): Float32Array {
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const result = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[start + j] || 0);
      }
      result[i] = sum / blockSize;
    }

    const max = Math.max(...result);
    if (max > 0) {
      for (let i = 0; i < result.length; i++) {
        result[i] = result[i] / max;
      }
    }

    return result;
  }

  play(): void {
    if (!this.audioBuffer || !this.audioContext || this.isPlaying) return;

    const ctx = this.audioContext;
    
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pausedAt = 0;
        this.callbacks.onPlayEnd();
        this.stopAnimationLoop();
      }
    };

    if (this.analyserNode && this.gainNode) {
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.gainNode);
      this.gainNode.connect(ctx.destination);
    } else {
      this.sourceNode.connect(ctx.destination);
    }

    this.startTime = ctx.currentTime - this.pausedAt;
    this.sourceNode.start(0, this.pausedAt);
    this.isPlaying = true;
    this.startAnimationLoop();
  }

  pause(): void {
    if (!this.isPlaying || !this.sourceNode || !this.audioContext) return;

    this.pausedAt = this.audioContext.currentTime - this.startTime;
    this.sourceNode.stop();
    this.sourceNode.onended = null;
    this.sourceNode.disconnect();
    this.sourceNode = null;
    this.isPlaying = false;
    this.stopAnimationLoop();
  }

  stop(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch (e) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this.pausedAt = 0;
    this.stopAnimationLoop();
  }

  seek(time: number): void {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.pause();
    }
    this.pausedAt = Math.max(0, Math.min(time, this.duration));
    this.callbacks.onTimeUpdate(this.pausedAt, this.duration);
    if (wasPlaying) {
      this.play();
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getDuration(): number {
    return this.duration;
  }

  getCurrentTime(): number {
    if (!this.audioContext) return this.pausedAt;
    if (this.isPlaying) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pausedAt;
  }

  private startAnimationLoop(): void {
    const loop = () => {
      if (!this.isPlaying) return;

      if (this.analyserNode && this.frequencyData) {
        this.analyserNode.getByteFrequencyData(this.frequencyData as Uint8Array<ArrayBuffer>);
        this.callbacks.onFrequencyData(this.frequencyData);
      }

      const currentTime = this.getCurrentTime();
      this.callbacks.onTimeUpdate(currentTime, this.duration);

      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  destroy(): void {
    this.stop();
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
