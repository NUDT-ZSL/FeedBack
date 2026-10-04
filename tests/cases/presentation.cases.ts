import {
  DeckDriver,
  assertTrue,
  case_,
  createFakeFullscreenPort,
  expectState
} from '../harness.js';

export const presentationCases = [
  case_('无全屏能力（Null 端口）时进入/退出演示模式状态一致', async () => {
    const deck = new DeckDriver();
    await deck.togglePresentation();
    expectState(deck, '进入演示', { isPresentation: true });
    await deck.togglePresentation();
    expectState(deck, '退出演示', { isPresentation: false });
  }),

  case_('全屏请求被拒绝时走降级路径仍进入演示模式', async () => {
    const port = createFakeFullscreenPort({ failRequest: true });
    const deck = new DeckDriver();
    await deck.togglePresentation(port);
    expectState(deck, '降级进入', { isPresentation: true });
    assertTrue(port.requests === 1, '降级进入', '应尝试过一次全屏请求', deck);
  }),

  case_('正常全屏路径：进入时调用 request，退出时调用 exit', async () => {
    const port = createFakeFullscreenPort();
    const deck = new DeckDriver();
    await deck.togglePresentation(port);
    assertTrue(port.requests === 1 && port.isActive, '正常进入', '全屏应已激活', deck);
    await deck.togglePresentation(port);
    expectState(deck, '正常退出', { isPresentation: false });
    assertTrue(port.exits === 1 && !port.isActive, '正常退出', '应调用 exit 并取消激活', deck);
  }),

  case_('退出时全屏接口异常不阻塞演示模式退出', async () => {
    const port = createFakeFullscreenPort({ failExit: true, active: true });
    const deck = new DeckDriver();
    deck.enterPresentation();
    await deck.togglePresentation(port);
    expectState(deck, '异常退出后', { isPresentation: false });
    assertTrue(port.exits === 1, '异常退出后', '应尝试过一次 exit', deck);
  }),

  case_('全屏丢失事件使演示模式退出；非演示时为空操作', () => {
    const port = createFakeFullscreenPort({ active: false });
    const deck = new DeckDriver();
    const idle = deck.state;
    deck.fullscreenChange(port);
    assertTrue(deck.state === idle, '非演示时全屏事件', '应为空操作（引用不变）', deck);

    deck.enterPresentation();
    deck.fullscreenChange(port);
    expectState(deck, '全屏丢失后', { isPresentation: false });
  }),

  case_('演示模式下 ESC 与空格退出，方向键继续导航', () => {
    const deck = new DeckDriver();
    deck.enterPresentation();
    deck.press('ArrowRight');
    expectState(deck, '演示中导航', { currentIndex: 1, isPresentation: true });
    deck.press('Escape');
    expectState(deck, 'ESC 退出', { currentIndex: 1, isPresentation: false });

    deck.enterPresentation();
    assertTrue(deck.press(' ') === true, '空格退出', '应返回 preventDefault=true', deck);
    expectState(deck, '空格退出', { isPresentation: false });
  }),

  case_('演示模式进出不影响幻灯片数据与选中项', async () => {
    const deck = new DeckDriver();
    deck.goTo(1);
    deck.updateCurrent({ title: '增长复盘', noteFontSize: 20 });
    const slidesBefore = deck.slides;
    await deck.togglePresentation();
    await deck.togglePresentation();
    expectState(deck, '进出演示后', {
      currentIndex: 1,
      isPresentation: false,
      current: { title: '增长复盘', noteFontSize: 20 }
    });
    assertTrue(deck.slides === slidesBefore, '进出演示后', '幻灯片集合引用不应变化', deck);
  }),

  case_('演示进入/退出动作本身幂等', () => {
    const deck = new DeckDriver();
    deck.enterPresentation();
    const entered = deck.state;
    deck.enterPresentation();
    assertTrue(deck.state === entered, '重复进入演示', '应为空操作（引用不变）', deck);

    deck.exitPresentation();
    const exited = deck.state;
    deck.exitPresentation();
    assertTrue(deck.state === exited, '重复退出演示', '应为空操作（引用不变）', deck);
    expectState(deck, '幂等动作后', { isPresentation: false });
  })
];
