import { describe, expect, it } from 'vitest';
import type { Book } from '../src/types';
import {
  ALL_STATUSES,
  makeBook,
} from './helpers/factories';
import {
  applyStatusTransition,
  isValidBookState,
  isValidRating,
  MAX_RATING,
  MIN_RATING,
} from '../src/utils/readingFlow';

const WANT_DAY = '2026-02-01';
const FINISH_DAY = '2026-03-01';

describe('书籍状态流转：想读 -> 在读 -> 读完', () => {
  it('想读 -> 在读：写入开始日期，不写结束日期', () => {
    const want = makeBook({ status: 'want' });
    const reading = applyStatusTransition(want, 'reading', WANT_DAY);

    expect(reading.status).toBe('reading');
    expect(reading.startDate).toBe(WANT_DAY);
    expect(reading.endDate).toBeUndefined();
  });

  it('在读 -> 读完：保留开始日期，写入结束日期', () => {
    const reading = applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY);
    const finished = applyStatusTransition(reading, 'finished', FINISH_DAY);

    expect(finished.status).toBe('finished');
    expect(finished.startDate).toBe(WANT_DAY);
    expect(finished.endDate).toBe(FINISH_DAY);
  });

  it('读完 -> 想读：开始日期与结束日期同时清空，评分归零', () => {
    const finished = applyStatusTransition(
      applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY),
      'finished',
      FINISH_DAY,
    );
    const wantAgain = applyStatusTransition({ ...finished, rating: 5 }, 'want');

    expect(wantAgain.status).toBe('want');
    expect(wantAgain.startDate).toBeUndefined();
    expect(wantAgain.endDate).toBeUndefined();
    expect(wantAgain.rating).toBe(0);
  });

  it('读完 -> 在读（重新开始读）：清空结束日期，保留原开始日期', () => {
    const finished = applyStatusTransition(
      applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY),
      'finished',
      FINISH_DAY,
    );
    const readingAgain = applyStatusTransition(finished, 'reading', '2026-04-01');

    expect(readingAgain.startDate).toBe(WANT_DAY);
    expect(readingAgain.endDate).toBeUndefined();
  });

  it('在读 -> 想读：清空开始日期', () => {
    const reading = applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY);
    const wantAgain = applyStatusTransition(reading, 'want');

    expect(wantAgain.startDate).toBeUndefined();
    expect(wantAgain.endDate).toBeUndefined();
  });

  it('想读 -> 读完：开始日期与结束日期同一天写入', () => {
    const finished = applyStatusTransition(makeBook({ status: 'want' }), 'finished', FINISH_DAY);

    expect(finished.startDate).toBe(FINISH_DAY);
    expect(finished.endDate).toBe(FINISH_DAY);
  });

  it('流转不修改原书籍对象（返回新对象）', () => {
    const want = makeBook({ status: 'want' });
    const snapshot = JSON.stringify(want);
    applyStatusTransition(want, 'reading', WANT_DAY);

    expect(JSON.stringify(want)).toBe(snapshot);
  });
});

describe('评分与状态的合法组合', () => {
  it('任意状态间流转后的结果始终是合法组合', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const start = applyStatusTransition(makeBook({ id: `b-${from}-${to}`, status: 'want' }), from, WANT_DAY);
        const next = applyStatusTransition(start, to, FINISH_DAY);
        expect(isValidBookState(next), `${from} -> ${to} 应产生合法组合`).toBe(true);
      }
    }
  });

  it('评分只能是 0-5 的整数', () => {
    expect([0, 1, 2, 3, 4, 5].every(isValidRating)).toBe(true);
    [-1, 6, 2.5, Number.NaN, Infinity].forEach((rating) => {
      expect(isValidRating(rating), `评分 ${rating} 应非法`).toBe(false);
    });
    expect(MIN_RATING).toBe(0);
    expect(MAX_RATING).toBe(5);
  });

  it('非法组合识别：想读时不允许有评分或日期', () => {
    const illegal: Book[] = [
      { ...makeBook({ status: 'want' }), rating: 3 },
      { ...makeBook({ status: 'want' }), startDate: WANT_DAY },
      { ...makeBook({ status: 'want' }), endDate: FINISH_DAY },
    ];
    illegal.forEach((book) => expect(isValidBookState(book)).toBe(false));
  });

  it('非法组合识别：在读不允许有结束日期，读完必须有结束日期', () => {
    const reading = applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY);
    const finished = applyStatusTransition(reading, 'finished', FINISH_DAY);

    expect(isValidBookState({ ...reading, endDate: FINISH_DAY })).toBe(false);
    expect(isValidBookState({ ...reading, startDate: undefined })).toBe(false);
    expect(isValidBookState({ ...finished, endDate: undefined })).toBe(false);
  });

  it('合法组合通过校验：在读/读完允许 0-5 分', () => {
    const reading = applyStatusTransition(makeBook({ status: 'want' }), 'reading', WANT_DAY);
    const finished = applyStatusTransition(reading, 'finished', FINISH_DAY);

    for (let rating = 0; rating <= 5; rating += 1) {
      expect(isValidBookState({ ...reading, rating })).toBe(true);
      expect(isValidBookState({ ...finished, rating })).toBe(true);
    }
  });
});
