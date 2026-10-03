import { beforeEach, describe, expect, it } from 'vitest';
import { getBooks, getNotes, saveBook, saveNote } from '../src/utils/storage';
import { installMemoryLocalStorage } from './helpers/memoryStorage';
import { makeBook, makeNote } from './helpers/factories';

describe('同一实体重复保存：最后一次写入生效', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('顺序重复保存同一本书：最终落盘为最后一次内容，且不产生重复记录', async () => {
    const base = makeBook({ id: 'book-a', title: 'v1' });
    await saveBook(base);
    await saveBook({ ...base, title: 'v2' });
    await saveBook({ ...base, title: 'v3', rating: 4 });

    const books = await getBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ id: 'book-a', title: 'v3', rating: 4 });
  });

  it('顺序重复保存同一条笔记：最终落盘为最后一次内容', async () => {
    const base = makeNote('book-a', { id: 'note-a', content: 'draft-1' });
    await saveNote(base);
    await saveNote({ ...base, content: 'draft-2' });

    const notes = await getNotes('book-a');
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('draft-2');
  });

  it('并发保存同一本书（随机延迟）：结果确定，等于最后一次发起的写入', async () => {
    for (let round = 0; round < 20; round += 1) {
      installMemoryLocalStorage();
      const base = makeBook({ id: 'book-a' });
      const p1 = saveBook({ ...base, title: 'first' });
      const p2 = saveBook({ ...base, title: 'second' });
      const p3 = saveBook({ ...base, title: 'third' });
      await Promise.all([p1, p2, p3]);

      const books = await getBooks();
      expect(books).toHaveLength(1);
      expect(books[0].title).toBe('third');
    }
  });

  it('并发保存不同书籍（随机延迟）：全部保留，无丢失更新', async () => {
    for (let round = 0; round < 20; round += 1) {
      installMemoryLocalStorage();
      await Promise.all([
        saveBook(makeBook({ id: 'book-a' })),
        saveBook(makeBook({ id: 'book-b' })),
        saveBook(makeBook({ id: 'book-c' })),
        saveNote(makeNote('book-a', { id: 'note-1' })),
        saveNote(makeNote('book-b', { id: 'note-2' })),
      ]);

      expect((await getBooks()).map((b) => b.id).sort()).toEqual(['book-a', 'book-b', 'book-c']);
      expect((await getNotes()).map((n) => n.id).sort()).toEqual(['note-1', 'note-2']);
    }
  });

  it('重复保存的解析顺序不影响落盘结论', async () => {
    const base = makeBook({ id: 'book-a' });
    const p1 = saveBook({ ...base, title: 'final' });
    const p2 = saveBook({ ...base, title: 'stale' });
    // p2 先于 p1 被 await，但写入顺序由调用顺序决定，与随机延迟无关
    await p2;
    await p1;

    // 最后一次“发起”的写入是 p2，因此落盘为 stale —— 与 await 顺序无关
    expect((await getBooks())[0].title).toBe('stale');
  });
});
