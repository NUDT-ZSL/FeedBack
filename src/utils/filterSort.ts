import type { Book, ReadingStatus } from '../types';

export interface BookFilter {
  status?: ReadingStatus | ReadingStatus[];
  tags?: string[];
  minRating?: number;
  maxRating?: number;
}

export type BookSortField = 'title' | 'rating' | 'createdAt';
export type SortOrder = 'asc' | 'desc';

export interface BookSort {
  field: BookSortField;
  order?: SortOrder;
}

export function parseTags(tags?: string): string[] {
  if (!tags) return [];
  return tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function filterBooks(books: Book[], filter: BookFilter = {}): Book[] {
  const { status, tags, minRating, maxRating } = filter;
  const statuses =
    status == null ? null : new Set(Array.isArray(status) ? status : [status]);
  const wantedTags =
    tags && tags.length > 0 ? new Set(tags.map((t) => t.trim())) : null;
  return books.filter((book) => {
    if (statuses && !statuses.has(book.status)) return false;
    if (wantedTags) {
      const bookTags = parseTags(book.tags);
      if (!bookTags.some((t) => wantedTags.has(t))) return false;
    }
    if (minRating != null && book.rating < minRating) return false;
    if (maxRating != null && book.rating > maxRating) return false;
    return true;
  });
}

export function sortBooks(
  books: Book[],
  field: BookSortField,
  order: SortOrder = 'asc',
): Book[] {
  const direction = order === 'desc' ? -1 : 1;
  return [...books].sort((a, b) => {
    let cmp: number;
    if (field === 'rating') {
      cmp = a.rating - b.rating;
    } else {
      cmp = String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
    }
    return cmp * direction;
  });
}

export function queryBooks(
  books: Book[],
  filter: BookFilter = {},
  sort?: BookSort,
): Book[] {
  const filtered = filterBooks(books, filter);
  return sort ? sortBooks(filtered, sort.field, sort.order ?? 'asc') : filtered;
}
