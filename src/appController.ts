import { SculptureFrame, VisualizationMode } from './sculptureBuilder';

export interface AudioEngine {
  loadAudio(file: File): Promise<void>;
  play(): void;
  pause(): void;
  seek(time: number): void;
  isPlaying(): boolean;
  hasAudio(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getFrequencyBands(bands: number): number[];
  getWaveformData(samples: number): number[];
}

export interface SculptureView {
  update(frame: SculptureFrame): void;
  setMode(mode: VisualizationMode): Promise<void>;
  rotate(angle: number): void;
  isTransitioning(): boolean;
  getTargetMode(): VisualizationMode;
}

export interface UIViewState {
  hasAudio: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  selectedMode: VisualizationMode;
  isTransitioning: boolean;
}

export interface UIView {
  render(state: UIViewState): void;
  setUploading(uploading: boolean): void;
  notifyUploadError(): void;
  openFileDialog(): void;
}

export interface UIIntents {
  onUpload(file: File): void;
  onPlayPause(): void;
  onSeek(percent: number): void;
  onModeChange(mode: VisualizationMode): void;
}

export interface AppControllerConfig {
  frequencyBands?: number;
  waveformSamples?: number;
}

export class AppController implements UIIntents {
  private frequencyData: number[];
  private waveformData: number[];
  private readonly frequencyBands: number;
  private readonly waveformSamples: number;

  constructor(
    private readonly audio: AudioEngine,
    private readonly sculpture: SculptureView,
    private readonly ui: UIView,
    config: AppControllerConfig = {}
  ) {
    this.frequencyBands = config.frequencyBands ?? 16;
    this.waveformSamples = config.waveformSamples ?? 128;
    this.frequencyData = new Array(this.frequencyBands).fill(0);
    this.waveformData = new Array(this.waveformSamples).fill(0.5);
  }

  tick(delta: number): void {
    const hasAudio = this.audio.hasAudio();
    const isPlaying = this.audio.isPlaying();

    if (hasAudio) {
      this.frequencyData = this.audio.getFrequencyBands(this.frequencyBands);
      this.waveformData = this.audio.getWaveformData(this.waveformSamples);
    }

    this.sculpture.update({
      frequencyData: this.frequencyData,
      waveformData: this.waveformData,
      delta,
      isPlaying,
      paused: hasAudio && !isPlaying
    });

    this.ui.render({
      hasAudio,
      isPlaying,
      currentTime: this.audio.getCurrentTime(),
      duration: this.audio.getDuration(),
      selectedMode: this.sculpture.getTargetMode(),
      isTransitioning: this.sculpture.isTransitioning()
    });
  }

  onUpload(file: File): void {
    void this.loadAudio(file);
  }

  private async loadAudio(file: File): Promise<void> {
    this.ui.setUploading(true);
    try {
      await this.audio.loadAudio(file);
      this.resetSculpture();
    } catch (error) {
      console.error('Failed to load audio:', error);
      this.ui.notifyUploadError();
    } finally {
      this.ui.setUploading(false);
    }
  }

  onPlayPause(): void {
    if (!this.audio.hasAudio()) {
      this.ui.openFileDialog();
      return;
    }
    this.togglePlayPause();
  }

  togglePlayPause(): void {
    if (!this.audio.hasAudio()) return;
    if (this.audio.isPlaying()) {
      this.audio.pause();
    } else {
      this.audio.play();
    }
  }

  pause(): void {
    if (this.audio.isPlaying()) {
      this.audio.pause();
    }
  }

  onSeek(percent: number): void {
    if (!this.audio.hasAudio()) return;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    this.audio.seek(clampedPercent * this.audio.getDuration());
    this.sculpture.rotate(0);
  }

  onModeChange(mode: VisualizationMode): void {
    if (this.sculpture.isTransitioning() || mode === this.sculpture.getTargetMode()) {
      return;
    }
    void this.sculpture.setMode(mode);
  }

  private resetSculpture(): void {
    this.frequencyData = new Array(this.frequencyBands).fill(0);
    this.waveformData = new Array(this.waveformSamples).fill(0.5);
    this.sculpture.rotate(0);
  }
}
