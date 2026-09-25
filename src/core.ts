// 纯状态核心：不依赖 DOM。
// 负责翻牌判定、点击队列、计时、可撤销/可回放的对局记录。
// 所有时间相关行为都通过注入的 Scheduler 完成，测试可用假时钟精确复现。

export interface CardState {
  id: number;
  symbol: string;
  isFlipped: boolean;
  isMatched: boolean;
}

export interface CoreConfig {
  pairs: number;
  mismatchDelayMs: number;
}

export interface StatsSnapshot {
  moves: number;
  matchedPairs: number;
  elapsedMs: number;
  isGameStarted: boolean;
  isGameOver: boolean;
}

export type GameActionKind = 'flip' | 'match' | 'unflip';

export interface GameAction {
  kind: GameActionKind;
  cardIds: number[];
  before: StatsSnapshot;
  after: StatsSnapshot;
}

// 追加式对局记录：条目一旦写入永不修改、永不删除。
export type LogEntry =
  | { type: 'action'; action: GameAction }
  | { type: 'undo'; target: number }
  | { type: 'redo'; target: number };

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CoreEvents {
  onCardFlip(cardId: number, faceUp: boolean): void;
  onCardMatched(cardId: number): void;
  onCardWrong(cardId: number, wrong: boolean): void;
  onBoardSync(cards: CardState[]): void;
  onStats(moves: number, matchedPairs: number, totalPairs: number): void;
  onTimer(elapsedMs: number): void;
  onGameOver(elapsedMs: number, moves: number): void;
  onGameContinued(): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  onReset(cards: CardState[]): void;
}

export interface CoreStateView {
  cards: CardState[];
  flippedIds: number[];
  moves: number;
  matchedPairs: number;
  elapsedMs: number;
  isGameStarted: boolean;
  isGameOver: boolean;
  isProcessing: boolean;
  queuedClicks: number;
  canUndo: boolean;
  canRedo: boolean;
  logLength: number;
  timelineLength: number;
}

const TIMER_TICK_MS = 100;

const INITIAL_STATS: StatsSnapshot = {
  moves: 0,
  matchedPairs: 0,
  elapsedMs: 0,
  isGameStarted: false,
  isGameOver: false,
};

export class GameCore {
  private config: CoreConfig;
  private cards: CardState[];
  private initialLayout: Array<{ id: number; symbol: string }>;
  private readonly scheduler: Scheduler;
  private readonly events: CoreEvents;

  private flippedIds: number[] = [];
  private moves = 0;
  private matchedPairs = 0;
  private elapsedMs = 0;
  private isGameStarted = false;
  private isGameOver = false;
  private isProcessing = false;

  private clickQueue: number[] = [];
  private readonly log: LogEntry[] = [];
  private timeline: number[] = [];
  private redoStack: number[] = [];

  private epoch = 0;
  private timerHandle: unknown = null;
  private startTimestamp = 0;
  private readonly pendingTimeouts = new Set<unknown>();

  constructor(
    config: CoreConfig,
    cards: CardState[],
    scheduler: Scheduler,
    events: CoreEvents
  ) {
    this.config = { ...config };
    this.cards = cards;
    this.initialLayout = cards.map((c) => ({ id: c.id, symbol: c.symbol }));
    this.scheduler = scheduler;
    this.events = events;
  }

  getState(): CoreStateView {
    return {
      cards: this.cards,
      flippedIds: [...this.flippedIds],
      moves: this.moves,
      matchedPairs: this.matchedPairs,
      elapsedMs: this.currentElapsedMs(),
      isGameStarted: this.isGameStarted,
      isGameOver: this.isGameOver,
      isProcessing: this.isProcessing,
      queuedClicks: this.clickQueue.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      logLength: this.log.length,
      timelineLength: this.timeline.length,
    };
  }

  getLog(): readonly LogEntry[] {
    return this.log;
  }

  getInitialLayout(): Array<{ id: number; symbol: string }> {
    return this.initialLayout.map((c) => ({ ...c }));
  }

  // ---- 点击入口 ----

  clickCard(cardId: number): void {
    if (this.isGameOver) return;
    const card = this.cardById(cardId);
    if (!card || card.isMatched) return;
    if (this.isProcessing) {
      // 判定反馈期间的新点击进入队列，判定结束后按顺序处理。
      this.clickQueue.push(cardId);
      return;
    }
    this.settleDanglingPair();
    if (card.isFlipped) return;
    this.performFlip(card);
  }

  undo(): boolean {
    if (this.isProcessing) return false;
    const index = this.timeline.pop();
    if (index === undefined) return false;
    const entry = this.log[index];
    if (!entry || entry.type !== 'action') {
      this.timeline.push(index);
      return false;
    }
    const action = entry.action;
    this.applyActionToBoard(action, false);
    this.flippedIds = this.computeFlippedIds();
    this.redoStack.push(index);
    this.log.push({ type: 'undo', target: index });
    this.restoreSnapshot(action.before);
    this.events.onBoardSync(this.cards);
    this.emitHistory();
    return true;
  }

  redo(): boolean {
    if (this.isProcessing) return false;
    const index = this.redoStack.pop();
    if (index === undefined) return false;
    const entry = this.log[index];
    if (!entry || entry.type !== 'action') return false;
    const action = entry.action;
    this.applyActionToBoard(action, true);
    this.flippedIds = this.computeFlippedIds();
    this.timeline.push(index);
    this.log.push({ type: 'redo', target: index });
    this.restoreSnapshot(action.after);
    this.events.onBoardSync(this.cards);
    this.emitHistory();
    return true;
  }

  // 难度切换 / 重新开始 / 弹窗关闭共用的统一重置入口：
  // 清空计时、匹配数、操作数、翻开集合、点击队列、待触发回调与对局记录。
  reset(cards: CardState[], config?: CoreConfig): void {
    this.epoch++;
    for (const handle of this.pendingTimeouts) {
      this.scheduler.clearTimeout(handle);
    }
    this.pendingTimeouts.clear();
    this.stopTimer();
    if (config) this.config = { ...config };
    this.cards = cards;
    this.initialLayout = cards.map((c) => ({ id: c.id, symbol: c.symbol }));
    this.flippedIds = [];
    this.moves = 0;
    this.matchedPairs = 0;
    this.elapsedMs = 0;
    this.isGameStarted = false;
    this.isGameOver = false;
    this.isProcessing = false;
    this.clickQueue = [];
    this.log.length = 0;
    this.timeline = [];
    this.redoStack = [];
    this.events.onReset(this.cards);
    this.events.onTimer(0);
    this.emitStats();
    this.emitHistory();
  }

  // ---- 内部：翻牌与判定 ----

  private performFlip(card: CardState): void {
    this.recordAction('flip', [card.id], () => {
      if (!this.isGameStarted) this.beginTimer();
      card.isFlipped = true;
      this.flippedIds.push(card.id);
      this.moves++;
    });
    this.events.onCardFlip(card.id, true);
    this.emitStats();
    if (this.flippedIds.length === 2) {
      this.judge();
    }
  }

  private judge(): void {
    this.isProcessing = true;
    this.emitHistory();
    const firstId = this.flippedIds[0];
    const secondId = this.flippedIds[1];
    const first = this.cardById(firstId);
    const second = this.cardById(secondId);
    if (!first || !second) {
      this.isProcessing = false;
      this.emitHistory();
      return;
    }

    if (first.symbol === second.symbol) {
      const completesGame = this.matchedPairs + 1 === this.config.pairs;
      this.recordAction('match', [firstId, secondId], () => {
        first.isMatched = true;
        second.isMatched = true;
        this.matchedPairs++;
        this.flippedIds = [];
        if (completesGame) this.freezeGameOver();
      });
      this.events.onCardMatched(firstId);
      this.events.onCardMatched(secondId);
      this.isProcessing = false;
      this.emitStats();
      this.emitHistory();
      if (this.isGameOver) {
        this.events.onTimer(this.elapsedMs);
        this.events.onGameOver(this.elapsedMs, this.moves);
        return;
      }
      this.drainQueue();
      return;
    }

    this.events.onCardWrong(firstId, true);
    this.events.onCardWrong(secondId, true);
    const epoch = this.epoch;
    const handle = this.scheduler.setTimeout(() => {
      this.pendingTimeouts.delete(handle);
      if (epoch !== this.epoch) return;
      this.recordAction('unflip', [firstId, secondId], () => {
        first.isFlipped = false;
        second.isFlipped = false;
        this.flippedIds = [];
      });
      this.events.onCardFlip(firstId, false);
      this.events.onCardFlip(secondId, false);
      this.events.onCardWrong(firstId, false);
      this.events.onCardWrong(secondId, false);
      this.isProcessing = false;
      this.emitStats();
      this.emitHistory();
      this.drainQueue();
    }, this.config.mismatchDelayMs);
    this.pendingTimeouts.add(handle);
  }

  private drainQueue(): void {
    while (!this.isProcessing && !this.isGameOver && this.clickQueue.length > 0) {
      const cardId = this.clickQueue.shift();
      if (cardId === undefined) break;
      const card = this.cardById(cardId);
      if (!card || card.isMatched) continue;
      this.settleDanglingPair();
      if (card.isFlipped) continue;
      this.performFlip(card);
    }
  }

  // 撤销可能留下两张已翻未匹配的牌（瞬态）。
  // 下一次点击前先把它们作为一条显式 unflip 动作翻回，保证任意时刻
  // 未匹配翻开牌不超过两张，且该过程同样进入对局记录。
  private settleDanglingPair(): void {
    if (this.flippedIds.length < 2) return;
    const ids = [...this.flippedIds];
    this.recordAction('unflip', ids, () => {
      for (const id of ids) {
        const card = this.cardById(id);
        if (card) card.isFlipped = false;
      }
      this.flippedIds = [];
    });
    for (const id of ids) {
      this.events.onCardFlip(id, false);
    }
    this.emitStats();
  }

  // ---- 内部：对局记录 ----

  private recordAction(
    kind: GameActionKind,
    cardIds: number[],
    mutate: () => void
  ): void {
    const before = this.snapshot();
    mutate();
    const after = this.snapshot();
    const action: GameAction = { kind, cardIds: [...cardIds], before, after };
    this.log.push({ type: 'action', action });
    this.timeline.push(this.log.length - 1);
    // 新动作接在回退点之后：清空可重做栈，但不清空原始记录。
    this.redoStack = [];
    this.emitHistory();
  }

  private applyActionToBoard(action: GameAction, forward: boolean): void {
    for (const id of action.cardIds) {
      const card = this.cardById(id);
      if (!card) continue;
      if (action.kind === 'flip') {
        card.isFlipped = forward;
      } else if (action.kind === 'match') {
        card.isMatched = forward;
        if (!forward) card.isFlipped = true;
      } else {
        card.isFlipped = !forward;
      }
    }
  }

  private computeFlippedIds(): number[] {
    return this.cards
      .filter((c) => c.isFlipped && !c.isMatched)
      .map((c) => c.id);
  }

  private snapshot(): StatsSnapshot {
    return {
      moves: this.moves,
      matchedPairs: this.matchedPairs,
      elapsedMs: this.currentElapsedMs(),
      isGameStarted: this.isGameStarted,
      isGameOver: this.isGameOver,
    };
  }

  private restoreSnapshot(s: StatsSnapshot): void {
    const wasGameOver = this.isGameOver;
    this.moves = s.moves;
    this.matchedPairs = s.matchedPairs;
    this.elapsedMs = s.elapsedMs;
    this.isGameStarted = s.isGameStarted;
    this.isGameOver = s.isGameOver;
    this.syncTimerWithState();
    this.events.onTimer(this.elapsedMs);
    this.emitStats();
    if (wasGameOver && !this.isGameOver) this.events.onGameContinued();
    if (!wasGameOver && this.isGameOver) {
      this.events.onGameOver(this.elapsedMs, this.moves);
    }
  }

  // ---- 内部：计时 ----

  private currentElapsedMs(): number {
    if (this.isGameStarted && !this.isGameOver && this.timerHandle !== null) {
      return this.scheduler.now() - this.startTimestamp;
    }
    return this.elapsedMs;
  }

  private beginTimer(): void {
    this.isGameStarted = true;
    this.elapsedMs = 0;
    this.startTimestamp = this.scheduler.now();
    if (this.timerHandle === null) {
      this.timerHandle = this.scheduler.setInterval(
        () => this.tick(),
        TIMER_TICK_MS
      );
    }
  }

  private tick(): void {
    this.elapsedMs = this.scheduler.now() - this.startTimestamp;
    this.events.onTimer(this.elapsedMs);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) {
      this.scheduler.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private syncTimerWithState(): void {
    if (this.isGameStarted && !this.isGameOver) {
      this.startTimestamp = this.scheduler.now() - this.elapsedMs;
      if (this.timerHandle === null) {
        this.timerHandle = this.scheduler.setInterval(
          () => this.tick(),
          TIMER_TICK_MS
        );
      }
    } else {
      this.stopTimer();
    }
  }

  private freezeGameOver(): void {
    this.isGameOver = true;
    this.elapsedMs = this.currentElapsedMs();
    this.stopTimer();
  }

  // ---- 内部：工具 ----

  private cardById(cardId: number): CardState | undefined {
    return this.cards.find((c) => c.id === cardId);
  }

  private canUndo(): boolean {
    return this.timeline.length > 0 && !this.isProcessing;
  }

  private canRedo(): boolean {
    return this.redoStack.length > 0 && !this.isProcessing;
  }

  private emitStats(): void {
    this.events.onStats(this.moves, this.matchedPairs, this.config.pairs);
  }

  private emitHistory(): void {
    this.events.onHistoryChange(this.canUndo(), this.canRedo());
  }
}

export interface ReplayResult {
  cards: CardState[];
  stats: StatsSnapshot;
  flippedIds: number[];
  timelineLength: number;
}

// 从初始布局与对局记录重建任意历史位置的状态，用于回放与一致性校验。
export function replayLog(
  layout: Array<{ id: number; symbol: string }>,
  log: readonly LogEntry[],
  upTo: number = log.length
): ReplayResult {
  const cards: CardState[] = layout.map((c) => ({
    id: c.id,
    symbol: c.symbol,
    isFlipped: false,
    isMatched: false,
  }));
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  const timeline: number[] = [];
  let stats: StatsSnapshot = { ...INITIAL_STATS };

  const apply = (action: GameAction, forward: boolean): void => {
    for (const id of action.cardIds) {
      const card = byId.get(id);
      if (!card) continue;
      if (action.kind === 'flip') {
        card.isFlipped = forward;
      } else if (action.kind === 'match') {
        card.isMatched = forward;
        if (!forward) card.isFlipped = true;
      } else {
        card.isFlipped = !forward;
      }
    }
  };

  const limit = Math.min(upTo, log.length);
  for (let i = 0; i < limit; i++) {
    const entry = log[i];
    if (entry.type === 'action') {
      apply(entry.action, true);
      timeline.push(i);
      stats = { ...entry.action.after };
    } else if (entry.type === 'undo') {
      const index = timeline.pop();
      if (index === undefined) continue;
      const target = log[index];
      if (target && target.type === 'action') {
        apply(target.action, false);
        stats = { ...target.action.before };
      }
    } else {
      const target = log[entry.target];
      if (target && target.type === 'action') {
        apply(target.action, true);
        timeline.push(entry.target);
        stats = { ...target.action.after };
      }
    }
  }

  const flippedIds = cards
    .filter((c) => c.isFlipped && !c.isMatched)
    .map((c) => c.id);
  return { cards, stats, flippedIds, timelineLength: timeline.length };
}
