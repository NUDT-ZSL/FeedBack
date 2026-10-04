import type { VisualizationMode } from './sculptureBuilder';

/**
 * 音频分析模块单次拉取的快照。
 * 频段与波形取值语义与原实现一致：
 * - frequencyData: 16 个频段能量，归一化到 [0, 1]
 * - waveformData: 时域采样映射到 [0, 1]（0.5 为静音中线）
 */
export interface AudioFrame {
  frequencyData: number[];
  waveformData: number[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  hasAudio: boolean;
}

/** 音频模块对外暴露的输入（控制）与输出（快照）。 */
export interface AudioPort {
  loadAudio(file: File): Promise<void>;
  play(): void;
  pause(): void;
  seek(time: number): void;
  isPlaying(): boolean;
  hasAudio(): boolean;
  getDuration(): number;
  getCurrentTime(): number;
  getFrame(frequencyBands: number, waveformSamples: number): AudioFrame;
}

/** 雕塑动画模块对外暴露的输入（帧数据/模式请求）与输出（状态查询）。 */
export interface SculpturePort {
  update(frame: AudioFrame, delta: number): void;
  requestModeChange(mode: VisualizationMode): boolean;
  getCurrentMode(): VisualizationMode;
  getTargetMode(): VisualizationMode;
  isTransitioning(): boolean;
  rotate(angle: number): void;
}

/** 界面控制模块渲染所需的完整视图状态（单点刷新）。 */
export interface UIViewState {
  hasAudio: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  activeMode: VisualizationMode;
  uploadHintVisible: boolean;
  uploadBusy: boolean;
}

/** 界面控制模块对外暴露的输入。 */
export interface UIPort {
  render(state: UIViewState): void;
  notifyUploadError(error: unknown): void;
}

/** 界面控制模块向外发出的用户意图。 */
export interface UIIntents {
  upload(file: File): Promise<void>;
  togglePlayPause(): void;
  seek(time: number): void;
  changeMode(mode: VisualizationMode): void;
}
