import { beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, getBooks, getNotes, saveBook } from '../src/utils/storage';
import { installMemoryLocalStorage } from './helpers/memoryStorage';
import { makeBook } from './helpers/factories';

describe('存储为空 / 内容非法 / 字段缺失时的读取健壮性', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('存储为空：读取返回空数组而非抛异常', async () => {
    await expect(getBooks()).resolves.toEqual([]);
    await expect(getNotes()).resolves.toEqual([]);
  });

  it('JSON 语法非法：读取返回空数组而非抛异常', async () => {
    localStorage.setItem('reading_books', '{not-json');
    localStorage.setItem('reading_notes', '[[[');

    await expect(getBooks()).resolves.toEqual([]);
    await expect(getNotes()).resolves.toEqual([]);
  });

  it.each([
    ['对象', '{}'],
    ['数字', '42'],
    ['字符串', '"hello"'],
    ['null', 'null'],
  ])('合法 JSON 但不是数组（%s）：读取返回空数组', async (_label, raw) => {
    localStorage.setItem('reading_books', raw);
    localStorage.setItem('reading_notes', raw);

    await expect(getBooks()).resolves.toEqual([]);
    await expect(getNotes()).resolves.toEqual([]);
  });

  it('字段缺失的记录仍可读取且不抛异常', async () => {
    localStorage.setItem('reading_books', JSON.stringify([{ id: 'broken-book' }, { title: 'No Id' }]));

    const books = await getBooks();
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({ id: 'broken-book' });
  });

  it('损坏数据不会阻塞后续正常写入与读取（可自愈）', async () => {
    localStorage.setItem('reading_books', '{corrupt');

    await saveBook(makeBook({ id: 'book-a' }));

    const books = await getBooks();
    expect(books.map((b) => b.id)).toEqual(['book-a']);
  });

  it('笔记存储损坏时删除书籍不抛异常', async () => {
    await saveBook(makeBook({ id: 'book-a' }));
    localStorage.setItem('reading_notes', '{corrupt');

    await expect(deleteBook('book-a')).resolves.toBeUndefined();
    expect(await getBooks()).toEqual([]);
    expect(await getNotes()).toEqual([]);
  });
});
