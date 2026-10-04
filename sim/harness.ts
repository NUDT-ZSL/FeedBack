import * as THREE from 'three';
import { AppController } from '../src/appController';
import { SculptureBuilder, SculptureStateSnapshot, VisualizationMode } from '../src/sculptureBuilder';
import { ScriptedAudioSource } from './scriptedAudioSource';
import { HeadlessUI } from './headlessUI';

export const DT = 1 / 60;

/**
 * 离线测试台：组合与生产环境相同的 AppController + SculptureBuilder，
 * 仅将音频源替换为确定性脚本音源、UI 替换为无头记录器。
 */
export class Harness {
  readonly audio = new ScriptedAudioSource(30);
  readonly sculpture = new SculptureBuilder();
  readonly ui = new HeadlessUI();
  readonly controller: AppController;

  constructor() {
    this.sculpture.init(new THREE.Scene());
    this.controller = new AppController(this.audio, this.sculpture, this.ui, {
      frequencyBands: 16,
      waveformSamples: 128
    });
  }

  step(seconds: number): void {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i++) {
      this.audio.advance(DT);
      this.controller.tick(DT);
    }
  }

  async upload(): Promise<void> {
    await this.controller.upload(new File(['sim'], 'sim.wav'));
  }

  togglePlay(): void {
    this.controller.togglePlayPause();
  }

  seekTo(time: number): void {
    this.controller.seek(time);
  }

  switchMode(mode: VisualizationMode): void {
    this.controller.changeMode(mode);
  }

  snapshot(): SculptureStateSnapshot {
    return this.sculpture.getStateSnapshot();
  }
}
