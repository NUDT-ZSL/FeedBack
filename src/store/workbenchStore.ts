import { useStore } from 'zustand';
import { createWorkbenchStore, STORAGE_KEY } from './workbench';
import type { WorkbenchStore, WorkbenchStoreApi } from './workbench';

const browserStorage = (): Storage | undefined => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
};

export const workbenchStore: WorkbenchStoreApi = createWorkbenchStore({
  storage: browserStorage(),
  storageKey: STORAGE_KEY,
});

export const useWorkbench = <T>(selector: (state: WorkbenchStore) => T): T =>
  useStore(workbenchStore, selector);
