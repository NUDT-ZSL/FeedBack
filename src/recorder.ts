export interface RecordingData {
  id: string;
  blob: Blob;
  waveform: number[];
  duration: number;
  bars: number;
}

type RecorderState = 'idle' | 'recording' | 'playing';

export class RecorderModule {
  private ctx: AudioContext;
  private stream: MediaStream;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private state: RecorderState = 'idle';
  private recordings: RecordingData[] = [];
  private currentRecording: RecordingData | null = null;
  private playbackSource: AudioBufferSourceNode | null = null;
  private playbackStartTime: number = 0;
  private playbackDuration: number = 0;
  private rafId: number = 0;
  private maxBars: number = 16;
  private bpm: number = 140;
  private startRecordingTime: number = 0;
  private onStateChange: ((state: RecorderState) => void) | null = null;
  private onProgress: ((progress: number) => void) | null = null;
  private onRecordingComplete: ((recording: RecordingData) => void) | null = null;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.ctx = ctx;
    this.stream = stream;
  }

  setBPM(bpm: number): void {
    this.bpm = bpm;
  }

  setOnStateChange(cb: (state: RecorderState) => void): void {
    this.onStateChange = cb;
  }

  setOnProgress(cb: (progress: number) => void): void {
    this.onProgress = cb;
  }

  setOnRecordingComplete(cb: (recording: RecordingData) => void): void {
    this.onRecordingComplete = cb;
  }

  getState(): RecorderState {
    return this.state;
  }

  getRecordings(): RecordingData[] {
    return [...this.recordings];
  }

  getCurrentRecording(): RecordingData | null {
    return this.currentRecording;
  }

  isRecording(): boolean {
    return this.state === 'recording';
  }

  isPlaying(): boolean {
    return this.state === 'playing';
  }

  startRecording(): boolean {
    if (this.state !== 'idle') return false;

    try {
      this.chunks = [];
      const options: MediaRecorderOptions = {};
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        const types = ['audio/webm', 'audio/ogg', 'audio/wav'];
        for (const t of types) {
          if (MediaRecorder.isTypeSupported(t)) {
            options.mimeType = t;
            break;
          }
        }
      }
      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        this.chunks = [];
        const recording = await this.processRecording(blob);
        this.recordings.push(recording);
        this.currentRecording = recording;
        this.state = 'idle';
        if (this.onStateChange) this.onStateChange(this.state);
        if (this.onRecordingComplete) this.onRecordingComplete(recording);
      };

      this.mediaRecorder.start(100);
      this.startRecordingTime = this.ctx.currentTime;
      this.state = 'recording';
      if (this.onStateChange) this.onStateChange(this.state);

      const barDuration = (60 / this.bpm) * 4;
      const maxDuration = barDuration * this.maxBars;
      const stopTimer = window.setTimeout(() => {
        if (this.state === 'recording') {
          this.stopRecording();
        }
      }, maxDuration * 1000);
      this.mediaRecorder.addEventListener('stop', () => window.clearTimeout(stopTimer), { once: true });

      return true;
    } catch (err) {
      console.error('录音启动失败:', err);
      this.state = 'idle';
      return false;
    }
  }

  stopRecording(): boolean {
    if (this.state !== 'recording' || !this.mediaRecorder) return false;
    try {
      this.mediaRecorder.stop();
      return true;
    } catch (err) {
      console.error('停止录音失败:', err);
      return false;
    }
  }

  private async processRecording(blob: Blob): Promise<RecordingData> {
    const arrayBuffer = await blob.arrayBuffer();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      const sampleRate = this.ctx.sampleRate;
      audioBuffer = this.ctx.createBuffer(1, sampleRate, sampleRate);
    }

    const waveform = this.generateWaveform(audioBuffer, 200);
    const duration = audioBuffer.duration;
    const barDuration = (60 / this.bpm) * 4;
    const bars = Math.max(1, Math.min(this.maxBars, Math.ceil(duration / barDuration)));

    return {
      id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      blob,
      waveform,
      duration,
      bars,
    };
  }

  private generateWaveform(buffer: AudioBuffer, samples: number): number[] {
    const channelData = buffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const waveform: number[] = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        sum += Math.abs(channelData[j]);
        count++;
      }
      const avg = count > 0 ? sum / count : 0;
      waveform.push(Math.min(1, avg * 3));
    }
    return waveform;
  }

  async playRecording(recordingId?: string): Promise<boolean> {
    if (this.state !== 'idle') return false;

    const recording = recordingId
      ? this.recordings.find(r => r.id === recordingId)
      : this.currentRecording;

    if (!recording) return false;
    this.currentRecording = recording;

    try {
      const arrayBuffer = await recording.blob.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));

      this.playbackSource = this.ctx.createBufferSource();
      this.playbackSource.buffer = audioBuffer;
      this.playbackSource.connect(this.ctx.destination);

      this.playbackDuration = audioBuffer.duration;
      this.playbackStartTime = this.ctx.currentTime;
      this.state = 'playing';
      if (this.onStateChange) this.onStateChange(this.state);

      this.playbackSource.onended = () => {
        this.stopPlayback();
      };

      this.playbackSource.start(0);
      this.updateProgress();
      return true;
    } catch (err) {
      console.error('回放失败:', err);
      this.state = 'idle';
      return false;
    }
  }

  private updateProgress = (): void => {
    if (this.state !== 'playing') return;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    const progress = Math.min(1, elapsed / this.playbackDuration);
    if (this.onProgress) this.onProgress(progress);
    if (progress < 1) {
      this.rafId = requestAnimationFrame(this.updateProgress);
    }
  };

  stopPlayback(): boolean {
    if (this.state !== 'playing') return false;
    try {
      if (this.playbackSource) {
        this.playbackSource.onended = null;
        try { this.playbackSource.stop(); } catch { /* noop */ }
        this.playbackSource.disconnect();
        this.playbackSource = null;
      }
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    } catch {
      /* noop */
    }
    this.state = 'idle';
    if (this.onStateChange) this.onStateChange(this.state);
    if (this.onProgress) this.onProgress(1);
    return true;
  }

  drawWaveform(
    canvas: HTMLCanvasElement,
    waveform: number[],
    progress: number = 0,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (waveform.length === 0) return;

    const midY = rect.height / 2;
    const stepX = rect.width / waveform.length;

    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let i = 0; i < waveform.length; i++) {
      const x = i * stepX;
      const amp = waveform[i] * rect.height * 0.45;
      const t = i / waveform.length;
      const r = Math.floor(76 + (156 - 76) * t);
      const g = Math.floor(175 + (39 - 175) * t);
      const b = Math.floor(80 + (176 - 80) * t);
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;

      if (i === 0) {
        ctx.moveTo(x, midY);
      }

      const nextX = (i + 1) * stepX;
      const nextAmp = waveform[i + 1] ? waveform[i + 1] * rect.height * 0.45 : amp;
      const cpX = (x + nextX) / 2;

      ctx.beginPath();
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.moveTo(x, midY - amp);
      ctx.quadraticCurveTo(cpX, midY - (amp + nextAmp) / 2, nextX, midY - nextAmp);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, midY + amp);
      ctx.quadraticCurveTo(cpX, midY + (amp + nextAmp) / 2, nextX, midY + nextAmp);
      ctx.stroke();
    }

    if (progress > 0 && progress <= 1) {
      const progX = progress * rect.width;
      ctx.fillStyle = 'rgba(255, 64, 129, 0.15)';
      ctx.fillRect(0, 0, progX, rect.height);

      ctx.strokeStyle = '#ff4081';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(progX, 0);
      ctx.lineTo(progX, rect.height);
      ctx.stroke();
    }
  }

  destroy(): void {
    this.stopPlayback();
    if (this.state === 'recording') {
      this.stopRecording();
    }
    this.recordings = [];
    this.currentRecording = null;
  }
}
