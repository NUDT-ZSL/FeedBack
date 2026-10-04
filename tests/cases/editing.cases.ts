import { DeckDriver, assertTrue, case_, expectState } from '../harness.js';

export const editingCases = [
  case_('标题更新生效并计入一次确认提交', () => {
    const deck = new DeckDriver();
    deck.updateCurrent({ title: '季度复盘' });
    expectState(deck, '标题更新后', {
      revisions: 1,
      current: { title: '季度复盘' }
    });
  }),

  case_('连续提交相同标题不会覆盖已确认结果', () => {
    const deck = new DeckDriver();
    deck.updateCurrent({ title: '季度复盘' });
    const confirmed = deck.state;
    deck.updateCurrent({ title: '季度复盘' });
    deck.updateCurrent({ title: '季度复盘' });
    assertTrue(deck.state === confirmed, '重复提交', '重复提交应原样返回（引用不变）', deck);
    expectState(deck, '重复提交后', {
      revisions: 1,
      current: { title: '季度复盘' }
    });
  }),

  case_('重复提交内容相同的数据点数组（不同引用）不新增提交记录', () => {
    const deck = new DeckDriver();
    const snapshot = deck.current.data.map(point => ({ ...point }));
    deck.updateCurrent({ data: snapshot });
    expectState(deck, '相同数据提交后', { revisions: 0 });
  }),

  case_('图表类型切换：bar/line 往返，重复设置同类型为空操作', () => {
    const deck = new DeckDriver();
    expectState(deck, '初始', { current: { chartType: 'bar' } });
    deck.updateCurrent({ chartType: 'line' });
    expectState(deck, '切到折线', { revisions: 1, current: { chartType: 'line' } });

    const before = deck.state;
    deck.updateCurrent({ chartType: 'line' });
    assertTrue(deck.state === before, '重复设置 line', '应为空操作（引用不变）', deck);

    deck.updateCurrent({ chartType: 'bar' });
    expectState(deck, '切回柱状', { revisions: 2, current: { chartType: 'bar' } });
  }),

  case_('数据点编辑：标签与数值逐项更新', () => {
    const deck = new DeckDriver();
    const original = deck.current.data;
    const edited = original.map((point, idx) =>
      idx === 0 ? { label: '一月', value: 999 } : { ...point }
    );
    deck.updateCurrent({ data: edited });
    expectState(deck, '数据点编辑后', {
      revisions: 1,
      current: {
        data: [
          { label: '一月', value: 999 },
          ...original.slice(1)
        ]
      }
    });
  }),

  case_('数据点非法数值归一为 0', () => {
    const deck = new DeckDriver();
    const edited = deck.current.data.map((point, idx) =>
      idx === 0 ? { label: point.label, value: NaN } : { ...point }
    );
    deck.updateCurrent({ data: edited });
    expectState(deck, '非法值归一后', {
      current: {
        data: [
          { label: edited[0].label, value: 0 },
          ...edited.slice(1)
        ]
      }
    });
  }),

  case_('注释内容与字号更新，越界字号收敛到 12-32', () => {
    const deck = new DeckDriver();
    deck.updateCurrent({ note: '<b>加粗</b>文本', noteFontSize: 24 });
    expectState(deck, '注释更新后', {
      revisions: 1,
      current: { note: '<b>加粗</b>文本', noteFontSize: 24 }
    });
    deck.updateCurrent({ noteFontSize: 99 });
    expectState(deck, '字号超上限', { revisions: 2, current: { noteFontSize: 32 } });
    deck.updateCurrent({ noteFontSize: 1 });
    expectState(deck, '字号超下限', { revisions: 3, current: { noteFontSize: 12 } });
  }),

  case_('重复提交相同注释内容与字号为空操作', () => {
    const deck = new DeckDriver();
    deck.updateCurrent({ note: '<i>洞察</i>', noteFontSize: 18 });
    const confirmed = deck.state;
    deck.updateCurrent({ note: '<i>洞察</i>', noteFontSize: 18 });
    assertTrue(deck.state === confirmed, '重复注释提交', '应为空操作（引用不变）', deck);
    expectState(deck, '重复注释提交后', { revisions: 1 });
  }),

  case_('按 id 更新非当前幻灯片，未知 id 静默忽略', () => {
    const deck = new DeckDriver();
    const titles = deck.slides.map(s => s.title);
    const target = deck.slides[2];
    deck.update(target.id, { title: '品类复盘' });
    expectState(deck, '按 id 更新后', {
      revisions: 1,
      currentIndex: 0,
      titles: [titles[0], titles[1], '品类复盘']
    });

    const before = deck.state;
    deck.update('no-such-id', { title: '不应生效' });
    assertTrue(deck.state === before, '未知 id 更新', '应静默忽略（引用不变）', deck);
  })
];
