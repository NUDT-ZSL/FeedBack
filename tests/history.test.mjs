// 撤销/重做回归测试：
// - 连续提交相同状态后，撤销只回退一步，不跳过中间状态
// - 历史容量达到上限后继续提交，撤销链保持连续且不丢失最近状态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../src/state/HistoryManager.ts';

test('连续提交相同状态：撤销每次只回退一步', () => {
  const history = new HistoryManager(20);
  const state = { title: '相同状态', angle: 135 };
  history.push(state);
  history.push(state);
  history.push(state);
  assert.equal(history.getCurrentIndex(), 2, '三次提交后索引应为 2');

  const first = history.undo();
  assert.deepEqual(first, state);
  assert.equal(history.getCurrentIndex(), 1, '第一次撤销只应回退一步');
  assert.ok(history.canUndo(), '相同状态不应被跳过，仍应可继续撤销');

  history.undo();
  assert.equal(history.getCurrentIndex(), 0);
  assert.equal(history.undo(), null, '到达起点后撤销应返回 null');
});

test('撤销后重做：逐步恢复到最新状态', () => {
  const history = new HistoryManager(20);
  history.push({ v: 1 });
  history.push({ v: 2 });
  history.push({ v: 3 });
  assert.deepEqual(history.undo(), { v: 2 });
  assert.deepEqual(history.redo(), { v: 3 });
  assert.equal(history.canRedo(), false);
});

test('容量达到上限后继续提交：撤销链连续且不丢失最近状态', () => {
  const history = new HistoryManager(5);
  for (let i = 1; i <= 8; i++) {
    history.push({ version: i });
  }
  const stored = history.getHistory();
  assert.equal(stored.length, 5, '历史长度不应超过容量上限');
  assert.deepEqual(
    stored.map(s => s.version),
    [4, 5, 6, 7, 8],
    '溢出后应保留最近的 5 个状态'
  );
  assert.deepEqual(history.getCurrent(), { version: 8 }, '最新状态不得丢失');

  // 撤销链应连续经过 7,6,5,4，无跳步、无缺失
  const undone = [];
  let current = history.undo();
  while (current !== null) {
    undone.push(current.version);
    current = history.undo();
  }
  assert.deepEqual(undone, [7, 6, 5, 4], '撤销链应连续覆盖容量内全部状态');

  // 重做链同样连续恢复到最新状态
  const redone = [];
  let next = history.redo();
  while (next !== null) {
    redone.push(next.version);
    next = history.redo();
  }
  assert.deepEqual(redone, [5, 6, 7, 8], '重做链应连续恢复到最新状态');
});

test('容量为 1 的极端情况：不崩溃且行为一致', () => {
  const history = new HistoryManager(1);
  history.push({ v: 1 });
  history.push({ v: 2 });
  assert.deepEqual(history.getCurrent(), { v: 2 });
  assert.equal(history.canUndo(), false, '容量为 1 时无可撤销状态');
});
