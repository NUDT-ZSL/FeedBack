import type { AudioFrame, AudioPort } from '../src/contracts';

/**
 * 脚本化音源：与 AudioAnalyzer 实现同一 AudioPort 接口，
 * 频段/波形数据为当前播放时间的确定性函数，用于离线批量验证。
 * 播放结束行为与真实实现一致（回到 00:00 并停止）。
 */
export class ScriptedAudioSource implements AudioPort {
  private time: number = 0;
  private playing: boolean = false;
  private loaded: boolean = false;
  private readonly trackDuration: number;

  constructor(duration: number = 30) {
    this.trackDuration = duration;
  }

  async loadAudio(_file: File): Promise<void> {
    this.loaded = true;
    this.time = 0;
    this.playing = false;
  }

  play(): void {
    if (!this.loaded || this.playing) return;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.getDuration()));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  hasAudio(): boolean {
    return this.loaded;
  }

  getDuration(): number {
    return this.loaded ? this.trackDuration : 0;
  }

  getCurrentTime(): number {
    return this.time;
  }

  /** 离线时钟推进，等价于真实 AudioContext 的时间流逝。 */
  advance(delta: number): void {
    if (!this.playing) return;
    this.time += delta;
    if (this.time >= this.trackDuration) {
      this.time = 0;
      this.playing = false;
    }
  }

  getFrame(frequencyBands: number, waveformSamples: number): AudioFrame {
    const frequencyData = new Array(frequencyBands).fill(0);
    const waveformData = new Array(waveformSamples).fill(0);

    if (this.loaded) {
      for (let i = 0; i < frequencyBands; i++) {
        frequencyData[i] = 0.5 + 0.5 * Math.sin(this.time * (0.7 + i * 0.13) + i * 1.7);
      }
      for (let i = 0; i < waveformSamples; i++) {
        waveformData[i] = 0.5 + 0.5 * Math.sin(this.time * 2.1 + i * 0.35);
      }
    }

    return {
      frequencyData,
      waveformData,
      isPlaying: this.playing,
      currentTime: this.time,
      duration: this.getDuration(),
      hasAudio: this.loaded
    };
  }
}
