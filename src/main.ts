import { getRandomWord } from './wordManager';
import {
  createGameEngine,
  type GameEngine,
  type GamePhase,
  type GameStateSnapshot,
  type RoundRecord
} from './gameEngine.ts';
import {
  createUIController,
  typeTextAnimated,
  startCountdown,
  cancelAllTimers,
  type RoundRecordUI,
  type UIController
} from './uiController';

const STORAGE_KEY = 'guess-word-duel-history-v1';
const HINT_PREPARE_DELAY_MS = 500;
const RESULT_DELAY_MS = 1400;
const HINT_TYPING_INTERVAL_MS = 80;

const storage = {
  load(): RoundRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RoundRecord[];
      return [];
    } catch {
      return [];
    }
  },
  save(records: RoundRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // ignore storage errors
    }
  }
};

const engine: GameEngine = createGameEngine({
  storage,
  now: () => Date.now()
});

let ui: UIController;
let lastPhase: GamePhase | null = null;
let lastHistoryLength = -1;

function mapHistoryForUI(history: RoundRecord[]): RoundRecordUI[] {
  return history.map(r => ({
    round: r.round,
    picker: r.picker,
    word: r.word,
    correct: r.correct,
    scoreA: r.scoreA,
    scoreB: r.scoreB
  }));
}

function startHintTyping(snapshot: GameStateSnapshot): void {
  const idx = snapshot.currentHintIndex;
  const hintText = snapshot.currentHints[idx];
  if (hintText === undefined) {
    engine.dispatch({ type: 'hintTypingComplete' });
    return;
  }
  typeTextAnimated(
    hintText,
    (typed) => {
      ui.updateHintTyping(idx, typed, true);
    },
    () => {
      ui.updateHintTyping(idx, hintText, false);
      engine.dispatch({ type: 'hintTypingComplete' });
    },
    HINT_TYPING_INTERVAL_MS
  );
}

function render(snapshot: GameStateSnapshot): void {
  if (snapshot.phase !== 'idle') {
    ui.renderStatus(
      Math.max(1, snapshot.currentRound),
      snapshot.totalRounds,
      snapshot.scoreA,
      snapshot.scoreB,
      snapshot.currentPicker
    );
  }

  if (snapshot.history.length !== lastHistoryLength) {
    lastHistoryLength = snapshot.history.length;
    ui.renderHistory(mapHistoryForUI(snapshot.history));
  }

  if (snapshot.phase === lastPhase) return;
  lastPhase = snapshot.phase;
  cancelAllTimers();

  switch (snapshot.phase) {
    case 'idle':
      ui.renderWelcome();
      break;
    case 'wordPicking':
      ui.renderWordPicker(null);
      break;
    case 'hintRevealing':
      ui.renderWaitingForHints();
      window.setTimeout(() => {
        const current = engine.getState();
        if (current.phase !== 'hintRevealing') return;
        ui.renderGuessPanel(current.currentHints, current.currentHintIndex, '', true);
        startHintTyping(current);
      }, HINT_PREPARE_DELAY_MS);
      break;
    case 'guessing':
      ui.focusGuessInput();
      startCountdown(
        snapshot.hintCountdownMs,
        (remainingMs) => {
          ui.setCountdown(remainingMs / 1000, snapshot.hintCountdownMs / 1000);
        },
        () => {
          engine.dispatch({ type: 'countdownExpired' });
        }
      );
      break;
    case 'result': {
      const record = snapshot.history[snapshot.history.length - 1];
      if (record && record.round === snapshot.currentRound) {
        if (record.correct) {
          ui.flashCorrect();
        } else {
          ui.flashWrong();
        }
        ui.showFloatingScore(10);
      }
      window.setTimeout(() => {
        engine.dispatch({ type: 'resultAcknowledged' });
      }, RESULT_DELAY_MS);
      break;
    }
    case 'gameOver':
      ui.renderGameOver(snapshot.scoreA, snapshot.scoreB);
      ui.renderHistory(mapHistoryForUI(snapshot.history));
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
    onStartGame: () => engine.dispatch({ type: 'startGame' }),
    onSelectWord: (word) => engine.dispatch({ type: 'selectWord', word }),
    onConfirmWord: () => engine.dispatch({ type: 'confirmWord' }),
    onSubmitGuess: (guess) => engine.dispatch({ type: 'submitGuess', guess }),
    onClearHistory: () => engine.dispatch({ type: 'clearHistory' }),
    onRestart: () => engine.dispatch({ type: 'restart' })
  });
  ui.init();
  engine.subscribe(() => render(engine.getState()));
  render(engine.getState());
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
