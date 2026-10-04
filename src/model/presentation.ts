// 演示模式与键盘导航的纯逻辑：全屏能力通过 FullscreenPort 注入，
// 在没有 Fullscreen API（无 DOM / 测试替身）的环境下走降级路径，
// 状态结果与全屏可用时保持一致。

import type { DeckAction, DeckState, Direction } from './slides.js';

export interface FullscreenPort {
  request(): Promise<void> | void;
  exit(): Promise<void> | void;
  readonly isActive: boolean;
}

export const createBrowserFullscreenPort = (
  doc: Document = document
): FullscreenPort => ({
  request: () => doc.documentElement.requestFullscreen(),
  exit: () => doc.exitFullscreen(),
  get isActive() {
    return Boolean(doc.fullscreenElement);
  }
});

// 无全屏能力时的降级端口：不抛错、不依赖任何真实接口。
export const createNullFullscreenPort = (): FullscreenPort => {
  let active = false;
  return {
    async request() {
      active = true;
    },
    async exit() {
      active = false;
    },
    get isActive() {
      return active;
    }
  };
};

export interface PresentationToggleResult {
  state: DeckState;
  /** 供调用方派发的动作；调用方仍可选择自行派发。 */
  action: Extract<DeckAction, { type: 'presentation-enter' | 'presentation-exit' }>;
}

// 与 App 原有口径一致：进入时全屏请求成功或失败都会进入演示模式；
// 退出时全屏接口异常被吞掉，演示模式照常退出。
export const togglePresentation = async (
  state: DeckState,
  port: FullscreenPort = createNullFullscreenPort()
): Promise<PresentationToggleResult> => {
  if (!state.isPresentation) {
    try {
      await port.request();
    } catch {
      // 全屏被拒绝或接口缺失：降级为纯状态演示模式。
    }
    return {
      state: { ...state, isPresentation: true },
      action: { type: 'presentation-enter' }
    };
  }
  try {
    if (port.isActive) {
      await port.exit();
    }
  } catch {
    // 退出全屏失败不阻塞演示模式退出。
  }
  return {
    state: { ...state, isPresentation: false },
    action: { type: 'presentation-exit' }
  };
};

// 原生 fullscreenchange（或替身触发）时的纯状态口径：
// 一旦不再处于全屏且当前为演示模式，则退出演示模式。
export const fullscreenChangeAction = (
  state: DeckState,
  port: FullscreenPort = createNullFullscreenPort()
): Extract<DeckAction, { type: 'fullscreen-lost' }> | null =>
  !port.isActive && state.isPresentation ? { type: 'fullscreen-lost' } : null;

export interface KeyCommand {
  action: DeckAction;
  /** 是否应对该按键调用 preventDefault。 */
  preventDefault: boolean;
}

// 键盘口径（与 App 行为一致）：
// - 演示模式下 ESC / 空格退出；
// - 任意模式下方向键推进/后退，边界处动作仍派发但由 reducer 静默忽略。
export const resolveKeyCommand = (
  key: string,
  state: DeckState
): KeyCommand | null => {
  if (state.isPresentation && (key === 'Escape' || key === ' ')) {
    return { action: { type: 'presentation-exit' }, preventDefault: true };
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return { action: { type: 'go-next' }, preventDefault: true };
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return { action: { type: 'go-prev' }, preventDefault: true };
  }
  return null;
};

export const applyKey = (
  state: DeckState,
  key: string,
  dispatch: (action: DeckAction) => void
): boolean => {
  const command = resolveKeyCommand(key, state);
  if (!command) return false;
  dispatch(command.action);
  return command.preventDefault;
};

export const directionOf = (from: number, to: number): Direction =>
  to > from ? 'forward' : 'backward';
