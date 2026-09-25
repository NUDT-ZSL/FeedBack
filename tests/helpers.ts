import { GameCore } from '../src/core.ts';
import type {
  CardState,
  CoreEvents,
  Scheduler,
} from '../src/core.ts';

// 手动推进的假时钟：超时与间隔回调都按时间顺序确定性地触发。
export class FakeScheduler implements Scheduler {
  private currentTime = 0;
  private nextHandle = 1;
  private readonly timeouts = new Map<
    number,
    { fireAt: number; callback: () => void }
  >();
  private readonly intervals = new Map<
    number,
    { ms: number; nextFireAt: number; callback: () => void }
  >();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timeouts.set(handle, { fireAt: this.currentTime + ms, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  setInterval(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.intervals.set(handle, {
      ms,
      nextFireAt: this.currentTime + ms,
      callback,
    });
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  get pendingTimeoutCount(): number {
    return this.timeouts.size;
  }

  get activeIntervalCount(): number {
    return this.intervals.size;
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;
    for (;;) {
      let nextFireAt = Infinity;
      let kind: 'timeout' | 'interval' | null = null;
      let handle = -1;
      for (const [h, t] of this.timeouts) {
        if (t.fireAt < nextFireAt) {
          nextFireAt = t.fireAt;
          kind = 'timeout';
          handle = h;
        }
      }
      for (const [h, i] of this.intervals) {
        if (i.nextFireAt < nextFireAt) {
          nextFireAt = i.nextFireAt;
          kind = 'interval';
          handle = h;
        }
      }
      if (kind === null || nextFireAt > target) break;
      this.currentTime = nextFireAt;
      if (kind === 'timeout') {
        const t = this.timeouts.get(handle);
        this.timeouts.delete(handle);
        if (t) t.callback();
      } else {
        const i = this.intervals.get(handle);
        if (i) {
          i.nextFireAt += i.ms;
          i.callback();
        }
      }
    }
    this.currentTime = target;
  }
}

// 确定性牌堆：id 2p 与 2p+1 为一对。
export function makeDeck(pairs: number): CardState[] {
  const cards: CardState[] = [];
  for (let p = 0; p < pairs; p++) {
    cards.push(
      { id: p * 2, symbol: `sym-${p}`, isFlipped: false, isMatched: false },
      { id: p * 2 + 1, symbol: `sym-${p}`, isFlipped: false, isMatched: false }
    );
  }
  return cards;
}

export interface RecordedCall {
  name: string;
  args: unknown[];
}

export function createEventRecorder(): {
  events: CoreEvents;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  return {
    calls,
    events: {
      onCardFlip: record('onCardFlip'),
      onCardMatched: record('onCardMatched'),
      onCardWrong: record('onCardWrong'),
      onBoardSync: record('onBoardSync'),
      onStats: record('onStats'),
      onTimer: record('onTimer'),
      onGameOver: record('onGameOver'),
      onGameContinued: record('onGameContinued'),
      onHistoryChange: record('onHistoryChange'),
      onReset: record('onReset'),
    },
  };
}

export function makeCore(pairs = 4, mismatchDelayMs = 1000) {
  const scheduler = new FakeScheduler();
  const recorder = createEventRecorder();
  const core = new GameCore(
    { pairs, mismatchDelayMs },
    makeDeck(pairs),
    scheduler,
    recorder.events
  );
  return { core, scheduler, recorder };
}
