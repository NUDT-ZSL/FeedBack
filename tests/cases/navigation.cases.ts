import { DeckDriver, assertTrue, case_, expectState } from '../harness.js';

export const navigationCases = [
  case_('go-to 不存在或越界的索引被静默跳过', () => {
    const deck = new DeckDriver();
    deck.goTo(1);
    const before = deck.state;
    deck.goTo(-1).goTo(3).goTo(100).goTo(1.5).goTo(NaN);
    assertTrue(deck.state === before, '越界跳转', '应原样返回状态（引用不变）', deck);
    expectState(deck, '越界跳过后', {
      slideCount: 3,
      currentIndex: 1,
      direction: 'forward'
    });
  }),

  case_('go-to 当前索引被静默跳过', () => {
    const deck = new DeckDriver();
    const before = deck.state;
    deck.goTo(0);
    assertTrue(deck.state === before, '跳转当前索引', '应原样返回状态（引用不变）', deck);
    expectState(deck, '跳转当前索引后', { currentIndex: 0, direction: 'forward' });
  }),

  case_('go-to 方向标记：向前 forward、向后 backward', () => {
    const deck = new DeckDriver();
    deck.goTo(2);
    expectState(deck, '向前跳转', { currentIndex: 2, direction: 'forward' });
    deck.goTo(0);
    expectState(deck, '向后跳转', { currentIndex: 0, direction: 'backward' });
  }),

  case_('next/prev 在边界处不越界推进', () => {
    const deck = new DeckDriver();
    const initial = deck.state;
    deck.prev();
    assertTrue(deck.state === initial, '首张 prev', '应静默忽略（引用不变）', deck);

    deck.next().next();
    expectState(deck, '到达末张', { currentIndex: 2, direction: 'forward' });
    const atEnd = deck.state;
    deck.next();
    assertTrue(deck.state === atEnd, '末张 next', '应静默忽略（引用不变）', deck);
  }),

  case_('键盘导航：方向键推进/后退且边界不越界', () => {
    const deck = new DeckDriver();
    assertTrue(deck.press('ArrowLeft') === true, '首张左键', '应返回 preventDefault=true', deck);
    expectState(deck, '首张左键后', { currentIndex: 0, direction: 'forward' });

    deck.press('ArrowRight');
    expectState(deck, '右键后', { currentIndex: 1, direction: 'forward' });
    deck.press('ArrowDown');
    expectState(deck, '下键后', { currentIndex: 2, direction: 'forward' });

    deck.press('ArrowRight');
    expectState(deck, '末张右键', { currentIndex: 2 });
    deck.press('ArrowUp');
    expectState(deck, '上键后', { currentIndex: 1, direction: 'backward' });
  }),

  case_('键盘导航：未映射按键不触发任何状态变化', () => {
    const deck = new DeckDriver();
    const before = deck.state;
    for (const key of ['a', 'Enter', 'Tab', 'Home', 'End', 'PageDown']) {
      assertTrue(deck.press(key) === false, '未映射按键', `按键 ${key} 不应被处理`, deck);
    }
    assertTrue(deck.state === before, '未映射按键', '状态应保持不变（引用不变）', deck);
  })
];
