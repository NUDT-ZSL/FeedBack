import {
  generateHints,
  validateCustomWord,
  getRandomWord
} from './wordManager';
import {
  createUIController,
  typeTextAnimated,
  startCountdown,
  cancelAllTimers,
  type RoundRecordUI,
  type UIController
} from './uiController';

type GamePhase = 'idle' | 'wordPicking' | 'hintRevealing' | 'guessing' | 'result' | 'gameOver';
type Player = 'A' | 'B';

interface RoundRecord {
  round: number;
  picker: Player;
  word: string;
  correct: boolean;
  scoreA: number;
  scoreB: number;
  timestamp: number;
}

interface GameState {
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  currentPicker: Player;
  scoreA: number;
  scoreB: number;
  currentWord: string | null;
  currentHints: string[];
  currentHintIndex: number;
  history: RoundRecord[];
  selectedWord: string | null;
  guessSubmitted: boolean;
}

const STORAGE_KEY = 'guess-word-duel-history-v1';
const HINT_COUNTDOWN_MS = 3000;
const TOTAL_ROUNDS = 5;

const state: GameState = {
  phase: 'idle',
  currentRound: 0,
  totalRounds: TOTAL_ROUNDS,
  currentPicker: 'A',
  scoreA: 0,
  scoreB: 0,
  currentWord: null,
  currentHints: [],
  currentHintIndex: 0,
  history: [],
  selectedWord: null,
  guessSubmitted: false
};

let ui: UIController;

function loadHistory(): RoundRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as RoundRecord[];
    return [];
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history.slice(-50)));
  } catch {
    // ignore storage errors
  }
}

function mapHistoryForUI(): RoundRecordUI[] {
  return state.history.map(r => ({
    round: r.round,
    picker: r.picker,
    word: r.word,
    correct: r.correct,
    scoreA: r.scoreA,
    scoreB: r.scoreB
  }));
}

function getGuessPlayer(): Player {
  return state.currentPicker === 'A' ? 'B' : 'A';
}

function updateStatusBar(): void {
  ui.renderStatus(
    Math.max(1, state.currentRound),
    state.totalRounds,
    state.scoreA,
    state.scoreB,
    state.currentPicker
  );
}

function beginWordPicking(): void {
  cancelAllTimers();
  state.phase = 'wordPicking';
  state.selectedWord = null;
  state.currentWord = null;
  state.currentHints = [];
  state.currentHintIndex = 0;
  state.guessSubmitted = false;
  updateStatusBar();
  ui.renderWordPicker(null);
}

function onSelectWord(word: string): void {
  state.selectedWord = word;
}

function onConfirmWord(): void {
  const word = state.selectedWord;
  if (!word) return;
  if (!validateCustomWord(word)) return;
  state.currentWord = word;
  state.phase = 'hintRevealing';
  state.currentHints = generateHints(word);
  state.currentHintIndex = 0;
  ui.renderWaitingForHints();
  setTimeout(() => {
    beginHintSequence();
  }, 500);
}

function beginHintSequence(): void {
  if (state.phase !== 'hintRevealing') return;
  state.currentHintIndex = 0;
  ui.renderGuessPanel(state.currentHints, 0, '', true);
  revealCurrentHint();
}

function revealCurrentHint(): void {
  if (state.phase !== 'hintRevealing') return;
  const idx = state.currentHintIndex;
  if (idx >= state.currentHints.length) {
    beginGuessingForLastHint();
    return;
  }
  const hintText = state.currentHints[idx];
  typeTextAnimated(
    hintText,
    (typed) => {
      ui.updateHintTyping(idx, typed, true);
    },
    () => {
      ui.updateHintTyping(idx, hintText, false);
      beginCountdownForHint();
    },
    80
  );
}

function beginCountdownForHint(): void {
  if (state.phase !== 'hintRevealing') return;
  state.phase = 'guessing';
  state.guessSubmitted = false;
  ui.focusGuessInput();
  startCountdown(
    HINT_COUNTDOWN_MS,
    (remainingMs) => {
      ui.setCountdown(remainingMs / 1000, HINT_COUNTDOWN_MS / 1000);
    },
    () => {
      if (state.guessSubmitted) return;
      handleTimeout();
    }
  );
}

function beginGuessingForLastHint(): void {
  beginCountdownForHint();
}

function onSubmitGuess(rawGuess: string): void {
  if (state.phase !== 'guessing' || state.guessSubmitted) return;
  const guess = rawGuess.trim();
  if (!guess) return;
  state.guessSubmitted = true;
  cancelAllTimers();
  const target = state.currentWord ?? '';
  const correct = guess === target;
  processResult(correct);
}

function handleTimeout(): void {
  if (state.guessSubmitted) return;
  state.guessSubmitted = true;
  processResult(false);
}

function processResult(correct: boolean): void {
  state.phase = 'result';
  cancelAllTimers();
  const guessPlayer = getGuessPlayer();
  let gained = 0;

  if (correct) {
    gained = 10;
    if (guessPlayer === 'A') state.scoreA += gained;
    else state.scoreB += gained;
    ui.flashCorrect();
    ui.showFloatingScore(gained);
  } else {
    gained = 10;
    if (state.currentPicker === 'A') state.scoreA += gained;
    else state.scoreB += gained;
    ui.flashWrong();
    ui.showFloatingScore(gained);
  }

  const record: RoundRecord = {
    round: state.currentRound,
    picker: state.currentPicker,
    word: state.currentWord ?? '',
    correct,
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    timestamp: Date.now()
  };
  state.history.push(record);
  saveHistory();
  ui.renderHistory(mapHistoryForUI());

  setTimeout(() => {
    if (state.currentRound >= state.totalRounds) {
      endGame();
    } else {
      nextRound();
    }
  }, 1400);
}

function nextRound(): void {
  state.currentPicker = state.currentPicker === 'A' ? 'B' : 'A';
  beginWordPicking();
}

function startGame(): void {
  state.phase = 'wordPicking';
  state.currentRound = 1;
  state.scoreA = 0;
  state.scoreB = 0;
  state.currentPicker = 'A';
  state.history = [];
  saveHistory();
  ui.renderHistory([]);
  beginWordPicking();
}

function endGame(): void {
  state.phase = 'gameOver';
  updateStatusBar();
  ui.renderGameOver(state.scoreA, state.scoreB);
  ui.renderHistory(mapHistoryForUI());
}

function restart(): void {
  startGame();
}

function clearHistory(): void {
  state.history = [];
  saveHistory();
  ui.renderHistory([]);
}

function init(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('App root not found');
    return;
  }
  ui = createUIController(root);
  ui.setHandlers({
    onStartGame: startGame,
    onSelectWord,
    onConfirmWord,
    onSubmitGuess,
    onClearHistory: clearHistory,
    onRestart: restart
  });
  ui.init();
  const saved = loadHistory();
  if (saved.length > 0) {
    state.history = saved;
    ui.renderHistory(mapHistoryForUI());
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export {
  state,
  getRandomWord
};
