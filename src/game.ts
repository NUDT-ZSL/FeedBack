import {
  CardData,
  DifficultyLevel,
  DIFFICULTY_CONFIGS,
  DifficultyConfig,
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
} from './ui';

class MemoryGame {
  private cards: CardData[] = [];
  private flippedCards: CardData[] = [];
  private matchedPairs: number = 0;
  private moves: number = 0;
  private isProcessing: boolean = false;
  private difficulty: DifficultyLevel = 'medium';
  private config: DifficultyConfig;

  private timerInterval: number | null = null;
  private startTime: number = 0;
  private elapsedMs: number = 0;
  private isGameStarted: boolean = false;

  private readonly gridContainer: HTMLElement;
  private readonly timerDisplay: HTMLElement;
  private readonly matchesDisplay: HTMLElement;
  private readonly movesDisplay: HTMLElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly gameOverModal: HTMLElement;
  private readonly finalTimeElement: HTMLElement;
  private readonly finalMovesElement: HTMLElement;
  private readonly playAgainBtn: HTMLButtonElement;

  constructor() {
    this.gridContainer = this.getElement('cardGrid');
    this.timerDisplay = this.getElement('timerDisplay');
    this.matchesDisplay = this.getElement('matchesDisplay');
    this.movesDisplay = this.getElement('movesDisplay');
    this.difficultySelect = this.getElement('difficultySelect') as HTMLSelectElement;
    this.restartBtn = this.getElement('restartBtn') as HTMLButtonElement;
    this.gameOverModal = this.getElement('gameOverModal');
    this.finalTimeElement = this.getElement('finalTime');
    this.finalMovesElement = this.getElement('finalMoves');
    this.playAgainBtn = this.getElement('playAgainBtn') as HTMLButtonElement;

    this.config = DIFFICULTY_CONFIGS[this.difficulty];

    this.bindEvents();
    this.initGame();
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }

  private bindEvents(): void {
    this.gridContainer.addEventListener('click', this.handleGridClick.bind(this));
    this.gridContainer.addEventListener('keydown', this.handleGridKeydown.bind(this));
    this.difficultySelect.addEventListener('change', this.handleDifficultyChange.bind(this));
    this.restartBtn.addEventListener('click', this.handleRestart.bind(this));
    this.playAgainBtn.addEventListener('click', this.handleRestart.bind(this));
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
    if (this.isProcessing) return;

    const cardId = Number(cardElement.dataset.cardId);
    const card = this.cards.find((c) => c.id === cardId);

    if (!card || card.isFlipped || card.isMatched) return;

    if (!this.isGameStarted) {
      this.startTimer();
    }

    triggerClickAnimation(cardElement);

    this.flipCardState(card, cardElement);
    this.flippedCards.push(card);
    this.moves++;
    updateMovesDisplay(this.movesDisplay, this.moves);

    if (this.flippedCards.length === 2) {
      this.checkMatch();
    }
  }

  private flipCardState(card: CardData, cardElement: HTMLElement): void {
    card.isFlipped = true;
    flipCard(cardElement, true);
  }

  private unflipCardState(card: CardData, cardElement: HTMLElement): void {
    card.isFlipped = false;
    flipCard(cardElement, false);
  }

  private checkMatch(): void {
    this.isProcessing = true;
    const [first, second] = this.flippedCards;
    const firstElement = getCardElementById(this.gridContainer, first.id);
    const secondElement = getCardElementById(this.gridContainer, second.id);

    if (first.symbol === second.symbol) {
      this.handleMatch(first, second, firstElement, secondElement);
    } else {
      this.handleMismatch(first, second, firstElement, secondElement);
    }
  }

  private handleMatch(
    first: CardData,
    second: CardData,
    firstElement: HTMLElement | null,
    secondElement: HTMLElement | null
  ): void {
    first.isMatched = true;
    second.isMatched = true;
    this.matchedPairs++;

    if (firstElement) markCardMatched(firstElement);
    if (secondElement) markCardMatched(secondElement);

    updateMatchesDisplay(this.matchesDisplay, this.matchedPairs, this.config.pairs);

    this.flippedCards = [];
    this.isProcessing = false;

    if (this.matchedPairs === this.config.pairs) {
      this.endGame();
    }
  }

  private handleMismatch(
    first: CardData,
    second: CardData,
    firstElement: HTMLElement | null,
    secondElement: HTMLElement | null
  ): void {
    if (firstElement) markCardWrong(firstElement);
    if (secondElement) markCardWrong(secondElement);

    setTimeout(() => {
      this.unflipCardState(first, firstElement!);
      this.unflipCardState(second, secondElement!);

      if (firstElement) clearCardWrong(firstElement);
      if (secondElement) clearCardWrong(secondElement);

      this.flippedCards = [];
      this.isProcessing = false;
    }, 1000);
  }

  private startTimer(): void {
    this.isGameStarted = true;
    this.startTime = performance.now();
    this.timerInterval = window.setInterval(() => {
      this.elapsedMs = performance.now() - this.startTime;
      updateTimerDisplay(this.timerDisplay, this.elapsedMs);
    }, 100);
  }

  private stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private endGame(): void {
    if (this.isGameStarted) {
      this.elapsedMs = performance.now() - this.startTime;
    }
    this.stopTimer();
    updateTimerDisplay(this.timerDisplay, this.elapsedMs);
    const finalElapsedMs = this.elapsedMs;
    const finalMoves = this.moves;
    setTimeout(() => {
      showGameOverModal(
        this.gameOverModal,
        this.finalTimeElement,
        this.finalMovesElement,
        finalElapsedMs,
        finalMoves
      );
    }, 600);
  }

  private handleDifficultyChange(): void {
    const newDifficulty = this.difficultySelect.value as DifficultyLevel;
    if (newDifficulty === this.difficulty) return;
    this.difficulty = newDifficulty;
    this.config = DIFFICULTY_CONFIGS[this.difficulty];
    this.initGame();
  }

  private handleRestart(): void {
    hideGameOverModal(this.gameOverModal);
    this.initGame();
  }

  private resetState(): void {
    this.stopTimer();
    this.flippedCards = [];
    this.matchedPairs = 0;
    this.moves = 0;
    this.elapsedMs = 0;
    this.isProcessing = false;
    this.isGameStarted = false;
  }

  private initGame(): void {
    this.resetState();

    this.cards = generateCards(this.config.pairs);

    renderGrid(this.gridContainer, this.cards, this.config);
    updateTimerDisplay(this.timerDisplay, 0);
    updateMatchesDisplay(this.matchesDisplay, 0, this.config.pairs);
    updateMovesDisplay(this.movesDisplay, 0);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MemoryGame();
});
