export interface CardData {
  id: number;
  symbol: string;
  isFlipped: boolean;
  isMatched: boolean;
}

export interface DifficultyConfig {
  rows: number;
  cols: number;
  pairs: number;
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  easy: { rows: 3, cols: 3, pairs: 4 },
  medium: { rows: 4, cols: 4, pairs: 8 },
  hard: { rows: 6, cols: 5, pairs: 15 },
};

const EMOJI_POOL: string[] = [
  '🚀', '🌟', '🌙', '🌈', '🔥', '🍀', '🎵', '⚡',
  '💎', '🎮', '🌸', '🦋', '🍕', '🎨', '🐱', '🎯',
  '🍦', '🌺', '🦄', '🎭', '🍰', '🌊', '🎪', '🐼',
  '🍩', '🎈', '🦊', '🎠', '🍭', '🌴',
];

/** Deterministic PRNG so a game can be replayed from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRng<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateCards(pairsCount: number, rng: () => number): CardData[] {
  const selectedEmojis = shuffleWithRng(EMOJI_POOL, rng).slice(0, pairsCount);
  const cardPairs: CardData[] = [];
  let id = 0;
  for (const emoji of selectedEmojis) {
    cardPairs.push(
      { id: id++, symbol: emoji, isFlipped: false, isMatched: false },
      { id: id++, symbol: emoji, isFlipped: false, isMatched: false }
    );
  }
  return shuffleWithRng(cardPairs, rng);
}

export type GameActionType = 'flip' | 'match' | 'unflip';

export interface GameAction {
  type: GameActionType;
  cardIds: number[];
}

export interface GameSnapshot {
  cards: CardData[];
  matchedPairs: number;
  moves: number;
  started: boolean;
  timerRunning: boolean;
  elapsedMs: number;
  settled: boolean;
  finalElapsedMs: number | null;
  finalMoves: number | null;
}

export interface HistoryEntry {
  id: number;
  parentId: number;
  action: GameAction | null;
  snapshot: GameSnapshot;
  children: number[];
}

export type FlipResult =
  | { kind: 'ignored' }
  | { kind: 'flipped'; cardId: number }
  | { kind: 'matched'; cardIds: [number, number]; won: boolean }
  | { kind: 'mismatch'; cardIds: [number, number] };

function cloneCards(cards: CardData[]): CardData[] {
  return cards.map((c) => ({ ...c }));
}

/**
 * Pure, DOM-free memory-match engine.
 *
 * Every flip / match / unflip is recorded as an ordered action in an
 * append-only, branched history log. Each log entry stores the full
 * snapshot taken after its action, so any historical state can be
 * restored exactly (board, stats and timer). Undoing and then acting
 * appends a new branch after the rewind point; the original record is
 * never overwritten.
 */
export class MemoryEngine {
  readonly config: DifficultyConfig;
  readonly seed: number;

  private state: GameSnapshot;
  private lastTickNow = 0;
  private log: HistoryEntry[] = [];
  private cursor = 0;

  constructor(config: DifficultyConfig, seed: number) {
    this.config = config;
    this.seed = seed;
    this.state = {
      cards: generateCards(config.pairs, mulberry32(seed)),
      matchedPairs: 0,
      moves: 0,
      started: false,
      timerRunning: false,
      elapsedMs: 0,
      settled: false,
      finalElapsedMs: null,
      finalMoves: null,
    };
    this.log = [
      { id: 0, parentId: -1, action: null, snapshot: this.takeSnapshot(), children: [] },
    ];
    this.cursor = 0;
  }

  get history(): readonly HistoryEntry[] {
    return this.log;
  }

  get cursorId(): number {
    return this.cursor;
  }

  snapshot(): GameSnapshot {
    return this.takeSnapshot();
  }

  private takeSnapshot(): GameSnapshot {
    return { ...this.state, cards: cloneCards(this.state.cards) };
  }

  private restore(snapshot: GameSnapshot, now: number): void {
    this.state = { ...snapshot, cards: cloneCards(snapshot.cards) };
    this.lastTickNow = now;
  }

  private record(action: GameAction): void {
    const entry: HistoryEntry = {
      id: this.log.length,
      parentId: this.cursor,
      action,
      snapshot: this.takeSnapshot(),
      children: [],
    };
    this.log[this.cursor].children.push(entry.id);
    this.log.push(entry);
    this.cursor = entry.id;
  }

  /** Advance the logical timer; returns the current elapsed time. */
  tick(now: number): number {
    if (this.state.timerRunning) {
      this.state.elapsedMs += now - this.lastTickNow;
    }
    this.lastTickNow = now;
    return this.state.elapsedMs;
  }

  private openUnmatched(): CardData[] {
    return this.state.cards.filter((c) => c.isFlipped && !c.isMatched);
  }

  flip(cardId: number, now: number): FlipResult {
    const s = this.state;
    if (s.settled) return { kind: 'ignored' };
    const card = s.cards.find((c) => c.id === cardId);
    if (!card || card.isFlipped || card.isMatched) return { kind: 'ignored' };
    const open = this.openUnmatched();
    // Invariant: never more than two unmatched cards face up.
    if (open.length >= 2) return { kind: 'ignored' };

    this.tick(now);
    if (!s.started) {
      s.started = true;
      s.timerRunning = true;
      this.lastTickNow = now;
    }
    s.moves++;
    card.isFlipped = true;
    this.record({ type: 'flip', cardIds: [cardId] });

    if (open.length === 0) {
      return { kind: 'flipped', cardId };
    }

    const first = open[0];
    if (first.symbol !== card.symbol) {
      return { kind: 'mismatch', cardIds: [first.id, card.id] };
    }

    first.isMatched = true;
    card.isMatched = true;
    s.matchedPairs++;
    const won = s.matchedPairs === this.config.pairs;
    if (won) {
      this.tick(now);
      s.timerRunning = false;
      s.settled = true;
      s.finalElapsedMs = s.elapsedMs;
      s.finalMoves = s.moves;
    }
    this.record({ type: 'match', cardIds: [first.id, card.id] });
    return { kind: 'matched', cardIds: [first.id, card.id], won };
  }

  /** Flip the two currently open mismatched cards back down. */
  resolveMismatch(now: number): number[] {
    const s = this.state;
    if (s.settled) return [];
    const open = this.openUnmatched();
    if (open.length !== 2) return [];
    this.tick(now);
    for (const card of open) card.isFlipped = false;
    this.record({ type: 'unflip', cardIds: [open[0].id, open[1].id] });
    return [open[0].id, open[1].id];
  }

  canUndo(): boolean {
    return !this.state.settled && this.cursor !== 0;
  }

  canRedo(): boolean {
    return !this.state.settled && this.log[this.cursor].children.length > 0;
  }

  undo(now: number): boolean {
    if (!this.canUndo()) return false;
    this.cursor = this.log[this.cursor].parentId;
    this.restore(this.log[this.cursor].snapshot, now);
    return true;
  }

  redo(now: number): boolean {
    if (!this.canRedo()) return false;
    const children = this.log[this.cursor].children;
    // Follow the most recently created branch.
    this.cursor = children[children.length - 1];
    this.restore(this.log[this.cursor].snapshot, now);
    return true;
  }
}
