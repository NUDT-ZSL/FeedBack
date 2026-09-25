import { useState, useEffect, useCallback, useRef } from 'react';
import type { TravelData } from '../types';
import {
  initialData,
  loadFromStorage,
  saveToStorage,
  DEBOUNCE_DELAY,
} from './travelData/storage';
import type { UpdateData } from './travelData/types';
import { useProjects } from './travelData/useProjects';
import { useMembers } from './travelData/useMembers';
import { useItineraryItems } from './travelData/useItineraryItems';
import { useBudgetSplits } from './travelData/useBudgetSplits';
import { usePackingItems } from './travelData/usePackingItems';

export function useTravelData() {
  const [data, setData] = useState<TravelData>(initialData);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedSave = useCallback((newData: TravelData) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      saveToStorage(newData);
    }, DEBOUNCE_DELAY);
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

    if ('requestIdleCallback' in window) {
      (
        window as Window & { requestIdleCallback: (cb: () => void) => void }
      ).requestIdleCallback(loadData);
    } else {
      setTimeout(loadData, 0);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const updateData: UpdateData = useCallback(
    (updater) => {
      setData((prev) => {
        const newData = updater(prev);
        debouncedSave(newData);
        return newData;
      });
    },
    [debouncedSave]
  );

  const { addProject, updateProject, deleteProject } = useProjects(updateData);
  const { addMember, updateMember, deleteMember } = useMembers(updateData);
  const { addItineraryItem, updateItineraryItem, deleteItineraryItem } =
    useItineraryItems(updateData);
  const { addBudgetSplit, updateBudgetSplit, deleteBudgetSplit } =
    useBudgetSplits(updateData);
  const { addPackingItem, updatePackingItem, deletePackingItem } =
    usePackingItems(updateData);

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
