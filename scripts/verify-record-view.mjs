import assert from 'node:assert/strict';
import { getRecordView } from '../src/lib/recordView.js';
import { createDeleteQueue } from '../src/lib/deleteQueue.js';

const records = [
  {
    id: 'horror-old',
    name: '午夜医院',
    theme: '恐怖',
    storeName: '迷境一店',
    playerCount: 4,
    timeLimit: 90,
    actualTime: 60,
    escaped: true,
    teammates: [],
    createdAt: 100,
  },
  {
    id: 'scifi-new',
    name: '星际监狱',
    theme: '科幻',
    storeName: '星河三店',
    playerCount: 3,
    timeLimit: 70,
    actualTime: 66,
    escaped: true,
    teammates: [],
    createdAt: 300,
  },
  {
    id: 'horror-mid-failed',
    name: '古宅新娘',
    theme: '恐怖',
    storeName: '迷境二店',
    playerCount: 5,
    timeLimit: 100,
    actualTime: null,
    escaped: false,
    teammates: [],
    createdAt: 200,
  },
  {
    id: 'funny-latest',
    name: '欢乐当铺',
    theme: '搞笑',
    storeName: '笑场四店',
    playerCount: 4,
    timeLimit: 80,
    actualTime: 72,
    escaped: true,
    teammates: [],
    createdAt: 400,
  },
];

const allFilter = {
  themes: [],
  escapeStatus: 'all',
  searchText: '',
};

function test(name, run) {
  run();
  console.log(`✓ ${name}`);
}

test('删除后统计、列表和分组同步更新', () => {
  const before = getRecordView(records, allFilter);
  assert.equal(before.records.length, 4);
  assert.equal(before.stats.totalRecords, 4);
  assert.equal(before.stats.themeCounts['恐怖'], 2);
  assert.equal(before.stats.maxThemeCount, 2);
  assert.equal(
    before.groups.reduce((sum, group) => sum + group.records.length, 0),
    before.records.length,
  );

  const afterDelete = records.filter((record) => record.id !== 'horror-mid-failed');
  const after = getRecordView(afterDelete, allFilter);

  assert.deepEqual(
    after.records.map((record) => record.id),
    ['horror-old', 'scifi-new', 'funny-latest'],
  );
  assert.equal(after.stats.totalRecords, after.records.length);
  assert.equal(after.stats.themeCounts['恐怖'], 1);
  assert.equal(after.stats.maxThemeCount, 1);
  assert.equal(after.stats.successRate, 100);
  assert.equal(after.stats.averageEscapeTime, 66);
  assert.equal(
    after.groups.reduce((sum, group) => sum + group.records.length, 0),
    after.records.length,
  );
});

test('主题、逃脱状态和关键字多条件叠加筛选', () => {
  const view = getRecordView(records, {
    themes: ['恐怖', '科幻'],
    escapeStatus: 'failed',
    searchText: '迷境',
  });

  assert.deepEqual(
    view.records.map((record) => record.id),
    ['horror-mid-failed'],
  );

  const multiThemeSuccessView = getRecordView(records, {
    themes: ['恐怖', '科幻'],
    escapeStatus: 'success',
    searchText: '店',
  });
  assert.deepEqual(
    multiThemeSuccessView.records.map((record) => record.id),
    ['horror-old', 'scifi-new'],
  );
  assert.equal(
    multiThemeSuccessView.stats.totalRecords,
    multiThemeSuccessView.records.length,
  );
  assert.equal(multiThemeSuccessView.stats.maxThemeCount, 1);
  assert.deepEqual(
    multiThemeSuccessView.groups.map((group) => group.theme),
    ['恐怖', '科幻'],
  );

  assert.equal(view.stats.totalRecords, 1);
  assert.equal(view.stats.successRate, 0);
  assert.equal(view.stats.themeCounts['恐怖'], 1);
  assert.equal(view.stats.maxThemeCount, 1);
  assert.deepEqual(view.groups.map((group) => group.theme), ['恐怖']);
  assert.deepEqual(
    view.groups[0].records.map((record) => record.id),
    ['horror-mid-failed'],
  );
});

test('快速连续删除只让当前存在的记录完成各自删除', () => {
  const timers = new Map();
  const deletedIds = [];
  const events = [];

  const queue = createDeleteQueue({
    animationDuration: 300,
    setTimer: (callback, delay) => {
      const id = `timer-${timers.size + 1}`;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onDelete: (id) => {
      deletedIds.push(id);
      events.push(`delete:${id}`);
    },
  });

  queue.requestDelete('horror-old');
  events.push(`pending:${queue.getPendingIds().join('|')}`);
  queue.requestDelete('scifi-new');
  events.push(`pending:${queue.getPendingIds().join('|')}`);

  const firstTimer = timers.get('timer-1');
  const secondTimer = timers.get('timer-2');
  assert.equal(firstTimer.delay, 300);
  assert.equal(secondTimer.delay, 300);

  firstTimer.callback();
  assert.deepEqual(deletedIds, ['horror-old']);
  assert.deepEqual(queue.getPendingIds(), ['scifi-new']);

  secondTimer.callback();
  assert.deepEqual(deletedIds, ['horror-old', 'scifi-new']);
  assert.deepEqual(queue.getPendingIds(), []);
  assert.deepEqual(
    events,
    [
      'pending:horror-old',
      'pending:horror-old|scifi-new',
      'delete:horror-old',
      'delete:scifi-new',
    ],
  );

  queue.dispose();
});

test('空筛选结果不展示分组，统计和列表保持同一空结果', () => {
  const emptyView = getRecordView(records, {
    themes: ['古风'],
    escapeStatus: 'all',
    searchText: '不可能出现的关键字',
  });

  assert.deepEqual(emptyView.records, []);
  assert.deepEqual(emptyView.groups, []);
  assert.equal(emptyView.stats.totalRecords, 0);
  assert.equal(emptyView.stats.mostPlayedTheme, null);
  assert.equal(emptyView.stats.maxThemeCount, 0);
  assert.equal(emptyView.stats.successRate, 0);
  assert.equal(emptyView.stats.averageEscapeTime, 0);
  assert.deepEqual(Object.values(emptyView.stats.themeCounts), [0, 0, 0, 0, 0]);
});

test('分组过滤空主题、组内倒序且主题顺序稳定', () => {
  const firstView = getRecordView(records, {
    themes: ['恐怖', '科幻'],
    escapeStatus: 'all',
    searchText: '',
  });
  const secondView = getRecordView(records, {
    themes: ['科幻', '恐怖'],
    escapeStatus: 'all',
    searchText: '',
  });

  assert.deepEqual(
    firstView.groups.map((group) => group.theme),
    ['恐怖', '科幻'],
  );
  assert.deepEqual(
    secondView.groups.map((group) => group.theme),
    ['恐怖', '科幻'],
  );
  assert.deepEqual(
    firstView.groups.find((group) => group.theme === '恐怖').records.map((record) => record.id),
    ['horror-mid-failed', 'horror-old'],
  );
  assert.deepEqual(
    firstView.groups.find((group) => group.theme === '科幻').records.map((record) => record.id),
    ['scifi-new'],
  );

  const successOnly = getRecordView(records, {
    themes: ['恐怖'],
    escapeStatus: 'success',
    searchText: '',
  });
  assert.deepEqual(
    successOnly.groups.map((group) => group.theme),
    ['恐怖'],
  );
  assert.deepEqual(
    successOnly.groups[0].records.map((record) => record.id),
    ['horror-old'],
  );
});

console.log('全部批量验证通过：列表、统计与分组一致。');
