import type { GestureType } from './audio-visualizer';

/**
 * 应用全局状态。所有模块（音频、粒子、UI）都从这里读取状态，
 * 状态只能通过 AppStore 的 action 方法修改，每次用户操作对应一次确定的 commit。
 */
export interface AppState {
  /** 当前歌曲在播放列表中的下标 */
  songIndex: number;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 音量 0~1 */
  volume: number;
  /** 当前主题下标 */
  themeIndex: number;
  /** 最近一次确认的手势（供粒子视觉响应使用） */
  gesture: GestureType;
  /** 手势事件序号：每接受一次手势事件自增，用于 UI 图标动画等“按事件”响应 */
  gestureEventId: number;
  /** 摄像头手势识别是否已启用（失败时退回键鼠控制，其余模块不受影响） */
  gestureReady: boolean;
}

export type StateListener = (state: Readonly<AppState>, changed: ReadonlySet<keyof AppState>) => void;

/** 同一手势在该时间窗口内的重复触发只处理第一次 */
const GESTURE_DEBOUNCE_MS = 650;
/** 3/4 指按住期间连续调节音量的间隔 */
const VOLUME_HOLD_INTERVAL_MS = 180;
/** 按住期间每次调节的音量步进 */
const VOLUME_HOLD_STEP = 0.035;
/** 手势触发瞬间的音量步进 */
const VOLUME_TAP_STEP = 0.04;
/** 取消静音时恢复的音量 */
const UNMUTE_VOLUME = 0.7;

export class AppStore {
  private state: AppState = {
    songIndex: 0,
    isPlaying: false,
    volume: 0.7,
    themeIndex: 0,
    gesture: 'none',
    gestureEventId: 0,
    gestureReady: false
  };
  private listeners = new Set<StateListener>();
  private lastGestureType: GestureType = 'none';
  private lastGestureTime = 0;
  private volumeHoldTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly songCount: number) {}

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /**
   * 唯一的状态修改入口：合并补丁、计算变化的字段，
   * 有实际变化时才同步通知所有订阅者（同一次通知内完成全部响应，保证同一帧一致）。
   */
  private commit(patch: Partial<AppState>): void {
    const changed = new Set<keyof AppState>();
    for (const key of Object.keys(patch) as (keyof AppState)[]) {
      if (this.state[key] !== patch[key]) changed.add(key);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    const snapshot = this.state;
    this.listeners.forEach(fn => fn(snapshot, changed));
  }

  // ---------- actions：每个方法对应一次确定的用户操作 ----------

  togglePlay(): void {
    this.commit({ isPlaying: !this.state.isPlaying });
  }

  play(): void {
    this.commit({ isPlaying: true });
  }

  nextSong(): void {
    this.commit({
      songIndex: (this.state.songIndex + 1) % this.songCount,
      isPlaying: true
    });
  }

  changeVolume(delta: number): void {
    const v = Math.max(0, Math.min(1, this.state.volume + delta));
    this.commit({ volume: v });
  }

  toggleMute(): void {
    this.commit({ volume: this.state.volume > 0.01 ? 0 : UNMUTE_VOLUME });
  }

  selectTheme(index: number): void {
    this.commit({ themeIndex: index });
  }

  setGestureReady(ready: boolean): void {
    this.commit({ gestureReady: ready });
  }

  /**
   * 手势事件入口。GestureController 已完成稳定判定（多数投票 + 连续稳定帧），
   * 这里再做事件级去重：同一手势在去抖窗口内的重复触发只保留第一次，
   * 保证一次用户手势只产生一次确定的状态变更。
   */
  applyGesture(g: GestureType): void {
    if (g === 'none') return;
    const now = performance.now();
    if (g === this.lastGestureType && now - this.lastGestureTime < GESTURE_DEBOUNCE_MS) {
      return;
    }
    this.lastGestureType = g;
    this.lastGestureTime = now;
    this.stopVolumeHold();
    switch (g) {
      case '1-finger':
        this.togglePlay();
        break;
      case '2-finger':
        this.nextSong();
        break;
      case 'fist':
        this.toggleMute();
        break;
      case '3-finger':
      case '4-finger': {
        const dir = g === '3-finger' ? 1 : -1;
        this.changeVolume(dir * VOLUME_TAP_STEP);
        this.startVolumeHold(dir);
        break;
      }
    }
    this.commit({ gesture: g, gestureEventId: this.state.gestureEventId + 1 });
  }

  /** 3/4 指按住期间的连续音量调节：由定时器驱动 action，不占用渲染循环 */
  private startVolumeHold(dir: number): void {
    this.volumeHoldTimer = setInterval(() => {
      this.changeVolume(dir * VOLUME_HOLD_STEP);
    }, VOLUME_HOLD_INTERVAL_MS);
  }

  private stopVolumeHold(): void {
    if (this.volumeHoldTimer !== null) {
      clearInterval(this.volumeHoldTimer);
      this.volumeHoldTimer = null;
    }
  }
}
