import type { AudioPort, SculpturePort, UIPort, UIViewState } from './contracts';
import { VisualizationMode } from './sculptureBuilder';

export interface AppControllerConfig {
  frequencyBands: number;
  waveformSamples: number;
}

/**
 * 应用状态协调器：接收 UI 意图，驱动音频模块与雕塑模块，
 * 并在每次状态变化后将统一的视图状态推送给 UI。
 * 不依赖 DOM 与 WebGL，可在离线环境中确定性步进。
 */
export class AppController {
  private uploadHintVisible: boolean = true;
  private uploadBusy: boolean = false;

  constructor(
    private readonly audio: AudioPort,
    private readonly sculpture: SculpturePort,
    private readonly ui: UIPort,
    private readonly config: AppControllerConfig = { frequencyBands: 16, waveformSamples: 128 }
  ) {}

  async upload(file: File): Promise<void> {
    this.uploadBusy = true;
    this.syncUI();
    try {
      await this.audio.loadAudio(file);
      this.uploadHintVisible = false;
      this.sculpture.rotate(0);
    } catch (error) {
      console.error('Failed to load audio:', error);
      this.ui.notifyUploadError(error);
    } finally {
      this.uploadBusy = false;
      this.syncUI();
    }
  }

  togglePlayPause(): void {
    if (!this.audio.hasAudio()) return;
    if (this.audio.isPlaying()) {
      this.audio.pause();
    } else {
      this.audio.play();
    }
    this.syncUI();
  }

  pausePlayback(): void {
    if (!this.audio.isPlaying()) return;
    this.audio.pause();
    this.syncUI();
  }

  seek(time: number): void {
    if (!this.audio.hasAudio()) return;
    this.audio.seek(time);
    this.sculpture.rotate(0);
    this.syncUI();
  }

  changeMode(mode: VisualizationMode): void {
    this.sculpture.requestModeChange(mode);
    this.syncUI();
  }

  tick(delta: number): void {
    const frame = this.audio.getFrame(this.config.frequencyBands, this.config.waveformSamples);
    this.sculpture.update(frame, delta);
    this.syncUI();
  }

  hasAudio(): boolean {
    return this.audio.hasAudio();
  }

  private syncUI(): void {
    this.ui.render(this.buildViewState());
  }

  private buildViewState(): UIViewState {
    return {
      hasAudio: this.audio.hasAudio(),
      isPlaying: this.audio.isPlaying(),
      currentTime: this.audio.getCurrentTime(),
      duration: this.audio.getDuration(),
      activeMode: this.sculpture.getTargetMode(),
      uploadHintVisible: this.uploadHintVisible,
      uploadBusy: this.uploadBusy
    };
  }
}
