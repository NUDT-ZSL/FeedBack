// DOM 适配层：把 GameCore 的纯状态事件接到现有渲染函数上。
// 棋盘渲染、卡片动画与视觉表现保持不变。
import { GameCore } from './core.ts';
import type {
  CardState,
  CoreEvents,
  Scheduler,
} from './core.ts';
import {
  DIFFICULTY_CONFIGS,
  generateCards,
  renderGrid,
  updateTimerDisplay,
  updateMatchesDisplay,
  updateMovesDisplay,
  flipCard,
  markCardMatched,
  markCardWrong,
  clearCardWrong,
  triggerClickAnimation,
  showGameOverModal,
  hideGameOverModal,
  getCardElementById,
  syncCardElement,
} from './ui.ts';
import type {
  DifficultyConfig,
  DifficultyLevel,
} from './ui.ts';

const MISMATCH_DELAY_MS = 1000;
const MODAL_DELAY_MS = 600;

function createBrowserScheduler(): Scheduler {
  return {
    now: () => performance.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  };
}

export class MemoryGame {
  private readonly core: GameCore;
  private readonly scheduler: Scheduler;
  private difficulty: DifficultyLevel = 'medium';
  private config: DifficultyConfig = DIFFICULTY_CONFIGS[this.difficulty];
  private modalTimeoutHandle: unknown = null;

  private readonly gridContainer: HTMLElement;
  private readonly timerDisplay: HTMLElement;
  private readonly matchesDisplay: HTMLElement;
  private readonly movesDisplay: HTMLElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly gameOverModal: HTMLElement;
  private readonly finalTimeElement: HTMLElement;
  private readonly finalMovesElement: HTMLElement;
  private readonly playAgainBtn: HTMLButtonElement;

  constructor(scheduler?: Scheduler) {
    this.gridContainer = this.getElement('cardGrid');
    this.timerDisplay = this.getElement('timerDisplay');
    this.matchesDisplay = this.getElement('matchesDisplay');
    this.movesDisplay = this.getElement('movesDisplay');
    this.difficultySelect = this.getElement('difficultySelect') as HTMLSelectElement;
    this.restartBtn = this.getElement('restartBtn') as HTMLButtonElement;
    this.undoBtn = this.getElement('undoBtn') as HTMLButtonElement;
    this.redoBtn = this.getElement('redoBtn') as HTMLButtonElement;
    this.gameOverModal = this.getElement('gameOverModal');
    this.finalTimeElement = this.getElement('finalTime');
    this.finalMovesElement = this.getElement('finalMoves');
    this.playAgainBtn = this.getElement('playAgainBtn') as HTMLButtonElement;

    this.scheduler = scheduler ?? createBrowserScheduler();
    this.core = new GameCore(
      { pairs: this.config.pairs, mismatchDelayMs: MISMATCH_DELAY_MS },
      generateCards(this.config.pairs),
      this.scheduler,
      this.createCoreEvents()
    );

    this.bindEvents();
    this.renderInitial();
  }

  getCore(): GameCore {
    return this.core;
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }

  private createCoreEvents(): CoreEvents {
    return {
      onCardFlip: (cardId, faceUp) => {
        const el = getCardElementById(this.gridContainer, cardId);
        if (el) flipCard(el, faceUp);
      },
      onCardMatched: (cardId) => {
        const el = getCardElementById(this.gridContainer, cardId);
        if (el) markCardMatched(el);
      },
      onCardWrong: (cardId, wrong) => {
        const el = getCardElementById(this.gridContainer, cardId);
        if (!el) return;
        if (wrong) {
          markCardWrong(el);
        } else {
          clearCardWrong(el);
        }
      },
      onBoardSync: (cards) => this.syncBoard(cards),
      onStats: (moves, matchedPairs, totalPairs) => {
        updateMovesDisplay(this.movesDisplay, moves);
        updateMatchesDisplay(this.matchesDisplay, matchedPairs, totalPairs);
      },
      onTimer: (elapsedMs) => {
        updateTimerDisplay(this.timerDisplay, elapsedMs);
      },
      onGameOver: (elapsedMs, moves) => {
        this.scheduleGameOverModal(elapsedMs, moves);
      },
      onGameContinued: () => {
        this.cancelGameOverModal();
      },
      onHistoryChange: (canUndo, canRedo) => {
        this.undoBtn.disabled = !canUndo;
        this.redoBtn.disabled = !canRedo;
      },
      onReset: (cards) => {
        this.cancelGameOverModal();
        renderGrid(this.gridContainer, cards, this.config);
      },
    };
  }

  private renderInitial(): void {
    const state = this.core.getState();
    renderGrid(this.gridContainer, state.cards, this.config);
    updateTimerDisplay(this.timerDisplay, 0);
    updateMatchesDisplay(this.matchesDisplay, 0, this.config.pairs);
    updateMovesDisplay(this.movesDisplay, 0);
    this.undoBtn.disabled = true;
    this.redoBtn.disabled = true;
  }

  private syncBoard(cards: CardState[]): void {
    for (const card of cards) {
      const el = getCardElementById(this.gridContainer, card.id);
      if (el) syncCardElement(el, card);
    }
  }

  private scheduleGameOverModal(elapsedMs: number, moves: number): void {
    this.clearModalTimeout();
    this.modalTimeoutHandle = this.scheduler.setTimeout(() => {
      this.modalTimeoutHandle = null;
      showGameOverModal(
        this.gameOverModal,
        this.finalTimeElement,
        this.finalMovesElement,
        elapsedMs,
        moves
      );
    }, MODAL_DELAY_MS);
  }

  private clearModalTimeout(): void {
    if (this.modalTimeoutHandle !== null) {
      this.scheduler.clearTimeout(this.modalTimeoutHandle);
      this.modalTimeoutHandle = null;
    }
  }

  private cancelGameOverModal(): void {
    this.clearModalTimeout();
    hideGameOverModal(this.gameOverModal);
  }

  private bindEvents(): void {
    this.gridContainer.addEventListener('click', this.handleGridClick.bind(this));
    this.gridContainer.addEventListener('keydown', this.handleGridKeydown.bind(this));
    this.difficultySelect.addEventListener(
      'change',
      this.handleDifficultyChange.bind(this)
    );
    this.restartBtn.addEventListener('click', this.handleRestart.bind(this));
    this.playAgainBtn.addEventListener('click', this.handleRestart.bind(this));
    this.undoBtn.addEventListener('click', () => this.core.undo());
    this.redoBtn.addEventListener('click', () => this.core.redo());
    document.addEventListener('keydown', this.handleShortcut.bind(this));
  }

  private handleGridClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cardElement = target.closest('.card') as HTMLElement | null;
    if (cardElement) {
      this.handleCardClick(cardElement);
    }
  }

  private handleGridKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    const cardElement = target.closest('.card') as HTMLElement | null;
    if (cardElement) {
      event.preventDefault();
      this.handleCardClick(cardElement);
    }
  }

  private handleCardClick(cardElement: HTMLElement): void {
    const cardId = Number(cardElement.dataset.cardId);
    if (Number.isNaN(cardId)) return;
    if (!cardElement.classList.contains('card--matched')) {
      triggerClickAnimation(cardElement);
    }
    this.core.clickCard(cardId);
  }

  private handleShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        this.core.redo();
      } else {
        this.core.undo();
      }
    } else if (key === 'y') {
      event.preventDefault();
      this.core.redo();
    }
  }

  private handleDifficultyChange(): void {
    const newDifficulty = this.difficultySelect.value as DifficultyLevel;
    if (newDifficulty === this.difficulty) return;
    this.difficulty = newDifficulty;
    this.config = DIFFICULTY_CONFIGS[this.difficulty];
    this.core.reset(generateCards(this.config.pairs), {
      pairs: this.config.pairs,
      mismatchDelayMs: MISMATCH_DELAY_MS,
    });
  }

  private handleRestart(): void {
    this.core.reset(generateCards(this.config.pairs));
  }
}

const globalFlags = globalThis as {
  __MEMORY_GAME_DISABLE_AUTOBOOT__?: boolean;
};

if (
  typeof document !== 'undefined' &&
  !globalFlags.__MEMORY_GAME_DISABLE_AUTOBOOT__
) {
  document.addEventListener('DOMContentLoaded', () => {
    new MemoryGame();
  });
}
