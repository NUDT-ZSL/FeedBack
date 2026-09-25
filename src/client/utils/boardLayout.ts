import { InspirationCard } from '../../types';

export const STORAGE_KEY = 'inspiration_board_layout';

export interface BoardGroups {
  [bookId: string]: InspirationCard[];
}

function isValidCard(card: unknown): card is InspirationCard {
  const c = card as InspirationCard;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.noteId === 'string' &&
    typeof c.bookId === 'string'
  );
}

function groupCards(cards: InspirationCard[]): BoardGroups {
  const groups: BoardGroups = {};
  cards.forEach((card) => {
    if (!isValidCard(card)) return;
    (groups[card.bookId] = groups[card.bookId] || []).push(card);
  });
  return groups;
}

export function loadLayout(): BoardGroups {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // 旧格式：一维卡片数组，读入后按 bookId 重新分组
    if (Array.isArray(data)) {
      return groupCards(data);
    }
    // 新格式：{ version: 2, groups: { [bookId]: InspirationCard[] } }
    if (data && typeof data === 'object' && data.groups && typeof data.groups === 'object') {
      const groups: BoardGroups = {};
      Object.entries(data.groups as Record<string, unknown>).forEach(([bookId, cards]) => {
        if (!Array.isArray(cards)) return;
        const valid = cards.filter(isValidCard);
        if (valid.length > 0) groups[bookId] = valid;
      });
      return groups;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveLayout(groups: BoardGroups): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, groups }));
}

export function findCard(groups: BoardGroups, cardId: string): InspirationCard | undefined {
  for (const cards of Object.values(groups)) {
    const found = cards.find((c) => c.id === cardId);
    if (found) return found;
  }
  return undefined;
}
