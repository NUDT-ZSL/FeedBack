import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  TravelProject,
  Member,
  ItineraryItem,
  BudgetSplit,
  PackingItem,
  TravelData,
} from '../types';
import {
  STORAGE_KEY,
  createEmptyTravelData,
  loadTravelData,
  saveTravelData,
  insertProject,
  updateProject,
  removeProject,
  insertMember,
  updateMember,
  removeMember,
  insertItineraryItem,
  updateItineraryItem,
  removeItineraryItem,
  insertBudgetSplit,
  updateBudgetSplit,
  removeBudgetSplit,
  insertPackingItem,
  updatePackingItem,
  removePackingItem,
} from '../lib/travelData';

const DEBOUNCE_DELAY = 300;

export function useTravelData() {
  const [data, setData] = useState<TravelData>(createEmptyTravelData);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveToStorage = useCallback((newData: TravelData) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      saveTravelData(localStorage, newData, STORAGE_KEY);
    }, DEBOUNCE_DELAY);
  }, []);

  const loadFromStorage = useCallback(() => {
    return loadTravelData(localStorage, STORAGE_KEY);
  }, []);

  useEffect(() => {
    const loadData = () => {
      const loadedData = loadFromStorage();
      setData(loadedData);
      setIsLoading(false);
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(loadData);
    } else {
      setTimeout(loadData, 0);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [loadFromStorage]);

  const updateData = useCallback((updater: (prev: TravelData) => TravelData) => {
    setData((prev) => {
      const newData = updater(prev);
      saveToStorage(newData);
      return newData;
    });
  }, [saveToStorage]);

  const addProject = useCallback((project: Omit<TravelProject, 'id' | 'createdAt'>) => {
    const newProject: TravelProject = {
      ...project,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    updateData((prev) => insertProject(prev, newProject));
    return newProject;
  }, [updateData]);

  const updateProjectHandler = useCallback((id: string, updates: Partial<TravelProject>) => {
    updateData((prev) => updateProject(prev, id, updates));
  }, [updateData]);

  const deleteProject = useCallback((id: string) => {
    updateData((prev) => removeProject(prev, id));
  }, [updateData]);

  const addMember = useCallback((member: Omit<Member, 'id'>) => {
    const newMember: Member = {
      ...member,
      id: uuidv4(),
    };
    updateData((prev) => insertMember(prev, newMember));
    return newMember;
  }, [updateData]);

  const updateMemberHandler = useCallback((id: string, updates: Partial<Member>) => {
    updateData((prev) => updateMember(prev, id, updates));
  }, [updateData]);

  const deleteMember = useCallback((id: string) => {
    updateData((prev) => removeMember(prev, id));
  }, [updateData]);

  const addItineraryItem = useCallback((item: Omit<ItineraryItem, 'id'>) => {
    const newItem: ItineraryItem = {
      ...item,
      id: uuidv4(),
    };
    updateData((prev) => insertItineraryItem(prev, newItem));
    return newItem;
  }, [updateData]);

  const updateItineraryItemHandler = useCallback(
    (id: string, updates: Partial<ItineraryItem>) => {
      updateData((prev) => updateItineraryItem(prev, id, updates));
    },
    [updateData]
  );

  const deleteItineraryItem = useCallback((id: string) => {
    updateData((prev) => removeItineraryItem(prev, id));
  }, [updateData]);

  const addBudgetSplit = useCallback((split: Omit<BudgetSplit, 'id' | 'createdAt'>) => {
    const newSplit: BudgetSplit = {
      ...split,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    updateData((prev) => insertBudgetSplit(prev, newSplit));
    return newSplit;
  }, [updateData]);

  const updateBudgetSplitHandler = useCallback(
    (id: string, updates: Partial<BudgetSplit>) => {
      updateData((prev) => updateBudgetSplit(prev, id, updates));
    },
    [updateData]
  );

  const deleteBudgetSplit = useCallback((id: string) => {
    updateData((prev) => removeBudgetSplit(prev, id));
  }, [updateData]);

  const addPackingItem = useCallback((item: Omit<PackingItem, 'id'>) => {
    const newItem: PackingItem = {
      ...item,
      id: uuidv4(),
    };
    updateData((prev) => insertPackingItem(prev, newItem));
    return newItem;
  }, [updateData]);

  const updatePackingItemHandler = useCallback(
    (id: string, updates: Partial<PackingItem>) => {
      updateData((prev) => updatePackingItem(prev, id, updates));
    },
    [updateData]
  );

  const deletePackingItem = useCallback((id: string) => {
    updateData((prev) => removePackingItem(prev, id));
  }, [updateData]);

  return {
    data,
    isLoading,
    isVisible,
    addProject,
    updateProject: updateProjectHandler,
    deleteProject,
    addMember,
    updateMember: updateMemberHandler,
    deleteMember,
    addItineraryItem,
    updateItineraryItem: updateItineraryItemHandler,
    deleteItineraryItem,
    addBudgetSplit,
    updateBudgetSplit: updateBudgetSplitHandler,
    deleteBudgetSplit,
    addPackingItem,
    updatePackingItem: updatePackingItemHandler,
    deletePackingItem,
  };
}
