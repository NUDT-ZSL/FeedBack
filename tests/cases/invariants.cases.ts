import {
  DeckDriver,
  MAX_SLIDES,
  assertTrue,
  case_,
  createSeededRandom,
  expectState
} from '../harness.js';
import { createInitialDeckState } from '../../src/model/slides.js';

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const invariantCases = [
  case_('随机操作序列（5 个种子 x 200 步）下核心不变量始终成立', () => {
    for (const seed of [1, 7, 42, 1337, 20261005]) {
      const deck = new DeckDriver(createInitialDeckState(), createSeededRandom(seed));
      const rand = mulberry32(seed);
      for (let step = 0; step < 200; step++) {
        const op = Math.floor(rand() * 9);
        switch (op) {
          case 0:
            deck.addSlide();
            break;
          case 1:
            deck.deleteCurrent();
            break;
          case 2:
            deck.goTo(Math.floor(rand() * 14) - 2);
            break;
          case 3:
            deck.next();
            break;
          case 4:
            deck.prev();
            break;
          case 5:
            deck.updateCurrent({ title: `T${seed}-${step}` });
            break;
          case 6:
            deck.updateCurrent({ noteFontSize: Math.floor(rand() * 48) });
            break;
          case 7:
            deck.updateCurrent({ chartType: rand() > 0.5 ? 'line' : 'bar' });
            break;
          default:
            deck.updateCurrent({ note: `<b>${step}</b>` });
        }

        const state = deck.state;
        const context = `种子 ${seed} 第 ${step} 步`;
        assertTrue(
          state.slides.length >= 1 && state.slides.length <= MAX_SLIDES,
          context,
          `集合长度 ${state.slides.length} 越界`,
          deck
        );
        assertTrue(
          state.currentIndex >= 0 && state.currentIndex < state.slides.length,
          context,
          `选中项 ${state.currentIndex} 越界（长度 ${state.slides.length}）`,
          deck
        );
        assertTrue(
          state.direction === 'forward' || state.direction === 'backward',
          context,
          `非法方向标记: ${state.direction}`,
          deck
        );
        assertTrue(state.revisions >= 0, context, 'revisions 不应为负', deck);
        for (const slide of state.slides) {
          assertTrue(
            slide.noteFontSize >= 12 && slide.noteFontSize <= 32,
            context,
            `幻灯片 ${slide.id} 字号 ${slide.noteFontSize} 越界`,
            deck
          );
          for (const point of slide.data) {
            assertTrue(Number.isFinite(point.value), context, `数据点 ${point.label} 数值非法`, deck);
          }
        }
      }
    }
  }),

  case_('混合操作序列后的完整状态快照', () => {
    const deck = new DeckDriver();
    deck.updateCurrent({ title: '销售复盘' });
    deck.addSlide();
    deck.updateCurrent({ chartType: 'line', noteFontSize: 28, note: '<i>备注</i>' });
    deck.goTo(0);
    deck.next();
    deck.deleteCurrent();
    deck.enterPresentation();
    deck.exitPresentation();

    expectState(deck, '混合序列终态', {
      slideCount: 3,
      currentIndex: 1,
      direction: 'forward',
      isPresentation: false,
      revisions: 2,
      titles: ['销售复盘', '产品品类销售分布', '新幻灯片 4'],
      chartTypes: ['bar', 'bar', 'line'],
      noteFontSizes: [16, 16, 28],
      current: {
        title: '产品品类销售分布',
        chartType: 'bar',
        noteFontSize: 16
      }
    });
    assertTrue(deck.slides[2].note === '<i>备注</i>', '混合序列终态', '新幻灯片注释不符', deck);
  }),

  case_('长序列新增/删除往返后集合与选中项保持一致', () => {
    const deck = new DeckDriver();
    for (let i = 0; i < 7; i++) deck.addSlide();
    expectState(deck, '连续新增到上限', { slideCount: 10, currentIndex: 9 });
    for (let i = 0; i < 9; i++) deck.deleteCurrent();
    expectState(deck, '连续删除到一张', { slideCount: 1, currentIndex: 0, direction: 'backward' });
    deck.addSlide();
    expectState(deck, '再次新增', { slideCount: 2, currentIndex: 1, direction: 'forward' });
  })
];
