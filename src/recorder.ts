import { INSTRUMENTS } from './sequencer.js';

export interface StemData {
  instrumentId: string;
  name: string;
  icon: string;
  color: string;
  blob: Blob;
  waveform: number[];
  startTime: number;
  endTime: number;
  duration: number;
  hasNotes: boolean;
  audioBuffer?: AudioBuffer;
}

export interface RecordingData {
  id: string;
  blob: Blob;
  waveform: number[];
  duration: number;
  bars: number;
  stems: StemData[];
  mixBuffer?: AudioBuffer;
}

type RecorderState = 'idle' | 'recording' | 'playing';

interface StemRecorder {
  id: string;
  recorder: MediaRecorder;
  chunks: Blob[];
}

interface StemPlaybackNode {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class RecorderModule {
  private ctx: AudioContext;
  private stream: MediaStream;
  private stemStreams: Map<string, MediaStream>;
  private stemPlaybackGain: number;
  private mediaRecorder: MediaRecorder | null = null;
  private stemRecorders: StemRecorder[] = [];
  private chunks: Blob[] = [];
  private state: RecorderState = 'idle';
  private recordings: RecordingData[] = [];
  private currentRecording: RecordingData | null = null;
  private playbackSource: AudioBufferSourceNode | null = null;
  private playbackGainNode: GainNode | null = null;
  private stemNodes: Map<string, StemPlaybackNode> = new Map();
  private playbackMode: 'mix' | 'stems' = 'mix';
  private playbackRecording: RecordingData | null = null;
  private activeStemIds: Set<string> = new Set();
  private playbackStartTime: number = 0;
  private playbackDuration: number = 0;
  private rafId: number = 0;
  private maxBars: number = 16;
  private bpm: number = 140;
  private startRecordingTime: number = 0;
  private onStateChange: ((state: RecorderState) => void) | null = null;
  private onProgress: ((progress: number) => void) | null = null;
  private onRecordingComplete: ((recording: RecordingData) => void) | null = null;

  constructor(
    ctx: AudioContext,
    stream: MediaStream,
    stemStreams?: Map<string, MediaStream>,
    stemPlaybackGain: number = 1,
  ) {
    this.ctx = ctx;
    this.stream = stream;
    this.stemStreams = stemStreams ?? new Map<string, MediaStream>();
    this.stemPlaybackGain = stemPlaybackGain;
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

  getStems(recordingId?: string): StemData[] {
    const rec = recordingId
      ? this.recordings.find(r => r.id === recordingId)
      : this.currentRecording;
    return rec ? [...rec.stems] : [];
  }

  getActiveStemIds(): string[] {
    return [...this.activeStemIds];
  }

  /**
   * 更新当前选中的声部组合。空数组表示整段混音。
   * 若正在回放，则按原时间轴位置平滑切换到新组合（淡入淡出，无残留）。
   */
  setActiveStems(ids: string[]): void {
    this.activeStemIds = new Set(ids);
    if (this.state !== 'playing' || !this.playbackRecording) return;

    const rec = this.playbackRecording;
    const elapsed = Math.max(0, this.ctx.currentTime - this.playbackStartTime);

    if (this.activeStemIds.size === 0) {
      if (this.playbackMode === 'stems') {
        this.stopAllStemNodes(true);
        this.playbackMode = 'mix';
        this.startMixSource(elapsed);
      }
      return;
    }

    if (this.playbackMode === 'mix') {
      this.stopMixSource(true);
      this.playbackMode = 'stems';
      for (const id of this.activeStemIds) {
        this.startStemNode(rec, id, elapsed);
      }
      if (this.stemNodes.size === 0) {
        this.playbackMode = 'mix';
        this.startMixSource(elapsed);
      }
      return;
    }

    for (const id of [...this.stemNodes.keys()]) {
      if (!this.activeStemIds.has(id)) {
        this.stopStemNode(id, true);
      }
    }
    for (const id of this.activeStemIds) {
      if (!this.stemNodes.has(id)) {
        this.startStemNode(rec, id, elapsed);
      }
    }
    if (this.stemNodes.size === 0) {
      this.playbackMode = 'mix';
      this.startMixSource(elapsed);
    }
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

      // 每个乐器一条独立录音通路，与混音同步启停
      this.stemRecorders = [];
      this.stemStreams.forEach((stream, id) => {
        try {
          const rec = new MediaRecorder(stream, options);
          const entry: StemRecorder = { id, recorder: rec, chunks: [] };
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) {
              entry.chunks.push(e.data);
            }
          };
          this.stemRecorders.push(entry);
        } catch (err) {
          console.warn(`声部 ${id} 录音器创建失败，将以静音处理:`, err);
        }
      });

      this.mediaRecorder.onstop = async () => {
        await this.waitForStemRecorders();
        const stemBlobs = new Map<string, Blob>();
        for (const sr of this.stemRecorders) {
          stemBlobs.set(
            sr.id,
            new Blob(sr.chunks, { type: sr.recorder.mimeType || options.mimeType || 'audio/webm' }),
          );
          sr.chunks = [];
        }
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        this.chunks = [];
        const recording = await this.processRecording(blob, stemBlobs);
        this.recordings.push(recording);
        this.currentRecording = recording;
        this.state = 'idle';
        if (this.onStateChange) this.onStateChange(this.state);
        if (this.onRecordingComplete) this.onRecordingComplete(recording);
      };

      this.mediaRecorder.start(100);
      for (const sr of this.stemRecorders) {
        try {
          sr.recorder.start(100);
        } catch (err) {
          console.warn(`声部 ${sr.id} 录音启动失败:`, err);
        }
      }
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
      for (const sr of this.stemRecorders) {
        try {
          if (sr.recorder.state !== 'inactive') sr.recorder.stop();
        } catch { /* noop */ }
      }
      this.mediaRecorder.stop();
      return true;
    } catch (err) {
      console.error('停止录音失败:', err);
      return false;
    }
  }

  private waitForStemRecorders(): Promise<void> {
    const waits = this.stemRecorders.map(sr => new Promise<void>((resolve) => {
      if (sr.recorder.state === 'inactive') {
        resolve();
        return;
      }
      sr.recorder.addEventListener('stop', () => resolve(), { once: true });
      window.setTimeout(() => resolve(), 2000);
    }));
    return Promise.all(waits).then(() => undefined);
  }

  private async decodeBlob(blob: Blob): Promise<AudioBuffer | null> {
    try {
      if (blob.size === 0) return null;
      const arrayBuffer = await blob.arrayBuffer();
      return await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      return null;
    }
  }

  private padBuffer(buffer: AudioBuffer, length: number): AudioBuffer {
    if (buffer.length >= length) return buffer;
    const out = this.ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      out.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    return out;
  }

  private computePeak(buffer: AudioBuffer): number {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
    }
    return peak;
  }

  private async processRecording(blob: Blob, stemBlobs: Map<string, Blob>): Promise<RecordingData> {
    const decodedMix = await this.decodeBlob(blob);
    const mixBuffer = decodedMix ?? this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);

    const stemBuffers = new Map<string, AudioBuffer>();
    for (const inst of INSTRUMENTS) {
      const stemBlob = stemBlobs.get(inst.id);
      if (stemBlob) {
        const buf = await this.decodeBlob(stemBlob);
        if (buf) stemBuffers.set(inst.id, buf);
      }
    }

    // 统一时间轴：所有声部与整段等长，且不短于任何一路的实际录音长度
    let length = Math.max(1, mixBuffer.length);
    stemBuffers.forEach((buf) => {
      if (buf.length > length) length = buf.length;
    });

    const paddedMix = this.padBuffer(mixBuffer, length);
    const duration = length / this.ctx.sampleRate;

    const stems: StemData[] = INSTRUMENTS.map((inst) => {
      const raw = stemBuffers.get(inst.id) ?? null;
      const buffer = raw
        ? this.padBuffer(raw, length)
        : this.ctx.createBuffer(paddedMix.numberOfChannels, length, this.ctx.sampleRate);
      const hasNotes = raw !== null && this.computePeak(raw) > 1e-4;
      return {
        instrumentId: inst.id,
        name: inst.name,
        icon: inst.icon,
        color: inst.color,
        blob: stemBlobs.get(inst.id) ?? new Blob([], { type: 'audio/webm' }),
        waveform: this.generateWaveform(buffer, 200),
        startTime: 0,
        endTime: duration,
        duration,
        hasNotes,
        audioBuffer: buffer,
      };
    });

    const waveform = this.generateWaveform(paddedMix, 200);
    const barDuration = (60 / this.bpm) * 4;
    const bars = Math.max(1, Math.min(this.maxBars, Math.ceil(duration / barDuration)));

    return {
      id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      blob,
      waveform,
      duration,
      bars,
      stems,
      mixBuffer: paddedMix,
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

  async playRecording(recordingId?: string, stemIds?: string[]): Promise<boolean> {
    if (this.state !== 'idle') return false;

    const recording = recordingId
      ? this.recordings.find(r => r.id === recordingId)
      : this.currentRecording;

    if (!recording) return false;
    this.currentRecording = recording;
    this.playbackRecording = recording;

    const selected = stemIds ? new Set(stemIds) : new Set(this.activeStemIds);
    this.activeStemIds = selected;

    try {
      if (!recording.mixBuffer) {
        recording.mixBuffer =
          (await this.decodeBlob(recording.blob)) ??
          this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      }

      // 进度时间基准始终为整段时长，与声部数量无关
      this.playbackDuration = recording.duration;
      this.playbackStartTime = this.ctx.currentTime;
      this.state = 'playing';
      if (this.onStateChange) this.onStateChange(this.state);

      if (selected.size === 0) {
        this.playbackMode = 'mix';
        this.startMixSource(0);
      } else {
        this.playbackMode = 'stems';
        for (const id of selected) {
          this.startStemNode(recording, id, 0);
        }
        if (this.stemNodes.size === 0) {
          this.playbackMode = 'mix';
          this.startMixSource(0);
        }
      }

      this.updateProgress();
      return true;
    } catch (err) {
      console.error('回放失败:', err);
      this.state = 'idle';
      return false;
    }
  }

  private startMixSource(offset: number): void {
    const rec = this.playbackRecording;
    if (!rec || !rec.mixBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = rec.mixBuffer;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(1, now, 0.02);
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.onended = () => {
      if (this.playbackMode === 'mix' && this.state === 'playing') {
        this.stopPlayback();
      }
    };
    src.start(0, Math.min(offset, rec.mixBuffer.duration));
    this.playbackSource = src;
    this.playbackGainNode = gain;
  }

  private stopMixSource(smooth: boolean): void {
    const src = this.playbackSource;
    const gain = this.playbackGainNode;
    this.playbackSource = null;
    this.playbackGainNode = null;
    if (!src) return;
    src.onended = null;
    try {
      if (smooth && gain) {
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.02);
        window.setTimeout(() => {
          try { src.stop(); } catch { /* noop */ }
          try { src.disconnect(); gain.disconnect(); } catch { /* noop */ }
        }, 150);
      } else {
        src.stop();
        src.disconnect();
        if (gain) gain.disconnect();
      }
    } catch { /* noop */ }
  }

  private startStemNode(recording: RecordingData, id: string, offset: number): void {
    const stem = recording.stems.find(s => s.instrumentId === id);
    if (!stem || !stem.audioBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = stem.audioBuffer;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(this.stemPlaybackGain, now, 0.03);
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.onended = () => {
      this.stemNodes.delete(id);
      if (
        this.state === 'playing' &&
        this.playbackMode === 'stems' &&
        this.stemNodes.size === 0
      ) {
        this.stopPlayback();
      }
    };
    src.start(0, Math.min(offset, stem.audioBuffer.duration));
    this.stemNodes.set(id, { src, gain });
  }

  private stopStemNode(id: string, smooth: boolean): void {
    const node = this.stemNodes.get(id);
    if (!node) return;
    this.stemNodes.delete(id);
    const { src, gain } = node;
    src.onended = null;
    try {
      if (smooth) {
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.03);
        window.setTimeout(() => {
          try { src.stop(); } catch { /* noop */ }
          try { src.disconnect(); gain.disconnect(); } catch { /* noop */ }
        }, 150);
      } else {
        src.stop();
        src.disconnect();
        gain.disconnect();
      }
    } catch { /* noop */ }
  }

  private stopAllStemNodes(smooth: boolean): void {
    for (const id of [...this.stemNodes.keys()]) {
      this.stopStemNode(id, smooth);
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
      this.stopMixSource(false);
      this.stopAllStemNodes(false);
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    } catch {
      /* noop */
    }
    this.playbackRecording = null;
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
    this.playbackRecording = null;
    this.stemRecorders = [];
    this.activeStemIds.clear();
  }
}
