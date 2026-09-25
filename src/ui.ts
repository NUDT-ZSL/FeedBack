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

export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateCards(pairsCount: number): CardData[] {
  const selectedEmojis = shuffleArray(EMOJI_POOL).slice(0, pairsCount);
  const cardPairs: CardData[] = [];
  let id = 0;

  for (const emoji of selectedEmojis) {
    cardPairs.push(
      { id: id++, symbol: emoji, isFlipped: false, isMatched: false },
      { id: id++, symbol: emoji, isFlipped: false, isMatched: false }
    );
  }

  return shuffleArray(cardPairs);
}

export function createCardElement(card: CardData): HTMLDivElement {
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  cardElement.dataset.cardId = String(card.id);
  cardElement.setAttribute('role', 'button');
  cardElement.setAttribute('tabindex', '0');
  cardElement.setAttribute('aria-label', '未翻开的卡片');

  const inner = document.createElement('div');
  inner.className = 'card__inner';

  const backFace = document.createElement('div');
  backFace.className = 'card__face card__face--back';

  const frontFace = document.createElement('div');
  frontFace.className = 'card__face card__face--front';
  frontFace.textContent = card.symbol;

  inner.appendChild(backFace);
  inner.appendChild(frontFace);
  cardElement.appendChild(inner);

  return cardElement;
}

export function renderGrid(
  gridContainer: HTMLElement,
  cards: CardData[],
  config: DifficultyConfig
): void {
  gridContainer.innerHTML = '';
  gridContainer.style.gridTemplateColumns = `repeat(${config.cols}, auto)`;
  gridContainer.style.gridTemplateRows = `repeat(${config.rows}, auto)`;

  const fragment = document.createDocumentFragment();
  for (const card of cards) {
    fragment.appendChild(createCardElement(card));
  }
  gridContainer.appendChild(fragment);
}

export function updateTimerDisplay(element: HTMLElement, elapsedMs: number): void {
  const seconds = (elapsedMs / 1000).toFixed(1);
  element.textContent = `${seconds}s`;
}

export function updateMatchesDisplay(
  element: HTMLElement,
  matched: number,
  total: number
): void {
  element.textContent = `${matched} / ${total}`;
}

export function updateMovesDisplay(element: HTMLElement, moves: number): void {
  element.textContent = String(moves);
}

export function flipCard(cardElement: HTMLElement, flip: boolean): void {
  if (flip) {
    cardElement.classList.add('card--flipped');
  } else {
    cardElement.classList.remove('card--flipped');
  }
}

export function markCardMatched(cardElement: HTMLElement): void {
  cardElement.classList.remove('card--flipped');
  cardElement.classList.add('card--matched');
  const frontFace = cardElement.querySelector('.card__face--front');
  if (frontFace) {
    frontFace.setAttribute('aria-label', '已匹配');
  }
}

export function markCardWrong(cardElement: HTMLElement): void {
  cardElement.classList.add('card--wrong');
}

export function clearCardWrong(cardElement: HTMLElement): void {
  cardElement.classList.remove('card--wrong');
}

export function triggerClickAnimation(cardElement: HTMLElement): void {
  cardElement.classList.remove('card--clicking');
  void cardElement.offsetWidth;
  cardElement.classList.add('card--clicking');
  setTimeout(() => {
    cardElement.classList.remove('card--clicking');
  }, 150);
}

export function showGameOverModal(
  modal: HTMLElement,
  finalTimeElement: HTMLElement,
  finalMovesElement: HTMLElement,
  elapsedMs: number,
  moves: number
): void {
  finalTimeElement.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
  finalMovesElement.textContent = String(moves);
  modal.classList.remove('hidden');
}

export function hideGameOverModal(modal: HTMLElement): void {
  modal.classList.add('hidden');
}

export function getCardElementById(
  gridContainer: HTMLElement,
  cardId: number
): HTMLElement | null {
  return gridContainer.querySelector(`[data-card-id="${cardId}"]`);
}
