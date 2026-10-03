export interface Selection {
  start: number;
  end: number;
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  isLooping: boolean;
  position: number;
  selection: Selection | null;
  duration: number;
}

export type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

const POSITION_EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * 播放状态的唯一可信来源（single source of truth）。
 *
 * 暂停位置、选区起止、循环开关、当前时间全部收敛在这里维护，
 * 不依赖 Web Audio / DOM，可离线测试。AudioEngine 只负责把状态
 * 变化翻译成音频图操作，UI 只负责镜像快照。
 *
 * 不变量（任意操作序列下都成立）：
 * - 0 <= position <= duration
 * - 选区存在时：0 <= selection.start < selection.end <= duration，
 *   且 position 始终落在 [selection.start, selection.end] 内
 * - stop / 自然结束（非循环）/ 重新加载后：position = 0 且选区清空
 * - 切换循环只影响 isLooping，不影响其它任何字段
 */
export class PlaybackState {
  private isPlaying = false;
  private isLooping = false;
  private selection: Selection | null = null;
  private duration = 0;
  private basePosition = 0;
  private startedAt = 0;
  private readonly clock: () => number;
  private readonly listeners = new Set<PlaybackListener>();

  constructor(clock: () => number = () => 0) {
    this.clock = clock;
  }

  public subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): PlaybackSnapshot {
    return {
      isPlaying: this.isPlaying,
      isLooping: this.isLooping,
      position: this.currentPosition(),
      selection: this.selection ? { ...this.selection } : null,
      duration: this.duration
    };
  }

  public getEffectiveStart(): number {
    return this.selection ? this.selection.start : 0;
  }

  public getEffectiveEnd(): number {
    return this.selection ? this.selection.end : this.duration;
  }

  public load(duration: number): PlaybackSnapshot {
    this.duration = Math.max(0, duration);
    this.isPlaying = false;
    this.selection = null;
    this.basePosition = 0;
    this.startedAt = this.clock();
    return this.emit();
  }

  public play(): PlaybackSnapshot {
    if (this.isPlaying || this.duration <= 0) {
      return this.getSnapshot();
    }
    if (this.currentPosition() >= this.getEffectiveEnd() - POSITION_EPSILON) {
      this.basePosition = this.getEffectiveStart();
    }
    this.isPlaying = true;
    this.startedAt = this.clock();
    return this.emit();
  }

  public pause(): PlaybackSnapshot {
    if (!this.isPlaying) {
      return this.getSnapshot();
    }
    this.basePosition = this.currentPosition();
    this.isPlaying = false;
    return this.emit();
  }

  public stop(): PlaybackSnapshot {
    this.isPlaying = false;
    this.selection = null;
    this.basePosition = 0;
    this.startedAt = this.clock();
    return this.emit();
  }

  public seek(time: number): PlaybackSnapshot {
    this.setPosition(time);
    return this.emit();
  }

  public setSelection(selection: Selection | null): PlaybackSnapshot {
    this.selection = this.normalizeSelection(selection);
    if (this.selection) {
      this.setPosition(
        clamp(this.currentPosition(), this.selection.start, this.selection.end)
      );
    }
    return this.emit();
  }

  public toggleLoop(): PlaybackSnapshot {
    this.isLooping = !this.isLooping;
    return this.emit();
  }

  public handleEnded(): PlaybackSnapshot {
    if (!this.isPlaying) {
      return this.getSnapshot();
    }
    if (this.isLooping) {
      this.setPosition(this.getEffectiveStart());
    } else {
      this.isPlaying = false;
      this.selection = null;
      this.basePosition = 0;
      this.startedAt = this.clock();
    }
    return this.emit();
  }

  private currentPosition(): number {
    const elapsed = this.isPlaying ? this.clock() - this.startedAt : 0;
    return clamp(this.basePosition + elapsed, 0, this.getEffectiveEnd());
  }

  private setPosition(time: number): void {
    this.basePosition = clamp(time, this.getEffectiveStart(), this.getEffectiveEnd());
    this.startedAt = this.clock();
  }

  private normalizeSelection(selection: Selection | null): Selection | null {
    if (!selection || this.duration <= 0) {
      return null;
    }
    const start = clamp(selection.start, 0, this.duration);
    const end = clamp(selection.end, 0, this.duration);
    if (end - start <= 0) {
      return null;
    }
    return { start, end };
  }

  private emit(): PlaybackSnapshot {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => listener(snapshot));
    return snapshot;
  }
}
