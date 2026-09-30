import type { Word } from '../types';

const MS_PER_DAY = 86_400_000;
const MAX_RECENCY_DAYS = 30;
const MAX_WRONG_COUNT = 8;

const RECENCY_WEIGHT = 45;
const MASTERY_WEIGHT = 30;
const WRONG_WEIGHT = 25;

export const URGENCY_REVIEW_THRESHOLD = 40;
export const URGENCY_HIGH_THRESHOLD = 70;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function getUrgencyScore(word: Word, now: number): number {
  const elapsedDays = Math.max(0, (now - word.lastAttemptAt) / MS_PER_DAY);
  const recencyScore = clamp01(elapsedDays / MAX_RECENCY_DAYS) * RECENCY_WEIGHT;
  const masteryScore = clamp01((5 - word.mastery) / 4) * MASTERY_WEIGHT;
  const wrongScore = clamp01(word.wrongCount / MAX_WRONG_COUNT) * WRONG_WEIGHT;

  return Math.round(clamp01((recencyScore + masteryScore + wrongScore) / 100) * 100);
}

function compareByUrgency(a: Word, b: Word, now: number): number {
  const scoreDifference = getUrgencyScore(b, now) - getUrgencyScore(a, now);
  if (scoreDifference !== 0) return scoreDifference;

  const createdDifference = a.createdAt - b.createdAt;
  if (createdDifference !== 0) return createdDifference;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankWordsByUrgency(words: readonly Word[], now: number): Word[] {
  return [...words].sort((a, b) => compareByUrgency(a, b, now));
}

export function selectMostUrgentWords(words: readonly Word[], count: number, now: number): Word[] {
  const limit = Math.max(0, Math.floor(count));
  return rankWordsByUrgency(words, now).slice(0, limit);
}

export const getMostUrgentWords = selectMostUrgentWords;

export function isWordNeedingReview(word: Word, now: number): boolean {
  return getUrgencyScore(word, now) >= URGENCY_REVIEW_THRESHOLD;
}

export function filterWordsNeedingReview(words: readonly Word[], now: number): Word[] {
  return words.filter((word) => isWordNeedingReview(word, now));
}

export function countWordsNeedingReview(words: readonly Word[], now: number): number {
  return filterWordsNeedingReview(words, now).length;
}

export function getUrgencyColor(score: number): string {
  if (score >= URGENCY_HIGH_THRESHOLD) return '#E74C3C';
  if (score >= URGENCY_REVIEW_THRESHOLD) return '#F5A623';
  return '#50B86C';
}
