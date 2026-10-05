// 演示模式服务：把全屏能力抽象为可注入的端口。
// 状态推演（isPresentation）与浏览器全屏副作用解耦，
// 全屏接口缺失或调用失败时降级为纯状态切换，结果保持一致。

import type { StoryStore } from './storyState';

export interface FullscreenPort {
  request: () => Promise<void>;
  exit: () => Promise<void>;
  isActive: () => boolean;
}

/** 基于真实 DOM 的全屏实现；无 DOM 环境下各能力自动退化为空操作 */
export const domFullscreenPort: FullscreenPort = {
  request: async () => {
    if (typeof document !== 'undefined' && document.documentElement?.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  },
  exit: async () => {
    if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  },
  isActive: () =>
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
};

/** 进入演示模式：尽力请求全屏，无论全屏成败都进入演示态 */
export async function enterPresentation(
  store: StoryStore,
  port: FullscreenPort = domFullscreenPort
): Promise<void> {
  try {
    await port.request();
  } catch {
    // 全屏不可用或被拒绝：静默降级
  }
  store.dispatch({ type: 'setPresentation', value: true });
}

/** 退出演示模式：尽力退出全屏，无论全屏成败都退出演示态 */
export async function exitPresentation(
  store: StoryStore,
  port: FullscreenPort = domFullscreenPort
): Promise<void> {
  try {
    if (port.isActive()) {
      await port.exit();
    }
  } catch {
    // 忽略退出失败
  }
  store.dispatch({ type: 'setPresentation', value: false });
}

/** 演示模式开关：按当前状态进入或退出 */
export async function togglePresentation(
  store: StoryStore,
  port: FullscreenPort = domFullscreenPort
): Promise<void> {
  if (store.getState().isPresentation) {
    await exitPresentation(store, port);
  } else {
    await enterPresentation(store, port);
  }
}
