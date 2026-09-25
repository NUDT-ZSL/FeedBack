import {
  DIFFICULTY_CONFIGS,
  DifficultyConfig,
  DifficultyLevel,
  GameSnapshot,
} from './engine';
import { GameSession, SessionEvents } from './session';
import {
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
} from './ui';

class MemoryGameUI {
  private difficulty: DifficultyLevel = 'medium';
  private readonly session: GameSession;

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
  private readonly closeModalBtn: HTMLButtonElement;

  constructor() {
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
    this.closeModalBtn = this.getElement('closeModalBtn') as HTMLButtonElement;

    this.session = new GameSession(
      DIFFICULTY_CONFIGS[this.difficulty],
      this.buildEvents()
    );

    this.bindEvents();
    this.session.start();
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }

  private renderBoard(snapshot: GameSnapshot, config: DifficultyConfig): void {
    renderGrid(this.gridContainer, snapshot.cards, config);
    for (const card of snapshot.cards) {
      const el = getCardElementById(this.gridContainer, card.id);
      if (!el) continue;
      if (card.isMatched) {
        markCardMatched(el);
      } else if (card.isFlipped) {
        flipCard(el, true);
      }
    }
  }

  private buildEvents(): SessionEvents {
    return {
      onBoard: (snapshot, config) => this.renderBoard(snapshot, config),
      onFlip: (cardId) => {
        const el = getCardElementById(this.gridContainer, cardId);
        if (el) {
          triggerClickAnimation(el);
          flipCard(el, true);
        }
      },
      onUnflip: (cardIds) => {
        for (const id of cardIds) {
          const el = getCardElementById(this.gridContainer, id);
          if (el) {
            flipCard(el, false);
            clearCardWrong(el);
          }
        }
      },
      onMatched: (cardIds) => {
        for (const id of cardIds) {
          const el = getCardElementById(this.gridContainer, id);
          if (el) markCardMatched(el);
        }
      },
      onMismatch: (cardIds) => {
        for (const id of cardIds) {
          const el = getCardElementById(this.gridContainer, id);
          if (el) markCardWrong(el);
        }
      },
      onStats: (snapshot) => {
        updateMatchesDisplay(
          this.matchesDisplay,
          snapshot.matchedPairs,
          this.session.config.pairs
        );
        updateMovesDisplay(this.movesDisplay, snapshot.moves);
      },
      onTick: (elapsedMs) => updateTimerDisplay(this.timerDisplay, elapsedMs),
      onSettled: (finalElapsedMs, finalMoves) => {
        showGameOverModal(
          this.gameOverModal,
          this.finalTimeElement,
          this.finalMovesElement,
          finalElapsedMs,
          finalMoves
        );
      },
      onHistoryChange: (canUndo, canRedo) => {
        this.undoBtn.disabled = !canUndo;
        this.redoBtn.disabled = !canRedo;
      },
    };
  }

  private bindEvents(): void {
    this.gridContainer.addEventListener('click', this.handleGridClick.bind(this));
    this.gridContainer.addEventListener('keydown', this.handleGridKeydown.bind(this));
    this.difficultySelect.addEventListener('change', this.handleDifficultyChange.bind(this));
    this.restartBtn.addEventListener('click', this.handleRestart.bind(this));
    this.playAgainBtn.addEventListener('click', this.handleRestart.bind(this));
    this.closeModalBtn.addEventListener('click', this.handleRestart.bind(this));
    this.undoBtn.addEventListener('click', () => this.session.undo());
    this.redoBtn.addEventListener('click', () => this.session.redo());
  }

  private handleGridClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const cardElement = target.closest('.card') as HTMLElement | null;
    if (cardElement) {
      this.session.clickCard(Number(cardElement.dataset.cardId));
    }
  }

  private handleGridKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    const cardElement = target.closest('.card') as HTMLElement | null;
    if (cardElement) {
      event.preventDefault();
      this.session.clickCard(Number(cardElement.dataset.cardId));
    }
  }

  private handleDifficultyChange(): void {
    const newDifficulty = this.difficultySelect.value as DifficultyLevel;
    if (newDifficulty === this.difficulty) return;
    this.difficulty = newDifficulty;
    hideGameOverModal(this.gameOverModal);
    this.session.setDifficulty(DIFFICULTY_CONFIGS[this.difficulty]);
  }

  private handleRestart(): void {
    hideGameOverModal(this.gameOverModal);
    this.session.reset();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MemoryGameUI();
});
