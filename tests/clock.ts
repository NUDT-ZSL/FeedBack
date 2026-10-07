import type { PlaybackClock } from '../src/state/playback';
import type { BellNote, DanceAction } from '../src/types';

export interface FakeClock extends PlaybackClock {
  advance(ms: number): void;
  pendingCount(): number;
  set(ms: number): void;
}

export function makeFakeClock(start = 0): FakeClock {
  let t = start;
  let seq = 0;
  const pending = new Map<number, { cb: () => void; at: number }>();
  return {
    now: () => t,
    set(ms: number) {
      t = ms;
    },
    setTimeout(cb, ms) {
      const id = ++seq;
      pending.set(id, { cb, at: t + ms });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
    advance(ms: number) {
      t += ms;
      const due = [...pending.entries()].filter(([, e]) => e.at <= t);
      for (const [id] of due) pending.delete(id);
      for (const [, e] of due) e.cb();
    },
    pendingCount: () => pending.size,
  };
}

export function makeSink(now: () => number) {
  return {
    notes: [] as { note: BellNote; at: number }[],
    dances: [] as DanceAction[],
    finished: 0,
    playNote(note: BellNote) {
      this.notes.push({ note, at: now() });
    },
    onDance(action: DanceAction) {
      this.dances.push(action);
    },
    onFinish() {
      this.finished += 1;
    },
  };
}
