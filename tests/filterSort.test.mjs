import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterBooks,
  sortBooks,
  queryBooks,
  parseTags,
} from '../.test-build/utils/filterSort.js';

const books = [
  { id: 'a', title: 'Alpha', status: 'reading', rating: 5, tags: '科幻, 经典', createdAt: '2026-01-03T00:00:00.000Z' },
  { id: 'b', title: 'Beta', status: 'finished', rating: 3, tags: '历史', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'c', title: 'Gamma', status: 'want', rating: 4, tags: '科幻', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'd', title: 'Delta', status: 'reading', rating: 2, tags: '', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'e', title: 'Epsilon', status: 'finished', rating: 4, createdAt: '2026-01-04T00:00:00.000Z' },
];

const ids = (list) => list.map((b) => b.id);

test('parseTags splits on commas, trims and drops empties', () => {
  assert.deepEqual(parseTags('科幻, 经典，历史'), ['科幻', '经典', '历史']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(undefined), []);
});

test('filter by a single reading status', () => {
  assert.deepEqual(ids(filterBooks(books, { status: 'reading' })), ['a', 'd']);
  assert.deepEqual(ids(filterBooks(books, { status: 'want' })), ['c']);
});

test('filter by multiple reading statuses', () => {
  assert.deepEqual(
    ids(filterBooks(books, { status: ['reading', 'want'] })),
    ['a', 'c', 'd'],
  );
});

test('filter by tag matches any of the given tags', () => {
  assert.deepEqual(ids(filterBooks(books, { tags: ['科幻'] })), ['a', 'c']);
  assert.deepEqual(ids(filterBooks(books, { tags: ['历史', '经典'] })), ['a', 'b']);
  assert.deepEqual(ids(filterBooks(books, { tags: ['不存在'] })), []);
});

test('filter by rating range, inclusive bounds', () => {
  assert.deepEqual(ids(filterBooks(books, { minRating: 3, maxRating: 4 })), ['b', 'c', 'e']);
  assert.deepEqual(ids(filterBooks(books, { minRating: 5 })), ['a']);
  assert.deepEqual(ids(filterBooks(books, { maxRating: 2 })), ['d']);
});

test('combined filters intersect (status + tag + rating)', () => {
  assert.deepEqual(
    ids(filterBooks(books, { status: 'reading', tags: ['科幻'], minRating: 4 })),
    ['a'],
  );
  assert.deepEqual(
    ids(filterBooks(books, { status: ['reading', 'finished'], minRating: 4, maxRating: 5 })),
    ['a', 'e'],
  );
  assert.deepEqual(
    ids(filterBooks(books, { status: 'want', tags: ['历史'] })),
    [],
  );
});

test('empty filter returns all books in original order', () => {
  assert.deepEqual(ids(filterBooks(books, {})), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids(filterBooks(books)), ['a', 'b', 'c', 'd', 'e']);
});

test('sort by rating ascending and descending', () => {
  assert.deepEqual(ids(sortBooks(books, 'rating', 'asc')), ['d', 'b', 'c', 'e', 'a']);
  assert.deepEqual(ids(sortBooks(books, 'rating', 'desc')), ['a', 'c', 'e', 'b', 'd']);
});

test('sort by title in both directions', () => {
  assert.deepEqual(ids(sortBooks(books, 'title', 'asc')), ['a', 'b', 'd', 'e', 'c']);
  assert.deepEqual(ids(sortBooks(books, 'title', 'desc')), ['c', 'e', 'd', 'b', 'a']);
});

test('sort by createdAt keeps stable order for equal keys', () => {
  const asc = sortBooks(books, 'createdAt', 'asc');
  assert.deepEqual(ids(asc), ['b', 'c', 'd', 'a', 'e']);
  // c and d share the same createdAt; original relative order must be kept.
  assert.ok(ids(asc).indexOf('c') < ids(asc).indexOf('d'));

  const desc = sortBooks(books, 'createdAt', 'desc');
  assert.deepEqual(ids(desc), ['e', 'a', 'c', 'd', 'b']);
  assert.ok(ids(desc).indexOf('c') < ids(desc).indexOf('d'));
});

test('sort by rating keeps stable order for equal ratings', () => {
  const sorted = sortBooks(books, 'rating', 'asc');
  // c and e both have rating 4; c appears first in the source array.
  assert.ok(ids(sorted).indexOf('c') < ids(sorted).indexOf('e'));
});

test('sortBooks does not mutate the input array', () => {
  const before = ids(books);
  sortBooks(books, 'rating', 'asc');
  assert.deepEqual(ids(books), before);
});

test('queryBooks applies filter and sort together', () => {
  const result = queryBooks(
    books,
    { status: ['reading', 'finished'], minRating: 3 },
    { field: 'rating', order: 'desc' },
  );
  assert.deepEqual(ids(result), ['a', 'e', 'b']);

  const filteredOnly = queryBooks(books, { tags: ['科幻'] });
  assert.deepEqual(ids(filteredOnly), ['a', 'c']);
});
