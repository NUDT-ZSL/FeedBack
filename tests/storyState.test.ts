// 状态机验证：新增/删除/切换/编辑/键盘导航的离线断言。

import {
  MAX_SLIDES,
  actionForKey,
  StoryAction
} from '../src/state/storyState';
import {
  test,
  createTestStore,
  runSteps,
  expectState,
  expectEqual,
  expectUnchanged
} from './harness';

test('重复提交相同更新：已确认字段不被覆盖', async t => {
  const store = createTestStore();
  const firstId = store.getState().slides[0].id;

  await runSteps(t, store, [
    {
      do: { type: 'updateSlide', id: firstId, updates: { title: '季度复盘' } },
      expect: { slides: [{ id: firstId, title: '季度复盘', chartType: 'bar' }, {}, {}] },
      label: '首次修改标题'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { title: '季度复盘' } },
      expect: { slides: [{ id: firstId, title: '季度复盘', chartType: 'bar' }, {}, {}] },
      label: '重复提交相同标题（幂等）'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { note: '<b>新注释</b>' } },
      expect: { slides: [{ id: firstId, title: '季度复盘', note: '<b>新注释</b>', noteFontSize: 16 }, {}, {}] },
      label: '修改注释不影响已确认的标题'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { note: '<b>新注释</b>' } },
      expect: { slides: [{ id: firstId, title: '季度复盘', note: '<b>新注释</b>' }, {}, {}] },
      label: '重复提交相同注释（幂等）'
    }
  ]);
});

test('数据点编辑 / 图表类型切换 / 注释字号边界', async t => {
  const store = createTestStore();
  const firstId = store.getState().slides[0].id;

  await runSteps(t, store, [
    {
      do: {
        type: 'updateSlide',
        id: firstId,
        updates: {
          data: [
            { label: '一月', value: 999 },
            { label: 'Q2', value: 156000 },
            { label: 'Q3', value: 189000 },
            { label: 'Q4', value: 234000 },
            { label: 'Q1', value: 278000 },
            { label: 'Q2', value: 312000 }
          ]
        }
      },
      expect: { slides: [{ data: [{ label: '一月', value: 999 }, {}, {}, {}, {}, {}] }, {}, {}] },
      label: '编辑首个数据点'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { chartType: 'line' } },
      expect: { slides: [{ chartType: 'line', data: [{ label: '一月', value: 999 }, {}, {}, {}, {}, {}] }, {}, {}] },
      label: '切换图表类型后数据点保留'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { noteFontSize: 40 } },
      expect: { slides: [{ noteFontSize: 32 }, {}, {}] },
      label: '字号超过上限被钳制到 32'
    },
    {
      do: { type: 'updateSlide', id: firstId, updates: { noteFontSize: 5 } },
      expect: { slides: [{ noteFontSize: 12 }, {}, {}] },
      label: '字号低于下限被钳制到 12'
    }
  ]);
});

test('新增幻灯片达到上限后被静默忽略，选中项与集合长度一致', async t => {
  const store = createTestStore();

  // 初始 3 张，连续新增 7 张到达上限 10
  for (let i = 0; i < MAX_SLIDES - 3; i += 1) {
    store.dispatch({ type: 'addSlide' });
  }
  expectState(t, store.getState(), {
    currentIndex: MAX_SLIDES - 1,
    direction: 'forward',
    slides: Array.from({ length: MAX_SLIDES }, () => ({}))
  }, '新增到上限后的状态');
  expectEqual(t, store.getState().slides.length, MAX_SLIDES, '集合长度达到上限');
  expectEqual(t, store.getState().slides[3].title, '新幻灯片 4', '新增幻灯片按序号命名');
  expectEqual(t, store.getState().slides[3].data.length, 6, '新增幻灯片含 6 个数据点');
  expectEqual(t, store.getState().slides[3].data[0].value, 10000, '数据点由注入随机源确定生成');
  expectEqual(t, store.getState().slides[3].data[3].value, 47500, '数据点由注入随机源确定生成');

  // 超限新增：状态必须完全不变
  const before = store.getState();
  store.dispatch({ type: 'addSlide' });
  store.dispatch({ type: 'addSlide' });
  expectUnchanged(t, before, store.getState(), '超限新增被静默忽略');
  expectEqual(t, store.getState().currentIndex, MAX_SLIDES - 1, '选中项仍与集合长度一致');
});

test('跳转到不存在或越界的索引被静默跳过', async t => {
  const store = createTestStore();

  await runSteps(t, store, [
    {
      do: { type: 'goToSlide', index: 2 },
      expect: { currentIndex: 2, direction: 'forward' },
      label: '合法跳转'
    },
    {
      do: { type: 'goToSlide', index: 2 },
      expect: { currentIndex: 2, direction: 'forward' },
      label: '原地跳转被跳过'
    }
  ]);

  const before = store.getState();
  store.dispatch({ type: 'goToSlide', index: 99 });
  store.dispatch({ type: 'goToSlide', index: -1 });
  store.dispatch({ type: 'goToSlide', index: 3 });
  expectUnchanged(t, before, store.getState(), '越界跳转不改变任何状态');

  await runSteps(t, store, [
    {
      do: { type: 'goToSlide', index: 0 },
      expect: { currentIndex: 0, direction: 'backward' },
      label: '回跳方向标记为 backward'
    }
  ]);
});

test('删除幻灯片后选中项与方向标记收敛到合法值', async t => {
  const store = createTestStore();
  const ids = store.getState().slides.map(s => s.id);

  await runSteps(t, store, [
    {
      do: { type: 'goToSlide', index: 2 },
      expect: { currentIndex: 2 },
      label: '先切到第 3 张'
    },
    {
      // 删除选中项之前的项：选中下标前移，方向标记 backward
      do: { type: 'deleteSlide', id: ids[0] },
      expect: { currentIndex: 1, direction: 'backward', slides: [{ id: ids[1] }, { id: ids[2] }] },
      label: '删除当前项之前的幻灯片'
    },
    {
      // 删除当前项本身：选中项收敛到最后一个合法下标
      do: { type: 'deleteSlide', id: ids[2] },
      expect: { currentIndex: 0, direction: 'forward', slides: [{ id: ids[1] }] },
      label: '删除当前项（末位），选中项收敛'
    },
    {
      // 删除最后一项：集合为空，选中项收敛为 -1
      do: { type: 'deleteSlide', id: ids[1] },
      expect: { currentIndex: -1, direction: 'forward', slides: [] },
      label: '删除最后一项，集合为空'
    }
  ]);

  const before = store.getState();
  store.dispatch({ type: 'deleteSlide', id: 'non-existent-id' });
  expectUnchanged(t, before, store.getState(), '删除不存在的目标被静默忽略');
});

test('键盘导航在边界处不越界推进', async t => {
  const store = createTestStore();

  const press = (key: string): void => {
    const action: StoryAction | null = actionForKey(key, store.getState());
    if (action) store.dispatch(action);
  };

  // 首页向左：不越界
  press('ArrowLeft');
  expectState(t, store.getState(), { currentIndex: 0, direction: 'forward' }, '首页按 ← 不越界');

  // 连续向右直到末页
  for (let i = 0; i < 10; i += 1) press('ArrowRight');
  expectState(t, store.getState(), { currentIndex: 2, direction: 'forward' }, '末页按 → 不越界');

  // 连续向左回到首页
  for (let i = 0; i < 10; i += 1) press('ArrowLeft');
  expectState(t, store.getState(), { currentIndex: 0, direction: 'backward' }, '回到首页，方向标记 backward');

  // 上下方向键等价于左右
  press('ArrowDown');
  expectState(t, store.getState(), { currentIndex: 1, direction: 'forward' }, '↓ 等价于 →');
  press('ArrowUp');
  expectState(t, store.getState(), { currentIndex: 0, direction: 'backward' }, '↑ 等价于 ←');

  // 未映射按键不产生动作
  expectEqual(t, actionForKey('a', store.getState()), null, '未映射按键返回 null');
  expectEqual(t, actionForKey('Enter', store.getState()), null, 'Enter 不触发导航');
});

test('演示模式下键盘行为：ESC/空格退出，方向键继续导航', async t => {
  const store = createTestStore();
  store.dispatch({ type: 'setPresentation', value: true });
  expectState(t, store.getState(), { isPresentation: true }, '进入演示模式');

  // 方向键在演示模式下仍然导航
  const nav = actionForKey('ArrowRight', store.getState());
  expectEqual(t, nav?.type, 'goNext', '演示模式下 → 仍映射为 goNext');
  if (nav) store.dispatch(nav);
  expectState(t, store.getState(), { currentIndex: 1, isPresentation: true }, '演示模式下导航生效');

  // ESC 与空格都映射为退出演示
  for (const key of ['Escape', ' ']) {
    const action = actionForKey(key, store.getState());
    expectEqual(t, action?.type, 'setPresentation', `演示模式下 ${key === ' ' ? '空格' : key} 映射为退出`);
    if (action) store.dispatch(action);
    expectState(t, store.getState(), { isPresentation: false }, `按 ${key === ' ' ? '空格' : key} 退出演示模式`);
    store.dispatch({ type: 'setPresentation', value: true });
  }

  // 编辑模式下 ESC/空格不触发任何动作
  store.dispatch({ type: 'setPresentation', value: false });
  expectEqual(t, actionForKey('Escape', store.getState()), null, '编辑模式下 ESC 无动作');
  expectEqual(t, actionForKey(' ', store.getState()), null, '编辑模式下空格无动作');
});

test('混合操作序列回归：增删改切后状态字段全部一致', async t => {
  const store = createTestStore();
  const ids = store.getState().slides.map(s => s.id);

  await runSteps(t, store, [
    { do: { type: 'addSlide' }, expect: { currentIndex: 3, slides: [{}, {}, {}, { title: '新幻灯片 4', chartType: 'bar', note: '', noteFontSize: 16 }] }, label: '新增第 4 张' },
    {
      do: s => s.dispatch({ type: 'updateSlide', id: s.getState().slides[3].id, updates: { title: '补充材料', chartType: 'line', note: '<i>附录</i>', noteFontSize: 20 } }),
      expect: { slides: [{}, {}, {}, { title: '补充材料', chartType: 'line', note: '<i>附录</i>', noteFontSize: 20 }] },
      label: '编辑新幻灯片全部字段'
    },
    { do: { type: 'goToSlide', index: 0 }, expect: { currentIndex: 0, direction: 'backward' }, label: '跳回首页' },
    { do: { type: 'deleteSlide', id: ids[0] }, expect: { currentIndex: -1 + 1, slides: [{ id: ids[1] }, { id: ids[2] }, { title: '补充材料' }] }, label: '删除原首页' },
    { do: { type: 'goNext' }, expect: { currentIndex: 1, direction: 'forward' }, label: '前进一页' },
    { do: { type: 'setPresentation', value: true }, expect: { isPresentation: true, currentIndex: 1 }, label: '进入演示模式' },
    { do: { type: 'setPresentation', value: false }, expect: { isPresentation: false, currentIndex: 1 }, label: '退出演示模式' }
  ]);

  // 最终整体一致性：选中项指向的正是编辑过的那张
  const final = store.getState();
  expectEqual(t, final.slides[final.currentIndex].id, ids[2], '最终选中项为原第 3 张');
  expectEqual(t, final.slides.length, 3, '最终集合长度');
});
