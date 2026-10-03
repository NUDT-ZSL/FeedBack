import type { Book, Note, ReadingStatus } from '../../src/types';

let counter = 0;

export function makeBook(overrides: Partial<Book> = {}): Book {
  counter += 1;
  return {
    id: overrides.id ?? `book-${counter}`,
    title: `Book ${counter}`,
    authors: 'Author',
    status: 'want',
    rating: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeNote(bookId: string, overrides: Partial<Note> = {}): Note {
  counter += 1;
  return {
    id: overrides.id ?? `note-${counter}`,
    bookId,
    content: `note content ${counter}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const ALL_STATUSES: ReadingStatus[] = ['want', 'reading', 'finished'];
