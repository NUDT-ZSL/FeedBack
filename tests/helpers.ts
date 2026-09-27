import type { Book, Note } from '../src/types';

export const BOOKS_KEY = 'reading_books';
export const NOTES_KEY = 'reading_notes';

export function makeBook(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    title: `书名-${id}`,
    authors: '作者',
    status: 'reading',
    rating: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeNote(id: string, bookId: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    bookId,
    content: `笔记-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
