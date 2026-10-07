import type { BellNote, DanceAction, RecordingEvent, ShowState } from '../types';
import { danceActionForNote } from './constants';

export interface PlaybackSink {
  playNote(note: BellNote): void;
  onDance?(action: DanceAction): void;
  onFinish?(): void;
}

export interface PlaybackClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultClock: PlaybackClock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * 回放控制器：任意时刻只允许一个场次的序列在回放。
 * start() 会先中断上一场；切换场次时调用 interrupt() 安全终止，
 * 已排程的旧场次定时器即使晚触发也会被 showId 守卫丢弃，不会混入新场次。
 */
export class PlaybackController {
  private handles: unknown[] = [];
  private activeShowId: string | null = null;
  private token = 0;

  constructor(private clock: PlaybackClock = defaultClock) {}

  get playingShowId(): string | null {
    return this.activeShowId;
  }

  isPlaying(): boolean {
    return this.activeShowId !== null;
  }

  /** 只回放属于该场次的录音事件（按事件自带 showId 过滤，双保险） */
  start(show: ShowState, sink: PlaybackSink): void {
    this.interrupt();
    const myToken = ++this.token;
    this.activeShowId = show.id;

    const events: RecordingEvent[] = show.recording.events.filter(
      (ev) => ev.showId === show.id,
    );
    for (const ev of events) {
      const handle = this.clock.setTimeout(() => {
        if (this.token !== myToken || this.activeShowId !== show.id) return;
        sink.playNote(ev.note);
        sink.onDance?.(danceActionForNote(ev.note));
      }, ev.timestamp);
      this.handles.push(handle);
    }

    const endHandle = this.clock.setTimeout(() => {
      if (this.token !== myToken) return;
      this.interrupt();
      sink.onFinish?.();
    }, Math.max(show.duration, ...events.map((e) => e.timestamp), 0) + 1);
    this.handles.push(endHandle);
  }

  /** 中断当前回放（切换/删除场次前必须调用） */
  interrupt(): void {
    this.token += 1;
    for (const h of this.handles) this.clock.clearTimeout(h);
    this.handles = [];
    this.activeShowId = null;
  }
}
