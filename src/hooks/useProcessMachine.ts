import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  PaperWorkshopMachine,
  createInitialState,
  type WorkshopEvent,
  type WorkshopState,
} from '@/core/processMachine';

/**
 * React 薄适配层：工序状态推进与质量计算全部在
 * `@/core/processMachine` 中（可在无浏览器环境批量验证）。
 * 所有外部操作路径（拖拽、点击、切换阶段）都收敛为 dispatch 一个语义事件，
 * 单次事件在上一份状态上原子地推导出下一份状态，快速连续操作不会互相覆盖。
 */
export function useProcessMachine(initialState?: WorkshopState) {
  const machine = useMemo(
    () => new PaperWorkshopMachine(initialState ?? createInitialState()),
    // 状态机实例在组件生命周期内保持稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => machine.subscribe(() => onStoreChange()),
    [machine],
  );
  const getSnapshot = useCallback(() => machine.getState(), [machine]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dispatch = useCallback((event: WorkshopEvent) => machine.dispatch(event), [machine]);

  return { state, dispatch, machine };
}
