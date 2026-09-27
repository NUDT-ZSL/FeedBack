import { describe, expect, it } from 'vitest';
import { deleteNote, getNotes, saveNote } from '../src/utils/storage';
import { makeNote } from './helpers';

describe('笔记读取', () => {
  it('按书籍 id 取笔记只返回匹配项，不传 id 返回全部', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await saveNote(makeNote('n2', 'b2'));
    await saveNote(makeNote('n3', 'b1'));

    const all = await getNotes();
    expect(all.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    const b1Notes = await getNotes('b1');
    expect(b1Notes.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
    const b2Notes = await getNotes('b2');
    expect(b2Notes.map((n) => n.id)).toEqual(['n2']);
  });

  it('查询没有笔记的书籍返回空数组', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await expect(getNotes('b-other')).resolves.toEqual([]);
  });
});

describe('笔记保存语义', () => {
  it('保存新 id 笔记是追加', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await saveNote(makeNote('n2', 'b1'));
    const notes = await getNotes('b1');
    expect(notes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('保存同一 id 笔记是覆盖而非追加', async () => {
    await saveNote(makeNote('n1', 'b1', { content: '旧内容' }));
    await saveNote(makeNote('n1', 'b1', { content: '新内容' }));
    const notes = await getNotes('b1');
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('新内容');
  });

  it('覆盖已有笔记不影响其他笔记', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await saveNote(makeNote('n2', 'b2'));
    await saveNote(makeNote('n1', 'b1', { content: '更新后' }));
    const notes = await getNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === 'n2')?.content).toBe('笔记-n2');
  });
});

describe('笔记删除语义', () => {
  it('删除笔记只移除目标，不影响其他笔记', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await saveNote(makeNote('n2', 'b1'));
    await saveNote(makeNote('n3', 'b2'));

    await deleteNote('n1');

    const notes = await getNotes();
    expect(notes.map((n) => n.id).sort()).toEqual(['n2', 'n3']);
  });

  it('删除不存在的笔记是安全的空操作', async () => {
    await saveNote(makeNote('n1', 'b1'));
    await expect(deleteNote('missing')).resolves.toBeUndefined();
    expect(await getNotes()).toHaveLength(1);
  });
});
