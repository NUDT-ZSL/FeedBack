import type { Book, Note } from '../types';

const BOOKS_KEY = 'reading_books';
const NOTES_KEY = 'reading_notes';

function delay<T>(value: T, ms: number = Math.random() * 50): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function readJSON<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeJSON<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

export function getBooks(): Promise<Book[]> {
  return delay(readJSON<Book>(BOOKS_KEY));
}

export function saveBook(book: Book): Promise<Book> {
  const books = readJSON<Book>(BOOKS_KEY);
  const index = books.findIndex((b) => b.id === book.id);
  if (index >= 0) {
    books[index] = book;
  } else {
    books.push(book);
  }
  writeJSON(BOOKS_KEY, books);
  return delay(book);
}

export function deleteBook(id: string): Promise<void> {
  const books = readJSON<Book>(BOOKS_KEY).filter((b) => b.id !== id);
  writeJSON(BOOKS_KEY, books);
  const notes = readJSON<Note>(NOTES_KEY).filter((n) => n.bookId !== id);
  writeJSON(NOTES_KEY, notes);
  return delay(undefined);
}

export function getNotes(bookId?: string): Promise<Note[]> {
  const notes = readJSON<Note>(NOTES_KEY);
  const result = bookId ? notes.filter((n) => n.bookId === bookId) : notes;
  return delay(result);
}

export function saveNote(note: Note): Promise<Note> {
  const notes = readJSON<Note>(NOTES_KEY);
  const index = notes.findIndex((n) => n.id === note.id);
  if (index >= 0) {
    notes[index] = note;
  } else {
    notes.push(note);
  }
  writeJSON(NOTES_KEY, notes);
  return delay(note);
}

export function deleteNote(id: string): Promise<void> {
  const notes = readJSON<Note>(NOTES_KEY).filter((n) => n.id !== id);
  writeJSON(NOTES_KEY, notes);
  return delay(undefined);
}
