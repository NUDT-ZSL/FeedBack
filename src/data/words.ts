import type { Word, PartOfSpeech, SortOrder } from '../types';

const STORAGE_KEY = 'smart-wordbook:words';

const generateId = (): string => {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const getInitialWords = (): Word[] => {
  const now = Date.now();
  const base: Array<{ english: string; chinese: string; partOfSpeech: PartOfSpeech; mastery?: number; wrongCount?: number; daysSince?: number }> = [
    { english: 'apple', chinese: '苹果', partOfSpeech: 'noun', mastery: 4, wrongCount: 0, daysSince: 1 },
    { english: 'run', chinese: '奔跑', partOfSpeech: 'verb', mastery: 3, wrongCount: 2, daysSince: 5 },
    { english: 'beautiful', chinese: '美丽的', partOfSpeech: 'adjective', mastery: 5, wrongCount: 0, daysSince: 0 },
    { english: 'quickly', chinese: '快速地', partOfSpeech: 'adverb', mastery: 2, wrongCount: 3, daysSince: 10 },
    { english: 'between', chinese: '在...之间', partOfSpeech: 'preposition', mastery: 3, wrongCount: 1, daysSince: 3 },
    { english: 'knowledge', chinese: '知识', partOfSpeech: 'noun', mastery: 2, wrongCount: 4, daysSince: 14 },
    { english: 'develop', chinese: '发展', partOfSpeech: 'verb', mastery: 4, wrongCount: 1, daysSince: 2 },
    { english: 'important', chinese: '重要的', partOfSpeech: 'adjective', mastery: 1, wrongCount: 5, daysSince: 20 },
    { english: 'carefully', chinese: '仔细地', partOfSpeech: 'adverb', mastery: 3, wrongCount: 0, daysSince: 4 },
    { english: 'through', chinese: '穿过', partOfSpeech: 'preposition', mastery: 4, wrongCount: 0, daysSince: 6 },
    { english: 'environment', chinese: '环境', partOfSpeech: 'noun', mastery: 1, wrongCount: 6, daysSince: 30 },
    { english: 'achieve', chinese: '实现', partOfSpeech: 'verb', mastery: 3, wrongCount: 2, daysSince: 8 },
    { english: 'confident', chinese: '自信的', partOfSpeech: 'adjective', mastery: 4, wrongCount: 1, daysSince: 1 },
    { english: 'gradually', chinese: '逐渐地', partOfSpeech: 'adverb', mastery: 2, wrongCount: 2, daysSince: 12 },
    { english: 'without', chinese: '没有', partOfSpeech: 'preposition', mastery: 5, wrongCount: 0, daysSince: 0 },
    { english: 'opportunity', chinese: '机会', partOfSpeech: 'noun', mastery: 3, wrongCount: 1, daysSince: 5 },
    { english: 'communicate', chinese: '交流', partOfSpeech: 'verb', mastery: 2, wrongCount: 3, daysSince: 9 },
    { english: 'patient', chinese: '耐心的', partOfSpeech: 'adjective', mastery: 4, wrongCount: 0, daysSince: 3 },
    { english: 'suddenly', chinese: '突然地', partOfSpeech: 'adverb', mastery: 5, wrongCount: 0, daysSince: 0 },
    { english: 'among', chinese: '在...之中', partOfSpeech: 'preposition', mastery: 3, wrongCount: 2, daysSince: 7 },
    { english: 'responsibility', chinese: '责任', partOfSpeech: 'noun', mastery: 1, wrongCount: 5, daysSince: 18 },
    { english: 'overcome', chinese: '克服', partOfSpeech: 'verb', mastery: 4, wrongCount: 0, daysSince: 2 },
  ];

  return base.map((b) => ({
    id: generateId(),
    english: b.english,
    chinese: b.chinese,
    partOfSpeech: b.partOfSpeech,
    mastery: b.mastery ?? 3,
    wrongCount: b.wrongCount ?? 0,
    lastAttemptAt: b.daysSince !== undefined ? now - b.daysSince * 86400000 : now,
    createdAt: now,
  }));
};

export const loadWords = (): Word[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = getInitialWords();
      saveWords(initial);
      return initial;
    }
    return JSON.parse(raw) as Word[];
  } catch {
    return getInitialWords();
  }
};

export const saveWords = (words: Word[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch {
    // ignore storage errors
  }
};

export interface AddWordPayload {
  english: string;
  chinese: string;
  partOfSpeech: PartOfSpeech;
}

export const addWord = (words: Word[], payload: AddWordPayload): Word[] => {
  const now = Date.now();
  const newWord: Word = {
    id: generateId(),
    english: payload.english.trim().toLowerCase(),
    chinese: payload.chinese.trim(),
    partOfSpeech: payload.partOfSpeech,
    mastery: 1,
    wrongCount: 0,
    lastAttemptAt: now,
    createdAt: now,
  };
  return [newWord, ...words];
};

export const updateMastery = (words: Word[], id: string, mastery: number): Word[] => {
  const clamped = Math.max(1, Math.min(5, mastery));
  return words.map((w) => (w.id === id ? { ...w, mastery: clamped } : w));
};

export const recordAnswer = (words: Word[], id: string, correct: boolean): Word[] => {
  const now = Date.now();
  return words.map((w) => {
    if (w.id !== id) return w;
    return {
      ...w,
      lastAttemptAt: now,
      wrongCount: correct ? w.wrongCount : w.wrongCount + 1,
    };
  });
};

export const filterByParts = (words: Word[], parts: PartOfSpeech[]): Word[] => {
  if (parts.length === 0) return words;
  const set = new Set(parts);
  return words.filter((w) => set.has(w.partOfSpeech));
};

export const sortAlphabetically = (words: Word[], order: SortOrder): Word[] => {
  const sorted = [...words].sort((a, b) => a.english.localeCompare(b.english));
  return order === 'desc' ? sorted.reverse() : sorted;
};

export const getUrgencyScore = (word: Word): number => {
  const now = Date.now();
  const daysSince = (now - word.lastAttemptAt) / 86400000;
  const recencyFactor = Math.min(daysSince / 30, 1) * 45;
  const masteryFactor = Math.max(0, (5 - word.mastery) / 4) * 30;
  const wrongFactor = Math.min(word.wrongCount / 8, 1) * 25;
  return Math.round(recencyFactor + masteryFactor + wrongFactor);
};

export const getMostUrgentWords = (words: Word[], n: number): Word[] => {
  return [...words].sort((a, b) => getUrgencyScore(b) - getUrgencyScore(a)).slice(0, n);
};

export const getUrgencyColor = (score: number): string => {
  if (score >= 70) return '#E74C3C';
  if (score >= 40) return '#F5A623';
  return '#50B86C';
};

export const shuffleArray = <T>(arr: T[]): T[] => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
