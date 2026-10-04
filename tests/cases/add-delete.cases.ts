import {
  DeckDriver,
  MAX_SLIDES,
  assertTrue,
  case_,
  createSeededRandom,
  expectState
} from '../harness.js';
import { createDeckState } from '../../src/model/slides.js';

export const addDeleteCases = [
  case_('新增幻灯片：追加到末尾并选中新项', () => {
    const deck = new DeckDriver();
    deck.addSlide();
    expectState(deck, '新增后', {
      slideCount: 4,
      currentIndex: 3,
      direction: 'forward',
      current: { title: '新幻灯片 4', chartType: 'bar', note: '', noteFontSize: 16 },
      dataLengths: [6, 6, 6, 6]
    });
  }),

  case_('新增幻灯片：数据点由随机源决定且可复现', () => {
    const expected = createSeededRandom(42);
    const deck = new DeckDriver();
    deck.addSlide();
    const expectedData = ['A', 'B', 'C', 'D', 'E', 'F'].map(label => ({
      label,
      value: expected.nextValue()
    }));
    expectState(deck, '新增数据点', { current: { data: expectedData } });
    for (const point of deck.current.data) {
      assertTrue(
        point.value >= 10000 && point.value < 60000,
        '新增数据点',
        `数据点 ${point.label} 取值越界: ${point.value}`,
        deck
      );
    }
  }),

  case_('新增到上限后静默忽略，选中项与集合长度一致', () => {
    const deck = new DeckDriver();
    for (let i = 0; i < MAX_SLIDES - 3; i++) deck.addSlide();
    expectState(deck, '达到上限', { slideCount: MAX_SLIDES, currentIndex: MAX_SLIDES - 1 });
    const before = deck.state;
    deck.addSlide().addSlide();
    assertTrue(deck.state === before, '超限新增', '超限新增应原样返回状态（引用不变）', deck);
    expectState(deck, '超限新增后', {
      slideCount: MAX_SLIDES,
      currentIndex: MAX_SLIDES - 1,
      direction: 'forward',
      revisions: 0
    });
  }),

  case_('删除中间项：选中项位置不变，集合缩短', () => {
    const deck = new DeckDriver();
    deck.goTo(1);
    const titlesBefore = deck.slides.map(s => s.title);
    deck.deleteCurrent();
    expectState(deck, '删除中间项后', {
      slideCount: 2,
      currentIndex: 1,
      direction: 'forward',
      titles: [titlesBefore[0], titlesBefore[2]]
    });
  }),

  case_('删除末尾项：选中项收敛到最后合法位置，方向标记 backward', () => {
    const deck = new DeckDriver();
    deck.goTo(2);
    deck.deleteCurrent();
    expectState(deck, '删除末尾项后', {
      slideCount: 2,
      currentIndex: 1,
      direction: 'backward'
    });
  }),

  case_('连续删除到仅剩一张后删除被忽略', () => {
    const deck = new DeckDriver();
    deck.deleteCurrent();
    expectState(deck, '第一次删除后', { slideCount: 2, currentIndex: 0 });
    deck.deleteCurrent();
    expectState(deck, '第二次删除后', { slideCount: 1, currentIndex: 0 });
    const before = deck.state;
    deck.deleteCurrent();
    assertTrue(deck.state === before, '仅剩一张时删除', '应静默忽略（引用不变）', deck);
    expectState(deck, '忽略后', { slideCount: 1, currentIndex: 0 });
  }),

  case_('删除后新增：序号基于当前集合长度', () => {
    const deck = new DeckDriver();
    deck.deleteCurrent();
    deck.addSlide();
    expectState(deck, '删除后新增', {
      slideCount: 3,
      currentIndex: 2,
      current: { title: '新幻灯片 3' }
    });
  }),

  case_('空集合边界：导航与删除不产生非法状态', () => {
    const deck = new DeckDriver(createDeckState([]));
    deck.next().prev().goTo(0).deleteCurrent();
    expectState(deck, '空集合操作后', { slideCount: 0, currentIndex: 0 });
    deck.addSlide();
    expectState(deck, '空集合新增后', {
      slideCount: 1,
      currentIndex: 0,
      current: { title: '新幻灯片 1' }
    });
  }),

  case_('混合序列后选中项始终与集合长度一致', () => {
    const deck = new DeckDriver();
    deck.addSlide().addSlide().goTo(4).deleteCurrent().deleteCurrent()
      .addSlide().prev().deleteCurrent();
    expectState(deck, '混合序列后', {
      slideCount: 3,
      currentIndex: 2,
      direction: 'backward'
    });
  })
];
