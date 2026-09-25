import {
  AudioVisualizer,
  PLAYLIST,
  THEMES,
  type GestureType,
  type PlaylistItem,
  type ColorTheme
} from './audio-visualizer';

/** 应用全部可变状态的唯一可信来源 */
export interface AppState {
  songIndex: number;
  isPlaying: boolean;
  volume: number;
  themeIndex: number;
  gesture: GestureType;
  gestureReady: boolean;
}

export type StateKey = keyof AppState;
export type StateListener = (state: Readonly<AppState>, changed: ReadonlySet<StateKey>) => void;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 单一状态仓库：所有用户操作（手势、键盘、鼠标）都收敛为这里的 action，
 * 每次 action 只产生一次确定的状态变更，再统一通知渲染层。
 * AudioVisualizer 仅作为被驱动的音频引擎，不再被各模块直接读写。
 */
export class AppStore {
  readonly songs: PlaylistItem[] = PLAYLIST;
  readonly themes: ColorTheme[] = THEMES;

  private state: AppState = {
    songIndex: 0,
    isPlaying: false,
    volume: 0.7,
    themeIndex: 0,
    gesture: 'none',
    gestureReady: false
  };
  private listeners = new Set<StateListener>();

  constructor(private readonly audio: AudioVisualizer) {}

  getState(): Readonly<AppState> {
    return this.state;
  }

  get currentSong(): PlaylistItem {
    return this.songs[this.state.songIndex];
  }

  get currentTheme(): ColorTheme {
    return this.themes[this.state.themeIndex];
  }

  subscribe(listener: StateListener, emitCurrent = true): () => void {
    this.listeners.add(listener);
    if (emitCurrent) {
      listener(this.state, new Set(Object.keys(this.state) as StateKey[]));
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(patch: Partial<AppState>): void {
    const changed = new Set<StateKey>();
    for (const key of Object.keys(patch) as StateKey[]) {
      const value = patch[key];
      if (value !== undefined && !Object.is(value, this.state[key])) {
        (this.state as Record<StateKey, unknown>)[key] = value;
        changed.add(key);
      }
    }
    if (changed.size === 0) return;
    for (const listener of this.listeners) {
      listener(this.state, changed);
    }
  }

  // ---- 播放 / 切歌 ----

  loadSong(index: number, autoplay: boolean): void {
    const len = this.songs.length;
    const songIndex = ((index % len) + len) % len;
    this.audio.loadSong(this.songs[songIndex]);
    if (autoplay) {
      this.audio.play();
      this.commit({ songIndex, isPlaying: true });
    } else {
      this.commit({ songIndex });
    }
  }

  togglePlay(): void {
    if (this.state.isPlaying) {
      this.audio.pause();
      this.commit({ isPlaying: false });
    } else {
      this.audio.play();
      this.commit({ isPlaying: true });
    }
  }

  nextSong(): void {
    this.loadSong(this.state.songIndex + 1, true);
  }

  /** 音频引擎检测到自然播放结束时回调：引擎已自行暂停，这里收敛状态并切歌 */
  onSongEnded(): void {
    this.nextSong();
  }

  seek(time: number): void {
    this.audio.seek(time);
  }

  // ---- 音量 ----

  adjustVolume(delta: number): void {
    this.setVolume(this.state.volume + delta);
  }

  setVolume(v: number): void {
    const volume = clamp01(v);
    this.audio.setVolume(volume);
    this.commit({ volume });
  }

  toggleMute(): void {
    this.setVolume(this.state.volume > 0.01 ? 0 : 0.7);
  }

  // ---- 主题 ----

  setTheme(index: number): void {
    if (index < 0 || index >= this.themes.length) return;
    this.commit({ themeIndex: index });
  }

  // ---- 手势 ----

  setGesture(gesture: GestureType): void {
    this.commit({ gesture });
  }

  setGestureReady(ready: boolean): void {
    this.commit({ gestureReady: ready });
  }
}
