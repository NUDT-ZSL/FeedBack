import { describe, expect, it } from 'vitest';
import type { Book } from '../src/types';
import { filterBooks, parseTags, queryBooks } from '../src/utils/bookQuery';
import { makeBook } from './helpers';

const library: Book[] = [
  makeBook('b1', { status: 'reading', rating: 5, tags: '科幻, 经典' }),
  makeBook('b2', { status: 'reading', rating: 3, tags: '历史' }),
  makeBook('b3', { status: 'finished', rating: 4, tags: '科幻，文学' }),
  makeBook('b4', { status: 'want', rating: 2, tags: '历史、经典' }),
  makeBook('b5', { status: 'finished', rating: 1 }),
];

describe('parseTags', () => {
  it('兼容中英文逗号、分号、顿号与空白分隔', () => {
    expect(parseTags('科幻, 经典，文学、历史; 哲学；艺术 宗教')).toEqual([
      '科幻',
      '经典',
      '文学',
      '历史',
      '哲学',
      '艺术',
      '宗教',
    ]);
  });

  it('空值与空字符串返回空数组', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('  , ，')).toEqual([]);
  });
});

describe('按阅读状态过滤', () => {
  it('单个状态只返回匹配书籍', () => {
    expect(filterBooks(library, { status: 'reading' }).map((b) => b.id)).toEqual([
      'b1',
      'b2',
    ]);
    expect(filterBooks(library, { status: 'want' }).map((b) => b.id)).toEqual(['b4']);
  });

  it('多个状态取并集', () => {
    const result = filterBooks(library, { status: ['reading', 'want'] });
    expect(result.map((b) => b.id)).toEqual(['b1', 'b2', 'b4']);
  });
});

describe('按标签过滤', () => {
  it('单标签返回包含该标签的书籍', () => {
    expect(filterBooks(library, { tags: ['科幻'] }).map((b) => b.id)).toEqual([
      'b1',
      'b3',
    ]);
  });

  it('多标签要求同时命中（交集）', () => {
    expect(filterBooks(library, { tags: ['科幻', '经典'] }).map((b) => b.id)).toEqual([
      'b1',
    ]);
    expect(filterBooks(library, { tags: ['历史', '经典'] }).map((b) => b.id)).toEqual([
      'b4',
    ]);
  });

  it('无标签的书籍不会被标签条件命中', () => {
    const result = filterBooks(library, { tags: ['经典'] });
    expect(result.map((b) => b.id)).toEqual(['b1', 'b4']);
  });
});

describe('按评分区间过滤', () => {
  it('区间边界为包含关系', () => {
    expect(
      filterBooks(library, { minRating: 2, maxRating: 4 }).map((b) => b.id),
    ).toEqual(['b2', 'b3', 'b4']);
  });

  it('只给下限或只给上限也可过滤', () => {
    expect(filterBooks(library, { minRating: 4 }).map((b) => b.id)).toEqual([
      'b1',
      'b3',
    ]);
    expect(filterBooks(library, { maxRating: 2 }).map((b) => b.id)).toEqual([
      'b4',
      'b5',
    ]);
  });
});

describe('多条件叠加取交集', () => {
  it('状态 + 标签 + 评分区间同时生效', () => {
    const result = filterBooks(library, {
      status: ['reading', 'finished'],
      tags: ['科幻'],
      minRating: 4,
    });
    expect(result.map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('交集为空时返回空数组', () => {
    const result = filterBooks(library, { status: 'want', minRating: 5 });
    expect(result).toEqual([]);
  });

  it('queryBooks 先过滤再排序，组合链路一致', () => {
    const result = queryBooks(
      library,
      { status: ['reading', 'finished'], minRating: 3 },
      { field: 'rating', order: 'desc' },
    );
    expect(result.map((b) => b.id)).toEqual(['b1', 'b3', 'b2']);
  });
});
