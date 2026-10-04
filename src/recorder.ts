import { INSTRUMENTS } from './sequencer.js';

export interface TrackRecording {
  instrumentId: string;
  name: string;
  icon: string;
  color: string;
  blob: Blob;
  waveform: number[];
  start: number;
  end: number;
  duration: number;
  silent: boolean;
}

export interface RecordingData {
  id: string;
  blob: Blob;
  waveform: number[];
  duration: number;
  bars: number;
  tracks: TrackRecording[];
}

type RecorderState = 'idle' | 'recording' | 'playing';

export class RecorderModule {
  private ctx: AudioContext;
  private stream: MediaStream;
  private trackStreams: Map<string, MediaStream>;
  private mediaRecorder: MediaRecorder | null = null;
  private trackRecorders: Map<string, MediaRecorder> = new Map();
  private chunks: Blob[] = [];
  private trackChunks: Map<string, Blob[]> = new Map();
  private stopPromises: Promise<void>[] = [];
  private pendingMasterBlob: Blob | null = null;
  private pendingTrackBlobs: Map<string, Blob> = new Map();
  private state: RecorderState = 'idle';
  private recordings: RecordingData[] = [];
  private currentRecording: RecordingData | null = null;
  private trackBuffers: Map<string, Map<string, AudioBuffer>> = new Map();
  private playbackSources: AudioBufferSourceNode[] = [];
  private playbackRecording: RecordingData | null = null;
  private selectedTrackIds: Set<string> | null = null;
  private playbackStartTime: number = 0;
  private playbackDuration: number = 0;
  private rafId: number = 0;
  private endTimer: number = 0;
  private maxBars: number = 16;
  private bpm: number = 140;
  private startRecordingTime: number = 0;
  private stopRecordingTime: number = 0;
  private onStateChange: ((state: RecorderState) => void) | null = null;
  private onProgress: ((progress: number) => void) | null = null;
  private onRecordingComplete: ((recording: RecordingData) => void) | null = null;

  constructor(ctx: AudioContext, stream: MediaStream, trackStreams?: Map<string, MediaStream>) {
    this.ctx = ctx;
    this.stream = stream;
    this.trackStreams = trackStreams ?? new Map();
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

  getTrackList(recordingId?: string): TrackRecording[] {
    const recording = recordingId
      ? this.recordings.find(r => r.id === recordingId)
      : this.currentRecording;
    return recording ? recording.tracks.map(t => ({ ...t, waveform: [...t.waveform] })) : [];
  }

  getSelectedTrackIds(): string[] {
    if (this.selectedTrackIds === null) {
      return INSTRUMENTS.map(i => i.id);
    }
    return [...this.selectedTrackIds];
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
      this.trackChunks.clear();
      this.stopPromises = [];
      this.pendingMasterBlob = null;
      this.pendingTrackBlobs = new Map();

      const options: MediaRecorderOptions = {};
      const mime = this.pickMimeType();
      if (mime) options.mimeType = mime;

      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.stopPromises.push(new Promise<void>((resolve) => {
        this.mediaRecorder!.addEventListener('stop', () => {
          this.pendingMasterBlob = new Blob(this.chunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm',
          });
          this.chunks = [];
          resolve();
        }, { once: true });
      }));

      this.trackRecorders.clear();
      for (const [id, stream] of this.trackStreams) {
        try {
          const rec = new MediaRecorder(stream, options);
          const chunks: Blob[] = [];
          this.trackChunks.set(id, chunks);
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          this.stopPromises.push(new Promise<void>((resolve) => {
            rec.addEventListener('stop', () => {
              this.pendingTrackBlobs.set(id, new Blob(chunks, {
                type: rec.mimeType || 'audio/webm',
              }));
              resolve();
            }, { once: true });
          }));
          this.trackRecorders.set(id, rec);
        } catch (err) {
          console.warn(`声部 ${id} 录音器创建失败:`, err);
        }
      }

      this.mediaRecorder.start(100);
      for (const rec of this.trackRecorders.values()) {
        try { rec.start(100); } catch { /* noop */ }
      }
      this.startRecordingTime = this.ctx.currentTime;
      this.stopRecordingTime = 0;
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

  private pickMimeType(): string | undefined {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
    const types = ['audio/webm', 'audio/ogg', 'audio/wav'];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return undefined;
  }

  stopRecording(): boolean {
    if (this.state !== 'recording' || !this.mediaRecorder) return false;
    try {
      this.stopRecordingTime = this.ctx.currentTime;
      this.mediaRecorder.stop();
      for (const rec of this.trackRecorders.values()) {
        try {
          if (rec.state !== 'inactive') rec.stop();
        } catch { /* noop */ }
      }
      void this.finalizeRecording();
      return true;
    } catch (err) {
      console.error('停止录音失败:', err);
      return false;
    }
  }

  private async finalizeRecording(): Promise<void> {
    try {
      await Promise.race([
        Promise.all(this.stopPromises),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
      ]);
    } catch { /* 忽略个别声部失败 */ }
    const masterBlob = this.pendingMasterBlob
      ?? new Blob([], { type: 'audio/webm' });
    const recording = await this.processRecording(masterBlob, this.pendingTrackBlobs);
    this.pendingMasterBlob = null;
    this.pendingTrackBlobs = new Map();
    this.recordings.push(recording);
    this.currentRecording = recording;
    this.state = 'idle';
    if (this.onStateChange) this.onStateChange(this.state);
    if (this.onRecordingComplete) this.onRecordingComplete(recording);
  }

  private async decodeBlob(blob: Blob | undefined): Promise<AudioBuffer | null> {
    if (!blob || blob.size === 0) return null;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      return await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      return null;
    }
  }

  private async processRecording(
    masterBlob: Blob,
    trackBlobs: Map<string, Blob>,
  ): Promise<RecordingData> {
    const sampleRate = this.ctx.sampleRate;

    const masterBuffer = await this.decodeBlob(masterBlob);

    const decodedTracks = new Map<string, AudioBuffer | null>();
    for (const inst of INSTRUMENTS) {
      decodedTracks.set(inst.id, await this.decodeBlob(trackBlobs.get(inst.id)));
    }

    // 目标长度：不小于实际录音时长，且所有声部一致
    const elapsed = this.stopRecordingTime > this.startRecordingTime
      ? this.stopRecordingTime - this.startRecordingTime
      : 0;
    let targetLen = Math.max(1, Math.ceil(elapsed * sampleRate));
    if (masterBuffer) targetLen = Math.max(targetLen, masterBuffer.length);
    for (const buf of decodedTracks.values()) {
      if (buf) targetLen = Math.max(targetLen, buf.length);
    }

    const padTo = (buf: AudioBuffer | null): AudioBuffer => {
      const channels = buf ? buf.numberOfChannels : 1;
      const out = this.ctx.createBuffer(channels, targetLen, sampleRate);
      if (buf) {
        for (let c = 0; c < channels; c++) {
          const src = buf.getChannelData(c);
          out.getChannelData(c).set(src.subarray(0, Math.min(src.length, targetLen)));
        }
      }
      return out;
    };

    const duration = targetLen / sampleRate;
    const id = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    const trackBufMap = new Map<string, AudioBuffer>();
    const tracks: TrackRecording[] = [];
    for (const inst of INSTRUMENTS) {
      const padded = padTo(decodedTracks.get(inst.id) ?? null);
      trackBufMap.set(inst.id, padded);
      const waveform = this.generateWaveform(padded, 200);
      let peak = 0;
      for (const v of waveform) peak = Math.max(peak, v);
      tracks.push({
        instrumentId: inst.id,
        name: inst.name,
        icon: inst.icon,
        color: inst.color,
        blob: trackBlobs.get(inst.id) ?? new Blob([], { type: 'audio/webm' }),
        waveform,
        start: 0,
        end: duration,
        duration,
        silent: peak < 0.001,
      });
    }
    this.trackBuffers.set(id, trackBufMap);

    const masterPadded = padTo(masterBuffer);
    const waveform = this.generateWaveform(masterPadded, 200);
    const barDuration = (60 / this.bpm) * 4;
    const bars = Math.max(1, Math.min(this.maxBars, Math.ceil(duration / barDuration)));

    return {
      id,
      blob: masterBlob,
      waveform,
      duration,
      bars,
      tracks,
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

  async playRecording(recordingId?: string, trackIds?: string[]): Promise<boolean> {
    if (this.state !== 'idle') return false;

    const recording = recordingId
      ? this.recordings.find(r => r.id === recordingId)
      : this.currentRecording;

    if (!recording) return false;
    this.currentRecording = recording;
    if (trackIds) {
      this.selectedTrackIds = new Set(trackIds);
    }

    try {
      const buffers = await this.getTrackBuffers(recording);
      this.playbackRecording = recording;
      this.playbackDuration = recording.duration;
      this.playbackStartTime = this.ctx.currentTime;
      this.state = 'playing';
      if (this.onStateChange) this.onStateChange(this.state);

      this.startSourcesForSelection(recording, buffers, 0);
      this.scheduleEndTimer();
      this.updateProgress();
      return true;
    } catch (err) {
      console.error('回放失败:', err);
      this.state = 'idle';
      return false;
    }
  }

  private async getTrackBuffers(recording: RecordingData): Promise<Map<string, AudioBuffer>> {
    const cached = this.trackBuffers.get(recording.id);
    if (cached) return cached;
    // 兜底：从各声部 blob 解码并按整段时长补齐
    const sampleRate = this.ctx.sampleRate;
    const targetLen = Math.max(1, Math.ceil(recording.duration * sampleRate));
    const map = new Map<string, AudioBuffer>();
    for (const track of recording.tracks) {
      const decoded = await this.decodeBlob(track.blob);
      const channels = decoded ? decoded.numberOfChannels : 1;
      const out = this.ctx.createBuffer(channels, targetLen, sampleRate);
      if (decoded) {
        for (let c = 0; c < channels; c++) {
          const src = decoded.getChannelData(c);
          out.getChannelData(c).set(src.subarray(0, Math.min(src.length, targetLen)));
        }
      }
      map.set(track.instrumentId, out);
    }
    this.trackBuffers.set(recording.id, map);
    return map;
  }

  private getEffectiveSelection(recording: RecordingData): string[] {
    const validIds = new Set(recording.tracks.map(t => t.instrumentId));
    if (this.selectedTrackIds === null) {
      return recording.tracks.map(t => t.instrumentId);
    }
    return [...this.selectedTrackIds].filter(id => validIds.has(id));
  }

  private startSourcesForSelection(
    recording: RecordingData,
    buffers: Map<string, AudioBuffer>,
    offset: number,
  ): void {
    this.clearPlaybackSources();
    const selected = this.getEffectiveSelection(recording);
    const when = this.ctx.currentTime;
    for (const trackId of selected) {
      const buf = buffers.get(trackId);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.onended = () => {
        this.playbackSources = this.playbackSources.filter(s => s !== src);
        try { src.disconnect(); } catch { /* noop */ }
      };
      src.start(when, offset);
      this.playbackSources.push(src);
    }
  }

  private clearPlaybackSources(): void {
    for (const src of this.playbackSources) {
      src.onended = null;
      try { src.stop(); } catch { /* noop */ }
      try { src.disconnect(); } catch { /* noop */ }
    }
    this.playbackSources = [];
  }

  private scheduleEndTimer(): void {
    if (this.endTimer) {
      window.clearTimeout(this.endTimer);
      this.endTimer = 0;
    }
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    const remaining = Math.max(0, this.playbackDuration - elapsed);
    this.endTimer = window.setTimeout(() => {
      if (this.state === 'playing') {
        this.stopPlayback();
      }
    }, remaining * 1000 + 50);
  }

  setPlaybackTracks(trackIds: string[]): void {
    this.selectedTrackIds = new Set(trackIds);
    if (this.state !== 'playing' || !this.playbackRecording) return;
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    if (elapsed >= this.playbackDuration) {
      this.stopPlayback();
      return;
    }
    const buffers = this.trackBuffers.get(this.playbackRecording.id);
    if (!buffers) return;
    // 保持 playbackStartTime 不变，按已播放偏移无缝切换声部组合
    this.startSourcesForSelection(this.playbackRecording, buffers, elapsed);
    this.scheduleEndTimer();
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
      this.clearPlaybackSources();
      if (this.endTimer) {
        window.clearTimeout(this.endTimer);
        this.endTimer = 0;
      }
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
    this.trackBuffers.clear();
  }
}
