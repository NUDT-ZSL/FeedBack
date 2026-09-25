import {
  DifficultyConfig,
  GameSnapshot,
  HistoryEntry,
  MemoryEngine,
} from './engine';

/** Abstract clock/timers so the session is testable outside the browser. */
export interface Scheduler {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
};

export interface SessionEvents {
  /** Full board re-render (initial deal, reset, undo, redo). */
  onBoard(snapshot: GameSnapshot, config: DifficultyConfig): void;
  onFlip(cardId: number): void;
  onUnflip(cardIds: number[]): void;
  onMatched(cardIds: number[]): void;
  onMismatch(cardIds: number[]): void;
  onStats(snapshot: GameSnapshot): void;
  onTick(elapsedMs: number): void;
  onSettled(finalElapsedMs: number, finalMoves: number): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
}

export const MISMATCH_DELAY_MS = 1000;
export const SETTLE_DELAY_MS = 600;
export const TIMER_INTERVAL_MS = 100;

/**
 * DOM-free orchestration around MemoryEngine: serializes card clicks
 * through a queue (clicks arriving during mismatch feedback are kept in
 * order, never dropped), owns all timers behind an epoch guard, and
 * funnels difficulty switch / restart / modal close through a single
 * reset path that restores one identical initial snapshot.
 */
export class GameSession {
  private engine: MemoryEngine;
  private readonly scheduler: Scheduler;
  private readonly events: SessionEvents;
  private readonly seedFactory: () => number;

  private clickQueue: number[] = [];
  private resolving = false;
  private mismatchHandle: unknown = null;
  private settleHandle: unknown = null;
  private timerHandle: unknown = null;
  private epoch = 0;

  constructor(
    config: DifficultyConfig,
    events: SessionEvents,
    scheduler: Scheduler = browserScheduler,
    seedFactory: () => number = () => Math.floor(Math.random() * 4294967296)
  ) {
    this.events = events;
    this.scheduler = scheduler;
    this.seedFactory = seedFactory;
    this.engine = new MemoryEngine(config, this.seedFactory());
  }

  get snapshot(): GameSnapshot {
    return this.engine.snapshot();
  }

  get config(): DifficultyConfig {
    return this.engine.config;
  }

  get history(): readonly HistoryEntry[] {
    return this.engine.history;
  }

  get queuedClicks(): readonly number[] {
    return this.clickQueue;
  }

  /** Emit the initial board. */
  start(): void {
    this.emitBoard();
  }

  clickCard(cardId: number): void {
    if (this.engine.snapshot().settled) return;
    if (this.resolving) {
      // Not dropped: processed in click order once resolution finishes.
      this.clickQueue.push(cardId);
      return;
    }
    this.processClick(cardId);
  }

  undo(): void {
    this.stepThroughHistory('undo');
  }

  redo(): void {
    this.stepThroughHistory('redo');
  }

  /** Restart with the same difficulty; used by restart and modal close. */
  reset(seed?: number): void {
    this.resetWith(new MemoryEngine(this.engine.config, seed ?? this.seedFactory()));
  }

  setDifficulty(config: DifficultyConfig, seed?: number): void {
    this.resetWith(new MemoryEngine(config, seed ?? this.seedFactory()));
  }

  private resetWith(engine: MemoryEngine): void {
    this.epoch++; // invalidate every pending timeout from the old game
    this.cancelMismatchResolution();
    this.cancelSettle();
    this.clickQueue = [];
    this.engine = engine;
    this.emitBoard();
  }

  private processClick(cardId: number): void {
    const result = this.engine.flip(cardId, this.scheduler.now());
    switch (result.kind) {
      case 'ignored':
        return;
      case 'flipped':
        this.events.onFlip(result.cardId);
        this.afterAction();
        break;
      case 'matched':
        this.events.onFlip(result.cardIds[1]);
        this.events.onMatched(result.cardIds);
        this.afterAction();
        if (result.won) this.scheduleSettle();
        break;
      case 'mismatch':
        this.events.onFlip(result.cardIds[1]);
        this.events.onMismatch(result.cardIds);
        this.afterAction();
        this.beginMismatchResolution();
        break;
    }
  }

  private afterAction(): void {
    this.syncTimer();
    const snap = this.engine.snapshot();
    this.events.onStats(snap);
    this.events.onHistoryChange(this.engine.canUndo(), this.engine.canRedo());
  }

  private emitBoard(): void {
    this.syncTimer();
    const snap = this.engine.snapshot();
    this.events.onBoard(snap, this.engine.config);
    this.events.onStats(snap);
    this.events.onTick(snap.elapsedMs);
    this.events.onHistoryChange(this.engine.canUndo(), this.engine.canRedo());
  }

  private stepThroughHistory(direction: 'undo' | 'redo'): void {
    // The timeline is about to change: drop the pending mismatch
    // resolution and any clicks queued behind it.
    this.cancelMismatchResolution();
    this.clickQueue = [];
    const now = this.scheduler.now();
    const moved =
      direction === 'undo' ? this.engine.undo(now) : this.engine.redo(now);
    if (moved) this.emitBoard();
  }

  private beginMismatchResolution(): void {
    this.resolving = true;
    const epoch = this.epoch;
    this.mismatchHandle = this.scheduler.setTimeout(() => {
      this.mismatchHandle = null;
      if (epoch !== this.epoch) return; // stale callback from an old game
      this.resolving = false;
      const unflipped = this.engine.resolveMismatch(this.scheduler.now());
      if (unflipped.length > 0) this.events.onUnflip(unflipped);
      this.afterAction();
      this.drainQueue();
    }, MISMATCH_DELAY_MS);
  }

  private cancelMismatchResolution(): void {
    if (this.mismatchHandle !== null) {
      this.scheduler.clearTimeout(this.mismatchHandle);
      this.mismatchHandle = null;
    }
    this.resolving = false;
  }

  private drainQueue(): void {
    while (this.clickQueue.length > 0 && !this.resolving) {
      if (this.engine.snapshot().settled) {
        this.clickQueue = [];
        return;
      }
      const next = this.clickQueue.shift()!;
      this.processClick(next);
    }
  }

  private scheduleSettle(): void {
    const epoch = this.epoch;
    const snap = this.engine.snapshot();
    const finalElapsedMs = snap.finalElapsedMs ?? snap.elapsedMs;
    const finalMoves = snap.finalMoves ?? snap.moves;
    this.settleHandle = this.scheduler.setTimeout(() => {
      this.settleHandle = null;
      if (epoch !== this.epoch) return; // game was reset before the modal showed
      this.events.onSettled(finalElapsedMs, finalMoves);
    }, SETTLE_DELAY_MS);
  }

  private cancelSettle(): void {
    if (this.settleHandle !== null) {
      this.scheduler.clearTimeout(this.settleHandle);
      this.settleHandle = null;
    }
  }

  private syncTimer(): void {
    const running = this.engine.snapshot().timerRunning;
    if (running && this.timerHandle === null) {
      this.timerHandle = this.scheduler.setInterval(() => {
        this.events.onTick(this.engine.tick(this.scheduler.now()));
      }, TIMER_INTERVAL_MS);
    } else if (!running && this.timerHandle !== null) {
      this.scheduler.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
