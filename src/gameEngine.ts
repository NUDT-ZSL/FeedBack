import { generateHints, validateCustomWord } from './wordManager.ts';

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

export interface GameStateSnapshot {
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  currentPicker: Player;
  scoreA: number;
  scoreB: number;
  currentWord: string | null;
  currentHints: string[];
  currentHintIndex: number;
  hintsRevealed: number;
  selectedWord: string | null;
  guessSubmitted: boolean;
  hintCountdownMs: number;
  countdownRemainingMs: number | null;
  history: RoundRecord[];
}

export type GameEvent =
  | { type: 'startGame' }
  | { type: 'restart' }
  | { type: 'selectWord'; word: string }
  | { type: 'confirmWord' }
  | { type: 'hintTypingComplete' }
  | { type: 'submitGuess'; guess: string }
  | { type: 'countdownExpired' }
  | { type: 'resultAcknowledged' }
  | { type: 'clearHistory' };

export interface HistoryStorage {
  load(): RoundRecord[];
  save(records: RoundRecord[]): void;
}

export interface GameEngineOptions {
  totalRounds?: number;
  hintCountdownMs?: number;
  historyLimit?: number;
  now?: () => number;
  storage?: HistoryStorage;
}

export interface GameEngine {
  getState(): GameStateSnapshot;
  dispatch(event: GameEvent): void;
  subscribe(listener: () => void): () => void;
}

export const DEFAULT_TOTAL_ROUNDS = 5;
export const DEFAULT_HINT_COUNTDOWN_MS = 3000;
export const DEFAULT_HISTORY_LIMIT = 50;
export const ROUND_SCORE = 10;

export function createGameEngine(options: GameEngineOptions = {}): GameEngine {
  const totalRounds = options.totalRounds ?? DEFAULT_TOTAL_ROUNDS;
  const hintCountdownMs = options.hintCountdownMs ?? DEFAULT_HINT_COUNTDOWN_MS;
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const now = options.now ?? (() => Date.now());
  const storage = options.storage ?? null;

  let phase: GamePhase = 'idle';
  let currentRound = 0;
  let currentPicker: Player = 'A';
  let scoreA = 0;
  let scoreB = 0;
  let currentWord: string | null = null;
  let currentHints: string[] = [];
  let currentHintIndex = 0;
  let hintsRevealed = 0;
  let selectedWord: string | null = null;
  let guessSubmitted = false;
  let countdownStartedAt: number | null = null;
  let history: RoundRecord[] = storage ? storage.load() : [];

  const listeners = new Set<() => void>();

  function persistHistory(): void {
    history = history.slice(-historyLimit);
    if (storage) {
      storage.save(history.map(record => ({ ...record })));
    }
  }

  function notify(): void {
    listeners.forEach(listener => listener());
  }

  function guessPlayer(): Player {
    return currentPicker === 'A' ? 'B' : 'A';
  }

  function beginWordPicking(): void {
    phase = 'wordPicking';
    selectedWord = null;
    currentWord = null;
    currentHints = [];
    currentHintIndex = 0;
    hintsRevealed = 0;
    guessSubmitted = false;
    countdownStartedAt = null;
  }

  function startGame(): void {
    currentRound = 1;
    scoreA = 0;
    scoreB = 0;
    currentPicker = 'A';
    history = [];
    persistHistory();
    beginWordPicking();
  }

  function settle(correct: boolean): void {
    phase = 'result';
    guessSubmitted = true;
    countdownStartedAt = null;
    const scorer = correct ? guessPlayer() : currentPicker;
    if (scorer === 'A') {
      scoreA += ROUND_SCORE;
    } else {
      scoreB += ROUND_SCORE;
    }
    history.push({
      round: currentRound,
      picker: currentPicker,
      word: currentWord ?? '',
      correct,
      scoreA,
      scoreB,
      timestamp: now()
    });
    persistHistory();
  }

  function dispatch(event: GameEvent): void {
    switch (event.type) {
      case 'startGame':
      case 'restart':
        startGame();
        break;
      case 'selectWord':
        if (phase !== 'wordPicking') return;
        selectedWord = event.word;
        break;
      case 'confirmWord': {
        if (phase !== 'wordPicking') return;
        const word = selectedWord;
        if (!word || !validateCustomWord(word)) return;
        currentWord = word;
        currentHints = generateHints(word);
        currentHintIndex = 0;
        hintsRevealed = 0;
        guessSubmitted = false;
        countdownStartedAt = null;
        phase = 'hintRevealing';
        break;
      }
      case 'hintTypingComplete':
        if (phase !== 'hintRevealing') return;
        hintsRevealed = currentHintIndex + 1;
        guessSubmitted = false;
        countdownStartedAt = now();
        phase = 'guessing';
        break;
      case 'submitGuess': {
        if (phase !== 'guessing' || guessSubmitted) return;
        const guess = event.guess.trim();
        if (!guess) return;
        settle(guess === (currentWord ?? ''));
        break;
      }
      case 'countdownExpired':
        if (phase !== 'guessing' || guessSubmitted) return;
        settle(false);
        break;
      case 'resultAcknowledged':
        if (phase !== 'result') return;
        if (currentRound >= totalRounds) {
          phase = 'gameOver';
        } else {
          currentRound += 1;
          currentPicker = currentPicker === 'A' ? 'B' : 'A';
          beginWordPicking();
        }
        break;
      case 'clearHistory':
        history = [];
        persistHistory();
        break;
    }
    notify();
  }

  function getState(): GameStateSnapshot {
    const countdownRemainingMs =
      phase === 'guessing' && countdownStartedAt !== null
        ? Math.max(0, hintCountdownMs - (now() - countdownStartedAt))
        : null;
    return {
      phase,
      currentRound,
      totalRounds,
      currentPicker,
      scoreA,
      scoreB,
      currentWord,
      currentHints: [...currentHints],
      currentHintIndex,
      hintsRevealed,
      selectedWord,
      guessSubmitted,
      hintCountdownMs,
      countdownRemainingMs,
      history: history.map(record => ({ ...record }))
    };
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, dispatch, subscribe };
}
