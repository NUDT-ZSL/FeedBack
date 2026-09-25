import type { GestureType } from './audio-visualizer';
import { AppStore } from './app-store';

/** 首次触发音量手势时的步进 */
const FIRST_VOLUME_STEP = 0.04;
/** 持续按住音量手势时的步进与节奏 */
const VOLUME_STEP = 0.035;
const VOLUME_STEP_INTERVAL_MS = 180;

/**
 * 手势动作闸门：手势识别回调可能在一帧内连续触发多次，
 * 这里先缓存最新手势，在渲染帧的起点统一 flush，
 * 保证每帧至多产生一次确定的状态变更；
 * 离散手势（播放/切歌/静音）按边沿触发，同一手势保持期间不会重复触发；
 * 音量手势（3/4 指）为持续型，按固定节奏步进，手势消失即停止。
 */
export class GestureActions {
  private queued: GestureType | null = null;
  private latched: GestureType = 'none';
  private volumeDir: -1 | 0 | 1 = 0;
  private nextVolumeStepAt = 0;

  constructor(private readonly store: AppStore) {}

  /** 识别回调入口：只记录，不直接改状态 */
  enqueue(gesture: GestureType): void {
    this.queued = gesture;
  }

  /** 每帧调用一次：把缓存的手势收敛为一次状态变更 */
  flush(now: number): void {
    const g = this.queued;
    this.queued = null;
    if (g === null) return;
    this.store.setGesture(g);
    if (g === this.latched) return;
    this.latched = g;
    switch (g) {
      case '1-finger':
        this.store.togglePlay();
        break;
      case '2-finger':
        this.store.nextSong();
        break;
      case 'fist':
        this.store.toggleMute();
        break;
      case '3-finger':
        this.store.adjustVolume(FIRST_VOLUME_STEP);
        this.volumeDir = 1;
        this.nextVolumeStepAt = now + VOLUME_STEP_INTERVAL_MS;
        break;
      case '4-finger':
        this.store.adjustVolume(-FIRST_VOLUME_STEP);
        this.volumeDir = -1;
        this.nextVolumeStepAt = now + VOLUME_STEP_INTERVAL_MS;
        break;
      default:
        break;
    }
    if (g !== '3-finger' && g !== '4-finger') {
      this.volumeDir = 0;
    }
  }

  /** 每帧调用一次：持续型音量手势的步进 */
  tick(now: number): void {
    if (this.volumeDir !== 0 && now >= this.nextVolumeStepAt) {
      this.store.adjustVolume(this.volumeDir * VOLUME_STEP);
      this.nextVolumeStepAt = now + VOLUME_STEP_INTERVAL_MS;
    }
  }
}
