import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DivinationKernel,
  type DispatchOutcome,
  type KernelEvent,
  type KernelState,
} from '../kernel/divinationKernel';

/**
 * 推演内核的 React 绑定：
 * 页面组件只通过 dispatch 投递输入事件、通过 state 渲染；
 * 光柱 / 错误的到期清理由内核给出的 nextExpiryAt 调度，
 * 定时器只负责“到点唤醒”，状态流转全部发生在内核内部。
 */
export function useDivinationKernel() {
  const kernelRef = useRef<DivinationKernel | null>(null);
  if (kernelRef.current === null) {
    kernelRef.current = new DivinationKernel();
  }
  const kernel = kernelRef.current;

  const [state, setState] = useState<KernelState>(() => kernel.getState());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatch = useCallback(
    (event: KernelEvent): DispatchOutcome => {
      const outcome = kernel.dispatch(event);
      setState(outcome.state);

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const nextExpiry = kernel.nextExpiryAt();
      if (nextExpiry !== null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          dispatch({ type: 'advanceTo', at: Date.now() });
        }, Math.max(0, nextExpiry - Date.now()));
      }
      return outcome;
    },
    [kernel],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return { state, dispatch };
}
