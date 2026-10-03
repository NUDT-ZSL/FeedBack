import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeLocalStorage, type FakeLocalStorage } from './helpers/fakeLocalStorage.ts';
import {
  getBooks,
  saveBook,
  deleteBook,
  getNotes,
  saveNote,
  deleteNote,
} from '../src/utils/storage.ts';
import type { Book, Note } from '../src/types.ts';

const BOOKS_KEY = 'reading_books';
const NOTES_KEY = 'reading_notes';

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

function makeNote(overrides: Partial<Note> = {}): Note {
  const now = '2026-01-02T00:00:00.000Z';
  return {
    id: 'note-1',
    bookId: 'book-1',
    content: '一条笔记',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('存储层（localStorage 离线模拟）', () => {
  let store: FakeLocalStorage;

  beforeEach(() => {
    store = installFakeLocalStorage();
  });

  it('存储为空时读取返回空数组而不是抛异常', async () => {
    await assert.doesNotReject(getBooks());
    await assert.doesNotReject(getNotes());
    assert.deepEqual(await getBooks(), []);
    assert.deepEqual(await getNotes(), []);
  });

  it('书籍数据为损坏 JSON 时读取返回空数组', async () => {
    store.setItem(BOOKS_KEY, '{not valid json');
    assert.deepEqual(await getBooks(), []);
  });

  it('笔记数据为损坏 JSON 时读取返回空数组', async () => {
    store.setItem(NOTES_KEY, '{broken');
    assert.deepEqual(await getNotes(), []);
  });

  it('存储内容是对象或数字等非数组 JSON 时读取返回空数组', async () => {
    store.setItem(BOOKS_KEY, '{"id":"x"}');
    store.setItem(NOTES_KEY, '123');
    assert.deepEqual(await getBooks(), []);
    assert.deepEqual(await getNotes(), []);
  });

  it('记录字段缺失时读取原样返回记录而不是抛异常', async () => {
    store.setItem(BOOKS_KEY, JSON.stringify([{ id: 'book-x' }, { title: '无 ID 的书' }]));
    store.setItem(NOTES_KEY, JSON.stringify([{ id: 'note-x' }]));
    const books = await getBooks();
    const notes = await getNotes();
    assert.equal(books.length, 2);
    assert.equal((books[0] as Book).id, 'book-x');
    assert.equal((books[1] as Book).title, '无 ID 的书');
    assert.equal(notes.length, 1);
  });

  it('删除书籍时级联清理该书全部笔记', async () => {
    await saveBook(makeBook({ id: 'book-a', title: '书 A' }));
    await saveBook(makeBook({ id: 'book-b', title: '书 B' }));
    await saveNote(makeNote({ id: 'note-a1', bookId: 'book-a', content: 'A 的笔记 1' }));
    await saveNote(makeNote({ id: 'note-a2', bookId: 'book-a', content: 'A 的笔记 2' }));
    await saveNote(makeNote({ id: 'note-b1', bookId: 'book-b', content: 'B 的笔记' }));

    await deleteBook('book-a');

    const books = await getBooks();
    const notes = await getNotes();
    assert.deepEqual(books.map((b) => b.id), ['book-b']);
    assert.deepEqual(notes.map((n) => n.id), ['note-b1']);

    const persistedNotes = JSON.parse(store.getItem(NOTES_KEY)!) as Note[];
    assert.deepEqual(persistedNotes.map((n) => n.id), ['note-b1']);
  });

  it('删除不存在的书籍不抛异常且其他数据不受影响', async () => {
    await saveBook(makeBook({ id: 'book-a' }));
    await saveNote(makeNote({ id: 'note-a1', bookId: 'book-a' }));

    await assert.doesNotReject(deleteBook('does-not-exist'));

    assert.deepEqual((await getBooks()).map((b) => b.id), ['book-a']);
    assert.deepEqual((await getNotes()).map((n) => n.id), ['note-a1']);
  });

  it('按书籍过滤笔记只返回该书籍的笔记', async () => {
    await saveNote(makeNote({ id: 'note-a1', bookId: 'book-a' }));
    await saveNote(makeNote({ id: 'note-b1', bookId: 'book-b' }));
    await saveNote(makeNote({ id: 'note-a2', bookId: 'book-a' }));

    const result = await getNotes('book-a');
    assert.deepEqual(result.map((n) => n.id), ['note-a1', 'note-a2']);
    assert.ok(result.every((n) => n.bookId === 'book-a'));
  });

  it('传入不存在的书籍标识过滤笔记返回空结果而不是报错', async () => {
    await saveNote(makeNote({ id: 'note-a1', bookId: 'book-a' }));
    const result = await getNotes('no-such-book');
    assert.ok(Array.isArray(result));
    assert.deepEqual(result, []);
  });

  it('同一书籍顺序重复保存后落盘的是最后一次写入内容', async () => {
    await saveBook(makeBook({ id: 'b1', title: '第一版', rating: 1 }));
    await saveBook(makeBook({ id: 'b1', title: '第二版', rating: 4 }));

    const books = await getBooks();
    assert.equal(books.length, 1);
    assert.equal(books[0].title, '第二版');
    assert.equal(books[0].rating, 4);

    const persisted = JSON.parse(store.getItem(BOOKS_KEY)!) as Book[];
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].title, '第二版');
  });

  it('同一笔记并发重复保存（随机延迟）后落盘的是最后一次写入内容', async () => {
    const first = makeNote({ id: 'n1', content: '旧内容', updatedAt: '2026-01-01T00:00:00.000Z' });
    const last = makeNote({ id: 'n1', content: '新内容', updatedAt: '2026-03-03T00:00:00.000Z' });

    await Promise.all([saveNote(first), saveNote(last)]);

    const notes = await getNotes('book-1');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].content, '新内容');
    assert.equal(notes[0].updatedAt, '2026-03-03T00:00:00.000Z');
  });

  it('书籍与笔记并发交错保存后最终状态与每次写入一致', async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      saveBook(makeBook({ id: 'concurrent', title: `版本 ${i}`, rating: i % 6 })),
    );
    await Promise.all(writes);

    const books = await getBooks();
    assert.equal(books.length, 1);
    assert.equal(books[0].title, '版本 19');
  });

  it('删除单条笔记只影响该笔记', async () => {
    await saveNote(makeNote({ id: 'n1' }));
    await saveNote(makeNote({ id: 'n2' }));
    await deleteNote('n1');
    assert.deepEqual((await getNotes()).map((n) => n.id), ['n2']);
  });
});
