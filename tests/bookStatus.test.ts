import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO,
  transitionBookStatus,
  validateBookState,
  isValidBookState,
} from '../src/utils/bookStatus.ts';
import type { Book, ReadingStatus } from '../src/types.ts';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: '测试书籍',
    authors: '测试作者',
    status: 'want',
    rating: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const STATUSES: ReadingStatus[] = ['want', 'reading', 'finished'];

describe('书籍状态流转：日期写入与清空', () => {
  it('想读 → 在读：写入开始日期，结束日期保持为空', () => {
    const result = transitionBookStatus(makeBook(), 'reading', '2026-05-01');
    assert.equal(result.status, 'reading');
    assert.equal(result.startDate, '2026-05-01');
    assert.equal(result.endDate, undefined);
  });

  it('在读 → 读完：保留开始日期，写入结束日期', () => {
    const reading = makeBook({ status: 'reading', startDate: '2026-05-01' });
    const result = transitionBookStatus(reading, 'finished', '2026-06-01');
    assert.equal(result.status, 'finished');
    assert.equal(result.startDate, '2026-05-01');
    assert.equal(result.endDate, '2026-06-01');
  });

  it('读完 → 想读：清空开始日期与结束日期', () => {
    const finished = makeBook({
      status: 'finished',
      rating: 5,
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
    const result = transitionBookStatus(finished, 'want', '2026-07-01');
    assert.equal(result.status, 'want');
    assert.equal(result.startDate, undefined);
    assert.equal(result.endDate, undefined);
  });

  it('完整生命周期 想读→在读→读完→想读 中日期按预期写入与清空', () => {
    const start = makeBook();
    const reading = transitionBookStatus(start, 'reading', '2026-05-01');
    assert.ok(reading.startDate);
    assert.equal(reading.endDate, undefined);

    const finished = transitionBookStatus(reading, 'finished', '2026-06-01');
    assert.equal(finished.startDate, '2026-05-01');
    assert.equal(finished.endDate, '2026-06-01');

    const backToWant = transitionBookStatus(finished, 'want', '2026-07-01');
    assert.equal(backToWant.startDate, undefined);
    assert.equal(backToWant.endDate, undefined);
  });

  it('想读 → 读完（跳过在读）：开始与结束日期均写入', () => {
    const result = transitionBookStatus(makeBook(), 'finished', '2026-06-01');
    assert.equal(result.startDate, '2026-06-01');
    assert.equal(result.endDate, '2026-06-01');
  });

  it('读完 → 在读（回退）：清空结束日期并保留开始日期', () => {
    const finished = makeBook({ status: 'finished', startDate: '2026-05-01', endDate: '2026-06-01' });
    const result = transitionBookStatus(finished, 'reading', '2026-07-01');
    assert.equal(result.startDate, '2026-05-01');
    assert.equal(result.endDate, undefined);
  });

  it('在读 → 读完 保留已有开始日期而不是改写为今天', () => {
    const reading = makeBook({ status: 'reading', startDate: '2025-01-01' });
    const result = transitionBookStatus(reading, 'finished', '2026-06-01');
    assert.equal(result.startDate, '2025-01-01');
    assert.equal(result.endDate, '2026-06-01');
  });

  it('已有结束日期早于开始日期时切换到读完会被纠正为不早于开始日期', () => {
    const bad = makeBook({ status: 'finished', startDate: '2026-06-01', endDate: '2026-01-01' });
    const result = transitionBookStatus(bad, 'finished', '2026-07-01');
    assert.ok(result.endDate! >= result.startDate!);
  });

  it('未显式传入日期时使用当天日期（可重复执行结论稳定）', () => {
    const result = transitionBookStatus(makeBook(), 'reading');
    assert.equal(result.startDate, todayISO());
  });
});

describe('书籍状态流转：评分与状态的合法组合', () => {
  it('在读 → 读完 时保留评分', () => {
    const reading = makeBook({ status: 'reading', rating: 4, startDate: '2026-05-01' });
    const result = transitionBookStatus(reading, 'finished', '2026-06-01');
    assert.equal(result.rating, 4);
  });

  it('读完 → 想读 时评分被清零，避免想读带评分的非法组合', () => {
    const finished = makeBook({
      status: 'finished',
      rating: 5,
      startDate: '2026-05-01',
      endDate: '2026-06-01',
    });
    const result = transitionBookStatus(finished, 'want');
    assert.equal(result.rating, 0);
  });

  it('从任意合法状态出发做任意状态切换，结果始终通过完整合法性校验', () => {
    const validStates: Book[] = [
      makeBook({ status: 'want', rating: 0 }),
      makeBook({ status: 'reading', rating: 3, startDate: '2026-05-01' }),
      makeBook({ status: 'finished', rating: 5, startDate: '2026-05-01', endDate: '2026-06-01' }),
    ];
    for (const state of validStates) {
      for (const next of STATUSES) {
        const result = transitionBookStatus(state, next, '2026-06-01');
        assert.deepEqual(
          validateBookState(result),
          [],
          `${state.status} → ${next} 产生非法组合`,
        );
      }
    }
  });
});

describe('书籍状态合法性校验：非法组合必须被识别', () => {
  const invalidBooks: Array<[string, Book, string]> = [
    ['想读带评分', makeBook({ status: 'want', rating: 3 }), 'rating'],
    ['想读带开始日期', makeBook({ status: 'want', startDate: '2026-05-01' }), 'startDate'],
    ['想读带结束日期', makeBook({ status: 'want', endDate: '2026-06-01' }), 'endDate'],
    ['在读缺少开始日期', makeBook({ status: 'reading', startDate: undefined }), 'startDate'],
    ['在读带结束日期', makeBook({ status: 'reading', startDate: '2026-05-01', endDate: '2026-06-01' }), 'endDate'],
    ['读完缺少开始日期', makeBook({ status: 'finished', startDate: undefined, endDate: '2026-06-01' }), 'startDate'],
    ['读完缺少结束日期', makeBook({ status: 'finished', startDate: '2026-05-01', endDate: undefined }), 'endDate'],
    ['结束日期早于开始日期', makeBook({ status: 'finished', startDate: '2026-06-01', endDate: '2026-05-01' }), 'endDate'],
    ['评分超过 5', makeBook({ status: 'finished', rating: 6, startDate: '2026-05-01', endDate: '2026-06-01' }), 'rating'],
    ['评分为负数', makeBook({ status: 'finished', rating: -1, startDate: '2026-05-01', endDate: '2026-06-01' }), 'rating'],
    ['评分不是整数', makeBook({ status: 'finished', rating: 4.5, startDate: '2026-05-01', endDate: '2026-06-01' }), 'rating'],
  ];

  for (const [label, book, field] of invalidBooks) {
    it(`非法组合「${label}」被定位到字段 ${field}`, () => {
      const violations = validateBookState(book);
      assert.ok(violations.some((v) => v.field === field), `预期 ${field} 字段违规，实际：${JSON.stringify(violations)}`);
      assert.equal(isValidBookState(book), false);
    });
  }

  it('三种合法状态均通过校验', () => {
    assert.equal(isValidBookState(makeBook({ status: 'want', rating: 0 })), true);
    assert.equal(
      isValidBookState(makeBook({ status: 'reading', rating: 0, startDate: '2026-05-01' })),
      true,
    );
    assert.equal(
      isValidBookState(
        makeBook({ status: 'finished', rating: 5, startDate: '2026-05-01', endDate: '2026-06-01' }),
      ),
      true,
    );
  });
});
