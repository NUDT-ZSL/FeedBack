import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './helpers/memoryStorage.mjs';
import {
  getBooks,
  saveBook,
  deleteBook,
  getNotes,
  saveNote,
  deleteNote,
} from '../.test-build/utils/storage.js';

const BOOKS_KEY = 'reading_books';
const NOTES_KEY = 'reading_notes';

const makeBook = (over = {}) => ({
  id: 'b1',
  title: 'Book One',
  authors: 'Author One',
  status: 'reading',
  rating: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const makeNote = (over = {}) => ({
  id: 'n1',
  bookId: 'b1',
  content: 'note content',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

test.beforeEach(() => {
  installLocalStorage();
});

test('getBooks returns empty array when storage key is missing', async () => {
  const books = await getBooks();
  assert.deepEqual(books, []);
});

test('getBooks returns empty array instead of throwing when stored JSON is corrupted', async () => {
  localStorage.setItem(BOOKS_KEY, '{not valid json');
  const books = await getBooks();
  assert.deepEqual(books, []);
});

test('getNotes returns empty array when storage key is missing or corrupted', async () => {
  assert.deepEqual(await getNotes(), []);
  localStorage.setItem(NOTES_KEY, '[[[broken');
  assert.deepEqual(await getNotes(), []);
  assert.deepEqual(await getNotes('b1'), []);
});

test('saveBook appends a book with a new id', async () => {
  await saveBook(makeBook({ id: 'b1' }));
  await saveBook(makeBook({ id: 'b2', title: 'Book Two' }));
  const books = await getBooks();
  assert.equal(books.length, 2);
  assert.deepEqual(books.map((b) => b.id), ['b1', 'b2']);
});

test('saveBook overwrites an existing book with the same id instead of appending', async () => {
  await saveBook(makeBook({ id: 'b1', title: 'Old Title', rating: 1 }));
  await saveBook(makeBook({ id: 'b1', title: 'New Title', rating: 5 }));
  const books = await getBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'New Title');
  assert.equal(books[0].rating, 5);
});

test('saveBook persists under the existing storage key', async () => {
  await saveBook(makeBook());
  assert.ok(localStorage.getItem(BOOKS_KEY) !== null);
});

test('deleteBook removes the book and cascades its notes, keeping other books and notes', async () => {
  await saveBook(makeBook({ id: 'b1' }));
  await saveBook(makeBook({ id: 'b2', title: 'Book Two' }));
  await saveNote(makeNote({ id: 'n1', bookId: 'b1' }));
  await saveNote(makeNote({ id: 'n2', bookId: 'b1', content: 'second' }));
  await saveNote(makeNote({ id: 'n3', bookId: 'b2', content: 'other book' }));

  await deleteBook('b1');

  const books = await getBooks();
  assert.deepEqual(books.map((b) => b.id), ['b2']);

  const remainingNotes = await getNotes();
  assert.deepEqual(remainingNotes.map((n) => n.id), ['n3']);
  assert.deepEqual(await getNotes('b1'), []);
  assert.equal((await getNotes('b2')).length, 1);
});

test('getNotes(bookId) returns only matching notes, getNotes() returns all', async () => {
  await saveNote(makeNote({ id: 'n1', bookId: 'b1' }));
  await saveNote(makeNote({ id: 'n2', bookId: 'b2' }));
  await saveNote(makeNote({ id: 'n3', bookId: 'b1' }));

  assert.deepEqual((await getNotes('b1')).map((n) => n.id), ['n1', 'n3']);
  assert.deepEqual((await getNotes('b2')).map((n) => n.id), ['n2']);
  assert.deepEqual(await getNotes('missing-book'), []);
  assert.equal((await getNotes()).length, 3);
});

test('saveNote appends a new id and overwrites an existing id', async () => {
  await saveNote(makeNote({ id: 'n1', content: 'v1' }));
  await saveNote(makeNote({ id: 'n2', bookId: 'b2' }));
  assert.equal((await getNotes()).length, 2);

  await saveNote(makeNote({ id: 'n1', content: 'v2' }));
  const notes = await getNotes();
  assert.equal(notes.length, 2);
  assert.equal(notes.find((n) => n.id === 'n1').content, 'v2');
});

test('deleteNote removes only the target note', async () => {
  await saveNote(makeNote({ id: 'n1', bookId: 'b1' }));
  await saveNote(makeNote({ id: 'n2', bookId: 'b1' }));
  await deleteNote('n1');
  const notes = await getNotes();
  assert.deepEqual(notes.map((n) => n.id), ['n2']);
});

test('async writes settle to the expected final state after awaiting', async () => {
  const pending = Promise.all([
    saveBook(makeBook({ id: 'b1' })),
    saveBook(makeBook({ id: 'b2' })),
    saveNote(makeNote({ id: 'n1', bookId: 'b1' })),
  ]);
  await pending;
  assert.equal((await getBooks()).length, 2);
  assert.equal((await getNotes()).length, 1);
});
