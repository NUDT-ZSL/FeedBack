"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameSession = exports.TIMER_INTERVAL_MS = exports.SETTLE_DELAY_MS = exports.MISMATCH_DELAY_MS = exports.browserScheduler = void 0;
const engine_1 = require("./engine");
exports.browserScheduler = {
    now: () => performance.now(),
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (handle) => window.clearInterval(handle),
};
exports.MISMATCH_DELAY_MS = 1000;
exports.SETTLE_DELAY_MS = 600;
exports.TIMER_INTERVAL_MS = 100;
/**
 * DOM-free orchestration around MemoryEngine: serializes card clicks
 * through a queue (clicks arriving during mismatch feedback are kept in
 * order, never dropped), owns all timers behind an epoch guard, and
 * funnels difficulty switch / restart / modal close through a single
 * reset path that restores one identical initial snapshot.
 */
class GameSession {
    constructor(config, events, scheduler = exports.browserScheduler, seedFactory = () => Math.floor(Math.random() * 4294967296)) {
        this.clickQueue = [];
        this.resolving = false;
        this.mismatchHandle = null;
        this.settleHandle = null;
        this.timerHandle = null;
        this.epoch = 0;
        this.events = events;
        this.scheduler = scheduler;
        this.seedFactory = seedFactory;
        this.engine = new engine_1.MemoryEngine(config, this.seedFactory());
    }
    get snapshot() {
        return this.engine.snapshot();
    }
    get config() {
        return this.engine.config;
    }
    get history() {
        return this.engine.history;
    }
    get queuedClicks() {
        return this.clickQueue;
    }
    /** Emit the initial board. */
    start() {
        this.emitBoard();
    }
    clickCard(cardId) {
        if (this.engine.snapshot().settled)
            return;
        if (this.resolving) {
            // Not dropped: processed in click order once resolution finishes.
            this.clickQueue.push(cardId);
            return;
        }
        this.processClick(cardId);
    }
    undo() {
        this.stepThroughHistory('undo');
    }
    redo() {
        this.stepThroughHistory('redo');
    }
    /** Restart with the same difficulty; used by restart and modal close. */
    reset(seed) {
        this.resetWith(new engine_1.MemoryEngine(this.engine.config, seed ?? this.seedFactory()));
    }
    setDifficulty(config, seed) {
        this.resetWith(new engine_1.MemoryEngine(config, seed ?? this.seedFactory()));
    }
    resetWith(engine) {
        this.epoch++; // invalidate every pending timeout from the old game
        this.cancelMismatchResolution();
        this.cancelSettle();
        this.clickQueue = [];
        this.engine = engine;
        this.emitBoard();
    }
    processClick(cardId) {
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
                if (result.won)
                    this.scheduleSettle();
                break;
            case 'mismatch':
                this.events.onFlip(result.cardIds[1]);
                this.events.onMismatch(result.cardIds);
                this.afterAction();
                this.beginMismatchResolution();
                break;
        }
    }
    afterAction() {
        this.syncTimer();
        const snap = this.engine.snapshot();
        this.events.onStats(snap);
        this.events.onHistoryChange(this.engine.canUndo(), this.engine.canRedo());
    }
    emitBoard() {
        this.syncTimer();
        const snap = this.engine.snapshot();
        this.events.onBoard(snap, this.engine.config);
        this.events.onStats(snap);
        this.events.onTick(snap.elapsedMs);
        this.events.onHistoryChange(this.engine.canUndo(), this.engine.canRedo());
    }
    stepThroughHistory(direction) {
        // The timeline is about to change: drop the pending mismatch
        // resolution and any clicks queued behind it.
        this.cancelMismatchResolution();
        this.clickQueue = [];
        const now = this.scheduler.now();
        const moved = direction === 'undo' ? this.engine.undo(now) : this.engine.redo(now);
        if (moved)
            this.emitBoard();
    }
    beginMismatchResolution() {
        this.resolving = true;
        const epoch = this.epoch;
        this.mismatchHandle = this.scheduler.setTimeout(() => {
            this.mismatchHandle = null;
            if (epoch !== this.epoch)
                return; // stale callback from an old game
            this.resolving = false;
            const unflipped = this.engine.resolveMismatch(this.scheduler.now());
            if (unflipped.length > 0)
                this.events.onUnflip(unflipped);
            this.afterAction();
            this.drainQueue();
        }, exports.MISMATCH_DELAY_MS);
    }
    cancelMismatchResolution() {
        if (this.mismatchHandle !== null) {
            this.scheduler.clearTimeout(this.mismatchHandle);
            this.mismatchHandle = null;
        }
        this.resolving = false;
    }
    drainQueue() {
        while (this.clickQueue.length > 0 && !this.resolving) {
            if (this.engine.snapshot().settled) {
                this.clickQueue = [];
                return;
            }
            const next = this.clickQueue.shift();
            this.processClick(next);
        }
    }
    scheduleSettle() {
        const epoch = this.epoch;
        const snap = this.engine.snapshot();
        const finalElapsedMs = snap.finalElapsedMs ?? snap.elapsedMs;
        const finalMoves = snap.finalMoves ?? snap.moves;
        this.settleHandle = this.scheduler.setTimeout(() => {
            this.settleHandle = null;
            if (epoch !== this.epoch)
                return; // game was reset before the modal showed
            this.events.onSettled(finalElapsedMs, finalMoves);
        }, exports.SETTLE_DELAY_MS);
    }
    cancelSettle() {
        if (this.settleHandle !== null) {
            this.scheduler.clearTimeout(this.settleHandle);
            this.settleHandle = null;
        }
    }
    syncTimer() {
        const running = this.engine.snapshot().timerRunning;
        if (running && this.timerHandle === null) {
            this.timerHandle = this.scheduler.setInterval(() => {
                this.events.onTick(this.engine.tick(this.scheduler.now()));
            }, exports.TIMER_INTERVAL_MS);
        }
        else if (!running && this.timerHandle !== null) {
            this.scheduler.clearInterval(this.timerHandle);
            this.timerHandle = null;
        }
    }
}
exports.GameSession = GameSession;
