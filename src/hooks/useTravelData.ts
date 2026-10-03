import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TravelProject,
  Member,
  ItineraryItem,
  BudgetSplit,
  PackingItem,
  TravelData,
} from '../types';
import {
  TravelDataStore,
  createEmptyTravelData,
  type KeyValueStorage,
} from '../lib/travelDataStore';

const DEBOUNCE_DELAY = 300;

interface DebouncedStorage {
  storage: KeyValueStorage;
  cancelPending: () => void;
}

function createDebouncedLocalStorage(delay: number): DebouncedStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<string, string>();

  return {
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => {
        pending.set(key, value);
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          pending.forEach((pendingValue, pendingKey) => {
            localStorage.setItem(pendingKey, pendingValue);
          });
          pending.clear();
          timer = null;
        }, delay);
      },
      removeItem: (key) => localStorage.removeItem(key),
    },
    cancelPending: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function useTravelData() {
  const [data, setData] = useState<TravelData>(createEmptyTravelData);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const storeRef = useRef<TravelDataStore | null>(null);
  const debouncedRef = useRef<DebouncedStorage | null>(null);

  if (!storeRef.current) {
    const debounced = createDebouncedLocalStorage(DEBOUNCE_DELAY);
    debouncedRef.current = debounced;
    storeRef.current = new TravelDataStore({ storage: debounced.storage });
  }

  useEffect(() => {
    const loadData = () => {
      try {
        storeRef.current!.load();
      } catch (error) {
        console.error('Failed to load data from localStorage:', error);
      }
      setData(storeRef.current!.getData());
      setIsLoading(false);
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => void;
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(loadData);
    } else {
      setTimeout(loadData, 0);
    }

    return () => {
      debouncedRef.current?.cancelPending();
    };
  }, []);

  const mutate = useCallback(<T,>(fn: (store: TravelDataStore) => T): T => {
    const store = storeRef.current!;
    const result = fn(store);
    setData(store.getData());
    return result;
  }, []);

  const addProject = useCallback(
    (project: Omit<TravelProject, 'id' | 'createdAt'>) =>
      mutate((store) => store.addProject(project)),
    [mutate],
  );

  const updateProject = useCallback(
    (id: string, updates: Partial<TravelProject>) =>
      mutate((store) => store.updateProject(id, updates)),
    [mutate],
  );

  const deleteProject = useCallback(
    (id: string) => mutate((store) => store.deleteProject(id)),
    [mutate],
  );

  const addMember = useCallback(
    (member: Omit<Member, 'id'>) => mutate((store) => store.addMember(member)),
    [mutate],
  );

  const updateMember = useCallback(
    (id: string, updates: Partial<Member>) =>
      mutate((store) => store.updateMember(id, updates)),
    [mutate],
  );

  const deleteMember = useCallback(
    (id: string) => mutate((store) => store.deleteMember(id)),
    [mutate],
  );

  const addItineraryItem = useCallback(
    (item: Omit<ItineraryItem, 'id'>) =>
      mutate((store) => store.addItineraryItem(item)),
    [mutate],
  );

  const updateItineraryItem = useCallback(
    (id: string, updates: Partial<ItineraryItem>) =>
      mutate((store) => store.updateItineraryItem(id, updates)),
    [mutate],
  );

  const deleteItineraryItem = useCallback(
    (id: string) => mutate((store) => store.deleteItineraryItem(id)),
    [mutate],
  );

  const addBudgetSplit = useCallback(
    (split: Omit<BudgetSplit, 'id' | 'createdAt'>) =>
      mutate((store) => store.addBudgetSplit(split)),
    [mutate],
  );

  const updateBudgetSplit = useCallback(
    (id: string, updates: Partial<BudgetSplit>) =>
      mutate((store) => store.updateBudgetSplit(id, updates)),
    [mutate],
  );

  const deleteBudgetSplit = useCallback(
    (id: string) => mutate((store) => store.deleteBudgetSplit(id)),
    [mutate],
  );

  const addPackingItem = useCallback(
    (item: Omit<PackingItem, 'id'>) =>
      mutate((store) => store.addPackingItem(item)),
    [mutate],
  );

  const updatePackingItem = useCallback(
    (id: string, updates: Partial<PackingItem>) =>
      mutate((store) => store.updatePackingItem(id, updates)),
    [mutate],
  );

  const deletePackingItem = useCallback(
    (id: string) => mutate((store) => store.deletePackingItem(id)),
    [mutate],
  );

  return {
    data,
    isLoading,
    isVisible,
    addProject,
    updateProject,
    deleteProject,
    addMember,
    updateMember,
    deleteMember,
    addItineraryItem,
    updateItineraryItem,
    deleteItineraryItem,
    addBudgetSplit,
    updateBudgetSplit,
    deleteBudgetSplit,
    addPackingItem,
    updatePackingItem,
    deletePackingItem,
  };
}
