import { getRandomWord } from './wordManager';
import {
  createGameEngine,
  HINT_COUNTDOWN_MS,
  type GameEngine,
  type GameState,
  type RoundRecord
} from './gameEngine';
import { createLocalStorageStore } from './historyStore';
import {
  createUIController,
  typeTextAnimated,
  startCountdown,
  cancelAllTimers,
  type RoundRecordUI,
  type UIController
} from './uiController';

const HINT_REVEAL_DELAY_MS = 500;
const RESULT_DELAY_MS = 1400;
const TYPING_INTERVAL_MS = 80;

const engine: GameEngine = createGameEngine({ store: createLocalStorageStore() });

let ui: UIController;
let prevPhase: GameState['phase'] = 'idle';
let prevHistory: readonly RoundRecord[] = engine.getState().history;

function now(): number {
  return Date.now();
}

function mapHistoryForUI(records: readonly RoundRecord[]): RoundRecordUI[] {
  return records.map(r => ({
    round: r.round,
    picker: r.picker,
    word: r.word,
    correct: r.correct,
    scoreA: r.scoreA,
    scoreB: r.scoreB
  }));
}

function renderStatus(state: GameState): void {
  ui.renderStatus(
    Math.max(1, state.currentRound),
    state.totalRounds,
    state.scoreA,
    state.scoreB,
    state.currentPicker
  );
}

function startTyping(hintIndex: number): void {
  const state = engine.getState();
  if (state.phase !== 'hintRevealing' || state.currentHintIndex !== hintIndex) return;
  const hintText = state.currentHints[hintIndex];
  if (hintText === undefined) return;
  typeTextAnimated(
    hintText,
    (typed) => {
      ui.updateHintTyping(hintIndex, typed, true);
    },
    () => {
      ui.updateHintTyping(hintIndex, hintText, false);
      engine.dispatch({ type: 'hintRevealed', at: now() });
      if (engine.getState().phase === 'guessing') {
        beginCountdownUI();
      }
    },
    TYPING_INTERVAL_MS
  );
}

function beginCountdownUI(): void {
  ui.focusGuessInput();
  startCountdown(
    HINT_COUNTDOWN_MS,
    () => {
      ui.setCountdown(engine.getRemainingMs(now()) / 1000, HINT_COUNTDOWN_MS / 1000);
    },
    () => {
      engine.dispatch({ type: 'tick', at: now() });
    }
  );
}

function beginHintSequence(state: GameState): void {
  const round = state.currentRound;
  ui.renderWaitingForHints();
  setTimeout(() => {
    const current = engine.getState();
    if (current.phase !== 'hintRevealing' || current.currentRound !== round) return;
    ui.renderGuessPanel(current.currentHints, current.currentHintIndex, '', true);
    startTyping(current.currentHintIndex);
  }, HINT_REVEAL_DELAY_MS);
}

function handleResult(state: GameState): void {
  cancelAllTimers();
  const outcome = state.lastOutcome;
  if (outcome) {
    if (outcome.correct) ui.flashCorrect();
    else ui.flashWrong();
    ui.showFloatingScore(outcome.gained);
  }
  const round = state.currentRound;
  setTimeout(() => {
    const current = engine.getState();
    if (current.phase !== 'result' || current.currentRound !== round) return;
    engine.dispatch({ type: 'advance', at: now() });
  }, RESULT_DELAY_MS);
}

function handleState(state: GameState): void {
  renderStatus(state);

  if (state.history !== prevHistory) {
    prevHistory = state.history;
    ui.renderHistory(mapHistoryForUI(state.history));
  }

  const entered = state.phase !== prevPhase;
  const from = prevPhase;
  prevPhase = state.phase;
  if (!entered) return;

  switch (state.phase) {
    case 'wordPicking':
      cancelAllTimers();
      ui.renderWordPicker(null);
      break;
    case 'hintRevealing':
      if (from === 'wordPicking') {
        beginHintSequence(state);
      } else {
        startTyping(state.currentHintIndex);
      }
      break;
    case 'result':
      handleResult(state);
      break;
    case 'gameOver':
      cancelAllTimers();
      ui.renderGameOver(state.scoreA, state.scoreB);
      break;
    default:
      break;
  }
}

function init(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('App root not found');
    return;
  }
  ui = createUIController(root);
  ui.setHandlers({
    onStartGame: () => engine.dispatch({ type: 'startGame', at: now() }),
    onSelectWord: (word: string) => engine.dispatch({ type: 'selectWord', word }),
    onConfirmWord: () => engine.dispatch({ type: 'confirmWord', at: now() }),
    onSubmitGuess: (guess: string) => engine.dispatch({ type: 'submitGuess', guess, at: now() }),
    onClearHistory: () => engine.dispatch({ type: 'clearHistory' }),
    onRestart: () => engine.dispatch({ type: 'startGame', at: now() })
  });
  ui.init();
  engine.subscribe(handleState);
  handleState(engine.getState());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export {
  engine,
  getRandomWord
};
