// 演示模式服务验证：全屏端口可用 / 拒绝 / 失败 / 缺失下的状态降级一致性。
// 全部使用本地替身端口，不触碰真实 document.fullscreen 或任何在线资源。

import type { FullscreenPort } from '../src/state/presentation';
import {
  enterPresentation,
  exitPresentation,
  togglePresentation
} from '../src/state/presentation';
import { test, createTestStore, expectState, expectEqual } from './harness';

class FakeFullscreenPort implements FullscreenPort {
  active = false;
  requestCalls = 0;
  exitCalls = 0;
  failRequest = false;
  failExit = false;

  async request(): Promise<void> {
    this.requestCalls += 1;
    if (this.failRequest) throw new Error('requestFullscreen rejected');
    this.active = true;
  }

  async exit(): Promise<void> {
    this.exitCalls += 1;
    if (this.failExit) throw new Error('exitFullscreen failed');
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

const noopFullscreenPort: FullscreenPort = {
  request: async () => {},
  exit: async () => {},
  isActive: () => false
};

test('全屏可用：进入/退出演示模式状态与端口调用一致', async t => {
  const store = createTestStore();
  const port = new FakeFullscreenPort();

  await togglePresentation(store, port);
  expectState(t, store.getState(), { isPresentation: true }, '切换后进入演示模式');
  expectEqual(t, port.requestCalls, 1, '请求全屏一次');
  expectEqual(t, port.isActive(), true, '全屏已激活');

  await togglePresentation(store, port);
  expectState(t, store.getState(), { isPresentation: false }, '再次切换退出演示模式');
  expectEqual(t, port.exitCalls, 1, '退出全屏一次');
  expectEqual(t, port.isActive(), false, '全屏已关闭');
});

test('全屏请求被拒绝：静默降级，仍进入演示模式', async t => {
  const store = createTestStore();
  const port = new FakeFullscreenPort();
  port.failRequest = true;

  await enterPresentation(store, port);
  expectState(t, store.getState(), { isPresentation: true }, '拒绝后状态仍一致进入');
  expectEqual(t, port.isActive(), false, '全屏未激活');
  expectEqual(t, port.exitCalls, 0, '退出时不调用 exit（本来就未激活）');

  await exitPresentation(store, port);
  expectState(t, store.getState(), { isPresentation: false }, '降级进入后可正常退出');
});

test('退出全屏失败：演示状态仍一致退出，不抛出异常', async t => {
  const store = createTestStore();
  const port = new FakeFullscreenPort();

  await enterPresentation(store, port);
  port.failExit = true;
  await exitPresentation(store, port);
  expectState(t, store.getState(), { isPresentation: false }, 'exit 抛错后仍退出演示模式');

  // 可重新进入，状态机不受失败副作用影响
  await enterPresentation(store, port);
  expectState(t, store.getState(), { isPresentation: true }, '失败后可重新进入');
});

test('无全屏能力端口（空操作）：进出演示模式状态完全一致', async t => {
  const store = createTestStore();

  await enterPresentation(store, noopFullscreenPort);
  expectState(t, store.getState(), { isPresentation: true }, '无全屏能力也进入演示模式');

  await exitPresentation(store, noopFullscreenPort);
  expectState(t, store.getState(), { isPresentation: false }, '无全屏能力也退出演示模式');

  await togglePresentation(store, noopFullscreenPort);
  expectState(t, store.getState(), { isPresentation: true }, '切换开关进入');
  await togglePresentation(store, noopFullscreenPort);
  expectState(t, store.getState(), { isPresentation: false }, '切换开关退出');
});

test('重复进入/退出：状态保持幂等', async t => {
  const store = createTestStore();
  const port = new FakeFullscreenPort();

  await enterPresentation(store, port);
  const stateAfterFirstEnter = JSON.stringify(store.getState());
  await enterPresentation(store, port);
  expectEqual(t, JSON.stringify(store.getState()), stateAfterFirstEnter, '重复进入不改变状态');
  expectState(t, store.getState(), { isPresentation: true }, '仍为演示模式');

  await exitPresentation(store, port);
  const stateAfterFirstExit = JSON.stringify(store.getState());
  await exitPresentation(store, port);
  expectEqual(t, JSON.stringify(store.getState()), stateAfterFirstExit, '重复退出不改变状态');
  expectState(t, store.getState(), { isPresentation: false }, '仍为非演示模式');
});

test('全屏变更回调模拟：系统级退出全屏时同步退出演示态', async t => {
  // 复刻 App 中 fullscreenchange 处理：非全屏且处于演示态时派发 setPresentation(false)。
  // 此逻辑只依赖纯状态机，无需真实全屏事件。
  const store = createTestStore();
  const port = new FakeFullscreenPort();
  await enterPresentation(store, port);

  const handleFullscreenChange = (): void => {
    if (!port.isActive() && store.getState().isPresentation) {
      store.dispatch({ type: 'setPresentation', value: false });
    }
  };

  port.active = false; // 模拟用户在浏览器层面退出全屏（如按 F11）
  handleFullscreenChange();
  expectState(t, store.getState(), { isPresentation: false }, '系统级退出全屏后演示态同步关闭');

  port.active = true; // 全屏仍激活时不应误触发
  store.dispatch({ type: 'setPresentation', value: true });
  handleFullscreenChange();
  expectState(t, store.getState(), { isPresentation: true }, '全屏仍激活时演示态保持不变');
});
