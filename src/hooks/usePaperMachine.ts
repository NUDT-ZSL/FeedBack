import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  createPaperMachine,
  type MachineEvent,
  type MachineState,
} from '@/state/paperMachine';

/**
 * React binding for the pure paper-making state machine.
 * All state transitions go through a single dispatch pipeline, so
 * interleaved updates (e.g. rapid scoop drags and drying ticks) merge
 * deterministically instead of overwriting each other.
 */
export function usePaperMachine() {
  const machine = useMemo(() => createPaperMachine(), []);

  const state = useSyncExternalStore<MachineState>(
    useCallback((onStoreChange) => machine.subscribe(() => onStoreChange()), [machine]),
    () => machine.getState(),
    () => machine.getState(),
  );

  const dispatch = useCallback((event: MachineEvent) => machine.dispatch(event), [machine]);

  return { state, dispatch, machine };
}
