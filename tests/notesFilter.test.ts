import { beforeEach, describe, expect, it } from 'vitest';
import { getNotes, saveNote } from '../src/utils/storage';
import { installMemoryLocalStorage } from './helpers/memoryStorage';
import { makeNote } from './helpers/factories';

describe('按书籍过滤笔记', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('只返回指定书籍的笔记', async () => {
    await saveNote(makeNote('book-a', { id: 'note-a1' }));
    await saveNote(makeNote('book-b', { id: 'note-b1' }));
    await saveNote(makeNote('book-a', { id: 'note-a2' }));

    const notesOfA = await getNotes('book-a');
    expect(notesOfA.map((n) => n.id).sort()).toEqual(['note-a1', 'note-a2']);
    expect(notesOfA.every((n) => n.bookId === 'book-a')).toBe(true);
  });

  it('不传书籍标识时返回全部笔记', async () => {
    await saveNote(makeNote('book-a', { id: 'note-a1' }));
    await saveNote(makeNote('book-b', { id: 'note-b1' }));

    expect((await getNotes()).map((n) => n.id).sort()).toEqual(['note-a1', 'note-b1']);
  });

  it('传入不存在的书籍标识返回空数组而非报错', async () => {
    await saveNote(makeNote('book-a', { id: 'note-a1' }));

    await expect(getNotes('no-such-book')).resolves.toEqual([]);
  });

  it('存储为空时按书籍过滤返回空数组', async () => {
    await expect(getNotes('book-a')).resolves.toEqual([]);
  });

  it('缺少 bookId 字段的笔记不会被任何书籍过滤命中，但不影响读取', async () => {
    const orphan = { ...makeNote('book-a', { id: 'note-orphan' }) } as Record<string, unknown>;
    delete orphan.bookId;
    localStorage.setItem('reading_notes', JSON.stringify([orphan, makeNote('book-a', { id: 'note-a1' })]));

    const all = await getNotes();
    expect(all).toHaveLength(2);
    expect((await getNotes('book-a')).map((n) => n.id)).toEqual(['note-a1']);
  });
});
