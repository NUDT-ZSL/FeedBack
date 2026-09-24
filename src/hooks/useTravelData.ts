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

const STORAGE_KEY = 'travel_planner_data';
const DEBOUNCE_DELAY = 300;

const initialData: TravelData = {
  projects: [],
  members: [],
  itineraryItems: [],
  budgetSplits: [],
  packingItems: [],
};

export function useTravelData() {
  const [data, setData] = useState<TravelData>(initialData);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const saveToStorage = useCallback((newData: TravelData) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
    }, DEBOUNCE_DELAY);
  }, []);

  const loadFromStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as TravelData;
      }
    } catch (error) {
      console.error('Failed to load data from localStorage:', error);
    }
    return initialData;
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
      (window as any).requestIdleCallback(loadData);
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
    updateData((prev) => ({
      ...prev,
      projects: [...prev.projects, newProject],
    }));
    return newProject;
  }, [updateData]);

  const updateProject = useCallback((id: string, updates: Partial<TravelProject>) => {
    updateData((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    }));
  }, [updateData]);

  const deleteProject = useCallback((id: string) => {
    updateData((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== id),
      members: prev.members.filter((m) => m.projectId !== id),
      itineraryItems: prev.itineraryItems.filter((i) => i.projectId !== id),
      budgetSplits: prev.budgetSplits.filter((b) => b.projectId !== id),
      packingItems: prev.packingItems.filter((p) => p.projectId !== id),
    }));
  }, [updateData]);

  const addMember = useCallback((member: Omit<Member, 'id'>) => {
    const newMember: Member = {
      ...member,
      id: uuidv4(),
    };
    updateData((prev) => ({
      ...prev,
      members: [...prev.members, newMember],
    }));
    return newMember;
  }, [updateData]);

  const updateMember = useCallback((id: string, updates: Partial<Member>) => {
    updateData((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
  }, [updateData]);

  const deleteMember = useCallback((id: string) => {
    updateData((prev) => ({
      ...prev,
      members: prev.members.filter((m) => m.id !== id),
    }));
  }, [updateData]);

  const addItineraryItem = useCallback((item: Omit<ItineraryItem, 'id'>) => {
    const newItem: ItineraryItem = {
      ...item,
      id: uuidv4(),
    };
    updateData((prev) => ({
      ...prev,
      itineraryItems: [...prev.itineraryItems, newItem].sort((a, b) => a.order - b.order),
    }));
    return newItem;
  }, [updateData]);

  const updateItineraryItem = useCallback((id: string, updates: Partial<ItineraryItem>) => {
    updateData((prev) => ({
      ...prev,
      itineraryItems: prev.itineraryItems
        .map((i) => (i.id === id ? { ...i, ...updates } : i))
        .sort((a, b) => a.order - b.order),
    }));
  }, [updateData]);

  const deleteItineraryItem = useCallback((id: string) => {
    updateData((prev) => ({
      ...prev,
      itineraryItems: prev.itineraryItems.filter((i) => i.id !== id),
    }));
  }, [updateData]);

  const addBudgetSplit = useCallback((split: Omit<BudgetSplit, 'id' | 'createdAt'>) => {
    const newSplit: BudgetSplit = {
      ...split,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    updateData((prev) => ({
      ...prev,
      budgetSplits: [...prev.budgetSplits, newSplit],
    }));
    return newSplit;
  }, [updateData]);

  const updateBudgetSplit = useCallback((id: string, updates: Partial<BudgetSplit>) => {
    updateData((prev) => ({
      ...prev,
      budgetSplits: prev.budgetSplits.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    }));
  }, [updateData]);

  const deleteBudgetSplit = useCallback((id: string) => {
    updateData((prev) => ({
      ...prev,
      budgetSplits: prev.budgetSplits.filter((b) => b.id !== id),
    }));
  }, [updateData]);

  const addPackingItem = useCallback((item: Omit<PackingItem, 'id'>) => {
    const newItem: PackingItem = {
      ...item,
      id: uuidv4(),
    };
    updateData((prev) => ({
      ...prev,
      packingItems: [...prev.packingItems, newItem].sort((a, b) => a.order - b.order),
    }));
    return newItem;
  }, [updateData]);

  const updatePackingItem = useCallback((id: string, updates: Partial<PackingItem>) => {
    updateData((prev) => ({
      ...prev,
      packingItems: prev.packingItems
        .map((p) => (p.id === id ? { ...p, ...updates } : p))
        .sort((a, b) => a.order - b.order),
    }));
  }, [updateData]);

  const deletePackingItem = useCallback((id: string) => {
    updateData((prev) => ({
      ...prev,
      packingItems: prev.packingItems.filter((p) => p.id !== id),
    }));
  }, [updateData]);

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
