import { generateHints, validateCustomWord } from './wordManager';

export type GamePhase = 'idle' | 'wordPicking' | 'hintRevealing' | 'guessing' | 'result' | 'gameOver';
export type Player = 'A' | 'B';

export interface RoundRecord {
  round: number;
  picker: Player;
  word: string;
  correct: boolean;
  scoreA: number;
  scoreB: number;
  timestamp: number;
}

export interface RoundOutcome {
  round: number;
  picker: Player;
  scorer: Player;
  word: string;
  correct: boolean;
  gained: number;
}

export interface GameState {
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  currentPicker: Player;
  scoreA: number;
  scoreB: number;
  currentWord: string | null;
  currentHints: string[];
  currentHintIndex: number;
  hintDeadline: number | null;
  guessSubmitted: boolean;
  judged: boolean;
  selectedWord: string | null;
  lastOutcome: RoundOutcome | null;
  history: RoundRecord[];
}

export type GameEvent =
  | { type: 'startGame'; at: number }
  | { type: 'selectWord'; word: string }
  | { type: 'confirmWord'; at: number }
  | { type: 'hintRevealed'; at: number }
  | { type: 'submitGuess'; guess: string; at: number }
  | { type: 'tick'; at: number }
  | { type: 'advance'; at: number }
  | { type: 'clearHistory' };

export interface HistoryStore {
  load(): RoundRecord[];
  save(records: RoundRecord[]): void;
}

export const HINT_COUNTDOWN_MS = 3000;
export const TOTAL_ROUNDS = 5;
export const ROUND_SCORE = 10;
export const HISTORY_LIMIT = 50;

export interface GameEngine {
  dispatch(event: GameEvent): void;
  getState(): Readonly<GameState>;
  getRemainingMs(now: number): number;
  subscribe(listener: (state: Readonly<GameState>) => void): void;
}

export interface GameEngineOptions {
  store?: HistoryStore;
  totalRounds?: number;
}

function isValidRecord(value: unknown): value is RoundRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.round === 'number' &&
    (r.picker === 'A' || r.picker === 'B') &&
    typeof r.word === 'string' &&
    typeof r.correct === 'boolean' &&
    typeof r.scoreA === 'number' &&
    typeof r.scoreB === 'number' &&
    typeof r.timestamp === 'number'
  );
}

export function createGameEngine(options: GameEngineOptions = {}): GameEngine {
  const store = options.store ?? null;
  const totalRounds = options.totalRounds ?? TOTAL_ROUNDS;

  const state: GameState = {
    phase: 'idle',
    currentRound: 0,
    totalRounds,
    currentPicker: 'A',
    scoreA: 0,
    scoreB: 0,
    currentWord: null,
    currentHints: [],
    currentHintIndex: 0,
    hintDeadline: null,
    guessSubmitted: false,
    judged: false,
    selectedWord: null,
    lastOutcome: null,
    history: loadInitialHistory()
  };

  const listeners: Array<(state: Readonly<GameState>) => void> = [];

  function loadInitialHistory(): RoundRecord[] {
    if (!store) return [];
    try {
      const loaded = store.load();
      if (!Array.isArray(loaded)) return [];
      return loaded.filter(isValidRecord);
    } catch {
      return [];
    }
  }

  function persistHistory(): void {
    if (!store) return;
    try {
      store.save(state.history.slice(-HISTORY_LIMIT));
    } catch {
      // storage failures must not break the simulation
    }
  }

  function notify(): void {
    for (const listener of listeners) listener(state);
  }

  function resetRoundFields(): void {
    state.selectedWord = null;
    state.currentWord = null;
    state.currentHints = [];
    state.currentHintIndex = 0;
    state.hintDeadline = null;
    state.guessSubmitted = false;
    state.judged = false;
    state.lastOutcome = null;
  }

  function enterWordPicking(): void {
    resetRoundFields();
    state.phase = 'wordPicking';
  }

  function judge(correct: boolean, at: number): void {
    if (state.judged) return;
    state.judged = true;
    state.guessSubmitted = true;
    state.hintDeadline = null;

    const picker = state.currentPicker;
    const scorer: Player = correct
      ? (picker === 'A' ? 'B' : 'A')
      : picker;
    if (scorer === 'A') state.scoreA += ROUND_SCORE;
    else state.scoreB += ROUND_SCORE;

    const word = state.currentWord ?? '';
    const record: RoundRecord = {
      round: state.currentRound,
      picker,
      word,
      correct,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      timestamp: at
    };
    state.history.push(record);
    persistHistory();

    state.lastOutcome = {
      round: state.currentRound,
      picker,
      scorer,
      word,
      correct,
      gained: ROUND_SCORE
    };
    state.phase = 'result';
  }

  function dispatch(event: GameEvent): void {
    switch (event.type) {
      case 'startGame': {
        state.currentRound = 1;
        state.currentPicker = 'A';
        state.scoreA = 0;
        state.scoreB = 0;
        state.history = [];
        persistHistory();
        enterWordPicking();
        break;
      }
      case 'selectWord': {
        if (state.phase !== 'wordPicking') return;
        state.selectedWord = event.word;
        break;
      }
      case 'confirmWord': {
        if (state.phase !== 'wordPicking') return;
        const word = state.selectedWord;
        if (!word || !validateCustomWord(word)) return;
        state.currentWord = word;
        state.currentHints = generateHints(word);
        state.currentHintIndex = 0;
        state.hintDeadline = null;
        state.guessSubmitted = false;
        state.judged = false;
        state.lastOutcome = null;
        state.phase = 'hintRevealing';
        break;
      }
      case 'hintRevealed': {
        if (state.phase !== 'hintRevealing') return;
        if (state.currentHintIndex >= state.currentHints.length) return;
        state.hintDeadline = event.at + HINT_COUNTDOWN_MS;
        state.guessSubmitted = false;
        state.phase = 'guessing';
        break;
      }
      case 'submitGuess': {
        if (state.phase !== 'guessing' || state.judged || state.guessSubmitted) return;
        const guess = event.guess.trim();
        if (!guess) return;
        judge(guess === (state.currentWord ?? ''), event.at);
        break;
      }
      case 'tick': {
        if (state.phase !== 'guessing' || state.judged) return;
        if (state.hintDeadline === null || event.at < state.hintDeadline) return;
        if (state.currentHintIndex < state.currentHints.length - 1) {
          state.currentHintIndex += 1;
          state.hintDeadline = null;
          state.guessSubmitted = false;
          state.phase = 'hintRevealing';
        } else {
          judge(false, event.at);
        }
        break;
      }
      case 'advance': {
        if (state.phase !== 'result') return;
        if (state.currentRound >= state.totalRounds) {
          state.phase = 'gameOver';
        } else {
          state.currentRound += 1;
          state.currentPicker = state.currentPicker === 'A' ? 'B' : 'A';
          enterWordPicking();
        }
        break;
      }
      case 'clearHistory': {
        state.history = [];
        persistHistory();
        break;
      }
    }
    notify();
  }

  return {
    dispatch,
    getState() {
      return state;
    },
    getRemainingMs(now: number): number {
      if (state.phase !== 'guessing' || state.hintDeadline === null) return 0;
      return Math.max(0, state.hintDeadline - now);
    },
    subscribe(listener) {
      listeners.push(listener);
    }
  };
}
