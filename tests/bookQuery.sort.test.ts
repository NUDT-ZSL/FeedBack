import { describe, expect, it } from 'vitest';
import type { Book } from '../src/types';
import { sortBooks } from '../src/utils/bookQuery';
import { makeBook } from './helpers';

const library: Book[] = [
  makeBook('b1', { title: 'C 书', rating: 5, createdAt: '2026-01-03T00:00:00.000Z' }),
  makeBook('b2', { title: 'A 书', rating: 3, createdAt: '2026-01-01T00:00:00.000Z' }),
  makeBook('b3', { title: 'B 书', rating: 4, createdAt: '2026-01-02T00:00:00.000Z' }),
];

function ids(books: Book[]): string[] {
  return books.map((b) => b.id);
}

describe('排序字段与升降序组合', () => {
  it('按评分升序 / 降序', () => {
    expect(ids(sortBooks(library, 'rating', 'asc'))).toEqual(['b2', 'b3', 'b1']);
    expect(ids(sortBooks(library, 'rating', 'desc'))).toEqual(['b1', 'b3', 'b2']);
  });

  it('按标题升序 / 降序', () => {
    expect(ids(sortBooks(library, 'title', 'asc'))).toEqual(['b2', 'b3', 'b1']);
    expect(ids(sortBooks(library, 'title', 'desc'))).toEqual(['b1', 'b3', 'b2']);
  });

  it('按创建时间升序 / 降序', () => {
    expect(ids(sortBooks(library, 'createdAt', 'asc'))).toEqual(['b2', 'b3', 'b1']);
    expect(ids(sortBooks(library, 'createdAt', 'desc'))).toEqual(['b1', 'b3', 'b2']);
  });

  it('默认排序方向为升序', () => {
    expect(ids(sortBooks(library, 'rating'))).toEqual(['b2', 'b3', 'b1']);
  });
});

describe('排序稳定性', () => {
  const tied: Book[] = [
    makeBook('k1', { rating: 4, createdAt: '2026-01-01T00:00:00.000Z' }),
    makeBook('k2', { rating: 4, createdAt: '2026-01-01T00:00:00.000Z' }),
    makeBook('k3', { rating: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    makeBook('k4', { rating: 4, createdAt: '2026-01-01T00:00:00.000Z' }),
  ];

  it('升序时排序键相同的元素保持原有相对顺序', () => {
    expect(ids(sortBooks(tied, 'rating', 'asc'))).toEqual(['k3', 'k1', 'k2', 'k4']);
  });

  it('降序时排序键相同的元素同样保持原有相对顺序', () => {
    expect(ids(sortBooks(tied, 'rating', 'desc'))).toEqual(['k1', 'k2', 'k4', 'k3']);
  });

  it('重复排序结果一致（幂等）', () => {
    const once = sortBooks(tied, 'rating', 'desc');
    const twice = sortBooks(once, 'rating', 'desc');
    expect(ids(twice)).toEqual(ids(once));
  });
});

describe('排序纯度', () => {
  it('不修改入参数组，返回新数组', () => {
    const before = ids(library);
    const sorted = sortBooks(library, 'rating', 'asc');
    expect(ids(library)).toEqual(before);
    expect(sorted).not.toBe(library);
  });

  it('空数组与单元素数组原样返回', () => {
    expect(sortBooks([], 'rating', 'asc')).toEqual([]);
    expect(ids(sortBooks([library[0]], 'rating', 'desc'))).toEqual(['b1']);
  });
});
