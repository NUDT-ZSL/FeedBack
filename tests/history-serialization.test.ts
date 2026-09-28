import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HistoryManager } from '../src/state/HistoryManager.ts';

interface LabeledState {
  label: number;
  value?: string;
}

describe('撤销重做历史', () => {
  it('连续提交相同状态时保留每次提交，每次撤销都只回退一步', () => {
    const history = new HistoryManager<LabeledState>(10);
    const sameState: LabeledState = { label: 2 };

    history.push({ label: 1 });
    history.push(sameState);
    history.push({ ...sameState });
    history.push({ ...sameState });
    history.push({ label: 3, value: 'after identical adjacent states' });

    assert.equal(history.getCurrentIndex(), 4);
    assert.deepEqual(history.getCurrent(), {
      label: 3,
      value: 'after identical adjacent states',
    });

    for (const expectedIndex of [3, 2, 1]) {
      const undone = history.undo();
      assert.deepEqual(undone, sameState);
      assert.equal(history.getCurrentIndex(), expectedIndex);
      assert.deepEqual(history.getCurrent(), sameState);
    }

    assert.deepEqual(history.undo(), { label: 1 });
    assert.equal(history.getCurrentIndex(), 0);
    assert.equal(history.getHistory().length, 5);
  });

  it('达到容量上限后继续提交，裁剪最旧状态且最近撤销/重做链连续', () => {
    const maxSize = 3;
    const history = new HistoryManager<LabeledState>(maxSize);

    for (let label = 0; label <= 5; label += 1) {
      history.push({ label });
    }

    assert.deepEqual(history.getHistory(), [
      { label: 3 },
      { label: 4 },
      { label: 5 },
    ]);
    assert.equal(history.getCurrentIndex(), maxSize - 1);

    assert.deepEqual(history.undo(), { label: 4 });
    assert.equal(history.getCurrentIndex(), 1);
    assert.deepEqual(history.undo(), { label: 3 });
    assert.equal(history.getCurrentIndex(), 0);
    assert.equal(history.canUndo(), false);

    assert.deepEqual(history.redo(), { label: 4 });
    assert.deepEqual(history.redo(), { label: 5 });
    assert.equal(history.canRedo(), false);
  });

  it('撤销后提交会丢弃旧分支，新的最近状态不会丢失', () => {
    const history = new HistoryManager<LabeledState>(4);
    [1, 2, 3].forEach(label => history.push({ label }));

    history.undo();
    history.push({ label: 4 });

    assert.deepEqual(history.getHistory(), [
      { label: 1 },
      { label: 2 },
      { label: 4 },
    ]);
    assert.deepEqual(history.getCurrent(), { label: 4 });
    assert.equal(history.canRedo(), false);
    assert.deepEqual(history.undo(), { label: 2 });
  });
});

describe('状态序列化与深拷贝', () => {
  it('中文、emoji、组合字符和特殊符号经过提交、撤销、还原后逐字一致', () => {
    const expected = {
      title: '渐变卡片：中文标题 👨‍👩‍👧‍👦',
      subtitle: 'emoji 与零宽连接符 🚀‍✨，组合字符 é̄',
      symbols: '"引号" <标签> & 反斜杠 \\ 换行\n制表\t百分比% 路径/a\\b #1 🇨🇳',
      nested: {
        items: ['卡片一', 'Card 2', '🎉', 'null\\u0000\\uD83D'],
      },
    };
    const copy = {
      ...expected,
      nested: { items: [...expected.nested.items] },
    };

    const history = new HistoryManager<typeof copy>(10);
    history.push({ ...copy, title: '旧标题' });
    history.push(copy);

    copy.title = '原对象被修改也不能影响历史';
    copy.nested.items[0] = '原数组被修改也不能影响历史';

    const restored = history.undo();
    assert.notEqual(restored, copy);
    assert.equal(restored?.title, '旧标题');

    const redone = history.redo();
    assert.deepEqual(redone, expected);

    for (const key of ['title', 'subtitle', 'symbols'] as const) {
      assert.deepEqual(Array.from(redone[key]), Array.from(expected[key]));
    }

    redone.title = '修改副本';
    redone.nested.items.push('不应污染历史');
    assert.equal(history.getCurrent()?.title, '渐变卡片：中文标题 👨‍👩‍👧‍👦');
    assert.deepEqual(history.getCurrent()?.nested.items.at(-1), 'null\\u0000\\uD83D');
  });
});
