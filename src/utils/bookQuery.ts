import type { Book, ReadingStatus } from '../types';

/** 书籍筛选条件。所有条件同时生效，结果为交集。 */
export interface BookFilter {
  /** 阅读状态，可传单个或多个（任一命中即可） */
  status?: ReadingStatus | ReadingStatus[];
  /** 标签集合，书籍需同时包含全部给定标签 */
  tags?: string[];
  /** 评分下限（含） */
  minRating?: number;
  /** 评分上限（含） */
  maxRating?: number;
}

export type BookSortField = 'createdAt' | 'rating' | 'title';
export type SortOrder = 'asc' | 'desc';

export interface BookSort {
  field: BookSortField;
  order: SortOrder;
}

/** 将书籍的 tags 字符串解析为标签数组，兼容中英文逗号、分号、顿号与空白分隔。 */
export function parseTags(tags?: string): string[] {
  if (!tags) return [];
  return tags
    .split(/[,，、;；\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 按状态 / 标签 / 评分区间过滤，多条件取交集。不修改入参数组。 */
export function filterBooks(books: Book[], filter: BookFilter = {}): Book[] {
  const statuses = filter.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : null;
  const tags = filter.tags && filter.tags.length > 0 ? filter.tags : null;
  const { minRating, maxRating } = filter;

  return books.filter((book) => {
    if (statuses && !statuses.includes(book.status)) return false;
    if (tags) {
      const bookTags = parseTags(book.tags);
      if (!tags.every((t) => bookTags.includes(t))) return false;
    }
    if (minRating !== undefined && book.rating < minRating) return false;
    if (maxRating !== undefined && book.rating > maxRating) return false;
    return true;
  });
}

function compareBooks(a: Book, b: Book, field: BookSortField): number {
  switch (field) {
    case 'rating':
      return a.rating - b.rating;
    case 'title':
      return a.title.localeCompare(b.title);
    case 'createdAt':
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }
}

/**
 * 按字段与升降序排序。返回新数组，不修改入参；
 * 排序是稳定的：排序键相同的元素保持原有相对顺序。
 */
export function sortBooks(
  books: Book[],
  field: BookSortField,
  order: SortOrder = 'asc',
): Book[] {
  const direction = order === 'desc' ? -1 : 1;
  return books
    .map((book, index) => ({ book, index }))
    .sort((x, y) => {
      const cmp = compareBooks(x.book, y.book, field);
      return cmp !== 0 ? cmp * direction : x.index - y.index;
    })
    .map((entry) => entry.book);
}

/** 筛选 + 排序的组合链路：先过滤取交集，再稳定排序。 */
export function queryBooks(
  books: Book[],
  filter: BookFilter = {},
  sort?: BookSort,
): Book[] {
  const filtered = filterBooks(books, filter);
  return sort ? sortBooks(filtered, sort.field, sort.order) : filtered;
}
