declare const require: (moduleName: string) => unknown;

import type { Word } from '../types';
import {
  getUrgencyScore,
  getUrgencyColor,
  rankWordsByUrgency,
  selectMostUrgentWords,
  filterWordsNeedingReview,
  countWordsNeedingReview,
} from '../utils/urgency';

const assert = require('node:assert/strict') as {
  equal(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
};
const { test } = require('node:test') as {
  test(name: string, fn: () => void): void;
};

const DAY_MS = 86_400_000;
const NOW = 100_000_000_000;

let sequence = 0;

const makeWord = (overrides: Partial<Word> = {}): Word => ({
  id: `word-${sequence++}`,
  english: `word-${sequence}`,
  chinese: '单词',
  partOfSpeech: 'noun',
  mastery: 5,
  wrongCount: 0,
  lastAttemptAt: NOW,
  createdAt: NOW,
  ...overrides,
});

test('time decay is capped at 30 days', () => {
  const atCap = makeWord({
    mastery: 1,
    wrongCount: 8,
    lastAttemptAt: NOW - 30 * DAY_MS,
  });
  const beyondCap = makeWord({
    mastery: 1,
    wrongCount: 8,
    lastAttemptAt: NOW - 60 * DAY_MS,
  });

  assert.equal(getUrgencyScore(atCap, NOW), 100);
  assert.equal(getUrgencyScore(beyondCap, NOW), 100);
});

test('future and current attempts contribute no time decay', () => {
  const currentAttempt = makeWord({ mastery: 5, wrongCount: 0 });
  const futureAttempt = makeWord({
    mastery: 5,
    wrongCount: 0,
    lastAttemptAt: NOW + DAY_MS,
  });

  assert.equal(getUrgencyScore(currentAttempt, NOW), 0);
  assert.equal(getUrgencyScore(futureAttempt, NOW), 0);
});

test('wrong count is capped at 8', () => {
  const atCap = makeWord({ mastery: 1, wrongCount: 8 });
  const beyondCap = makeWord({ mastery: 1, wrongCount: 100 });

  assert.equal(getUrgencyScore(atCap, NOW), 55);
  assert.equal(getUrgencyScore(beyondCap, NOW), 55);
});

test('mastery extremes and out-of-range values are clamped', () => {
  const mastered = makeWord({ mastery: 5 });
  const weakest = makeWord({ mastery: 1 });
  const belowRange = makeWord({ mastery: 0 });
  const aboveRange = makeWord({ mastery: 6 });

  assert.equal(getUrgencyScore(mastered, NOW), 0);
  assert.equal(getUrgencyScore(weakest, NOW), 30);
  assert.equal(getUrgencyScore(belowRange, NOW), 30);
  assert.equal(getUrgencyScore(aboveRange, NOW), 0);
});

test('color thresholds remain red, orange, and green', () => {
  assert.equal(getUrgencyColor(100), '#E74C3C');
  assert.equal(getUrgencyColor(70), '#E74C3C');
  assert.equal(getUrgencyColor(69), '#F5A623');
  assert.equal(getUrgencyColor(40), '#F5A623');
  assert.equal(getUrgencyColor(39), '#50B86C');
  assert.equal(getUrgencyColor(0), '#50B86C');
});

test('quick review selection is exactly the first N words from urgency ranking', () => {
  const low = makeWord({ mastery: 5, wrongCount: 0 });
  const medium = makeWord({
    mastery: 5,
    wrongCount: 8,
    lastAttemptAt: NOW - 10 * DAY_MS,
  });
  const high = makeWord({
    mastery: 1,
    wrongCount: 8,
    lastAttemptAt: NOW - 30 * DAY_MS,
  });
  const words = [low, high, medium];

  assert.equal(getUrgencyScore(medium, NOW), 40);
  assert.deepEqual(rankWordsByUrgency(words, NOW), [high, medium, low]);
  assert.deepEqual(selectMostUrgentWords(words, 2, NOW), [high, medium]);
  assert.deepEqual(filterWordsNeedingReview(words, NOW), [high, medium]);
  assert.equal(countWordsNeedingReview(words, NOW), 2);
});

test('equal scores use stable deterministic tie-breakers', () => {
  const earlierA = makeWord({ id: 'a', createdAt: 1 });
  const earlierB = makeWord({ id: 'b', createdAt: 1 });
  const laterC = makeWord({ id: 'c', createdAt: 2 });

  assert.deepEqual(
    rankWordsByUrgency([laterC, earlierB, earlierA], NOW),
    [earlierA, earlierB, laterC],
  );
});

test('empty input returns empty results and zero count', () => {
  assert.deepEqual(rankWordsByUrgency([], NOW), []);
  assert.deepEqual(selectMostUrgentWords([], 10, NOW), []);
  assert.deepEqual(filterWordsNeedingReview([], NOW), []);
  assert.equal(countWordsNeedingReview([], NOW), 0);
});

test('repeated calls at the same time basis are identical', () => {
  const words = [
    makeWord({ mastery: 2, wrongCount: 3, lastAttemptAt: NOW - 5 * DAY_MS }),
    makeWord({ mastery: 4, wrongCount: 1, lastAttemptAt: NOW - 20 * DAY_MS }),
    makeWord({ mastery: 1, wrongCount: 8, lastAttemptAt: NOW - 30 * DAY_MS }),
  ];

  const firstRanking = rankWordsByUrgency(words, NOW);
  const secondRanking = rankWordsByUrgency(words, NOW);

  assert.deepEqual(secondRanking, firstRanking);
  assert.deepEqual(selectMostUrgentWords(words, 2, NOW), firstRanking.slice(0, 2));
  assert.equal(
    countWordsNeedingReview(words, NOW),
    filterWordsNeedingReview(words, NOW).length,
  );
});
