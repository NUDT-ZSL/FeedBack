import { describe, expect, it } from 'vitest';
import {
  deleteBook,
  getBooks,
  getNotes,
  saveBook,
  saveNote,
} from '../src/utils/storage';
import { BOOKS_KEY, NOTES_KEY, makeBook, makeNote } from './helpers';

describe('存储读取容错', () => {
  it('localStorage 无任何数据时，getBooks / getNotes 返回空数组而不抛错', async () => {
    await expect(getBooks()).resolves.toEqual([]);
    await expect(getNotes()).resolves.toEqual([]);
    await expect(getNotes('any-book')).resolves.toEqual([]);
  });

  it('存储内容损坏（非法 JSON）时返回空数组而不抛错', async () => {
    localStorage.setItem(BOOKS_KEY, '{broken json');
    localStorage.setItem(NOTES_KEY, 'not-json-at-all');
    await expect(getBooks()).resolves.toEqual([]);
    await expect(getNotes()).resolves.toEqual([]);
  });

  it('书籍数据损坏不影响笔记读取，反之亦然', async () => {
    localStorage.setItem(BOOKS_KEY, '###corrupted###');
    await saveNote(makeNote('n1', 'b1'));
    await expect(getBooks()).resolves.toEqual([]);
    const notes = await getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('n1');
  });
});

describe('书籍保存语义', () => {
  it('保存新 id 是追加', async () => {
    await saveBook(makeBook('b1'));
    await saveBook(makeBook('b2'));
    const books = await getBooks();
    expect(books.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('保存同一 id 是覆盖而非追加', async () => {
    await saveBook(makeBook('b1', { title: '旧标题', rating: 1 }));
    await saveBook(makeBook('b1', { title: '新标题', rating: 5 }));
    const books = await getBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('新标题');
    expect(books[0].rating).toBe(5);
  });

  it('覆盖已有书籍不影响其他书籍', async () => {
    await saveBook(makeBook('b1'));
    await saveBook(makeBook('b2'));
    await saveBook(makeBook('b1', { title: '更新后' }));
    const books = await getBooks();
    expect(books).toHaveLength(2);
    expect(books.find((b) => b.id === 'b2')?.title).toBe('书名-b2');
  });
});

describe('删除书籍的级联清理', () => {
  it('删除书籍同时清掉其关联笔记，且不影响其他书籍及其笔记', async () => {
    await saveBook(makeBook('b1'));
    await saveBook(makeBook('b2'));
    await saveNote(makeNote('n1', 'b1'));
    await saveNote(makeNote('n2', 'b1'));
    await saveNote(makeNote('n3', 'b2'));

    await deleteBook('b1');

    const books = await getBooks();
    expect(books.map((b) => b.id)).toEqual(['b2']);
    const remainingNotes = await getNotes();
    expect(remainingNotes.map((n) => n.id)).toEqual(['n3']);
    await expect(getNotes('b1')).resolves.toEqual([]);
    const b2Notes = await getNotes('b2');
    expect(b2Notes.map((n) => n.id)).toEqual(['n3']);
  });

  it('删除不存在的书籍是安全的空操作', async () => {
    await saveBook(makeBook('b1'));
    await saveNote(makeNote('n1', 'b1'));
    await expect(deleteBook('nope')).resolves.toBeUndefined();
    expect(await getBooks()).toHaveLength(1);
    expect(await getNotes()).toHaveLength(1);
  });
});

describe('异步延迟下的最终状态', () => {
  it('逐个等待保存完成后，读取到的即为最终完整状态', async () => {
    await saveBook(makeBook('b1'));
    await saveBook(makeBook('b2'));
    await saveBook(makeBook('b3'));
    const books = await getBooks();
    expect(books.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('保存返回的 Promise resolve 后，数据已落盘可读', async () => {
    const book = makeBook('b1', { title: '落盘验证' });
    const returned = await saveBook(book);
    expect(returned).toEqual(book);
    const raw = localStorage.getItem(BOOKS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toHaveLength(1);
    await expect(getBooks()).resolves.toEqual([book]);
  });
});
