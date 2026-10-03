import { beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, getBooks, getNotes, saveBook, saveNote } from '../src/utils/storage';
import { installMemoryLocalStorage } from './helpers/memoryStorage';
import { makeBook, makeNote } from './helpers/factories';

describe('删除书籍时级联清理笔记', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('删除书籍后其笔记一并清理且无残留，其他书籍的笔记不受影响', async () => {
    const bookA = makeBook({ id: 'book-a' });
    const bookB = makeBook({ id: 'book-b' });
    await saveBook(bookA);
    await saveBook(bookB);
    await saveNote(makeNote('book-a', { id: 'note-a1' }));
    await saveNote(makeNote('book-a', { id: 'note-a2' }));
    await saveNote(makeNote('book-b', { id: 'note-b1' }));

    await deleteBook('book-a');

    expect((await getBooks()).map((b) => b.id)).toEqual(['book-b']);
    const remainingNotes = await getNotes();
    expect(remainingNotes.map((n) => n.id)).toEqual(['note-b1']);
    expect(remainingNotes.every((n) => n.bookId === 'book-b')).toBe(true);
    expect(await getNotes('book-a')).toEqual([]);
    expect(JSON.stringify(await getNotes())).not.toContain('note-a');
  });

  it('删除不存在的书籍：不抛异常，现有数据不变', async () => {
    await saveBook(makeBook({ id: 'book-a' }));
    await saveNote(makeNote('book-a', { id: 'note-a1' }));

    await expect(deleteBook('no-such-book')).resolves.toBeUndefined();
    expect(await getBooks()).toHaveLength(1);
    expect(await getNotes()).toHaveLength(1);
  });

  it('删除唯一一本书后书籍与笔记存储均为空', async () => {
    await saveBook(makeBook({ id: 'book-a' }));
    await saveNote(makeNote('book-a', { id: 'note-a1' }));

    await deleteBook('book-a');

    expect(await getBooks()).toEqual([]);
    expect(await getNotes()).toEqual([]);
  });
});
