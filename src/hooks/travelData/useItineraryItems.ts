import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ItineraryItem } from '../../types';
import type { UpdateData } from './types';

export function useItineraryItems(updateData: UpdateData) {
  const addItineraryItem = useCallback(
    (item: Omit<ItineraryItem, 'id'>) => {
      const newItem: ItineraryItem = {
        ...item,
        id: uuidv4(),
      };
      updateData((prev) => ({
        ...prev,
        itineraryItems: [...prev.itineraryItems, newItem].sort(
          (a, b) => a.order - b.order
        ),
      }));
      return newItem;
    },
    [updateData]
  );

  const updateItineraryItem = useCallback(
    (id: string, updates: Partial<ItineraryItem>) => {
      updateData((prev) => ({
        ...prev,
        itineraryItems: prev.itineraryItems
          .map((i) => (i.id === id ? { ...i, ...updates } : i))
          .sort((a, b) => a.order - b.order),
      }));
    },
    [updateData]
  );

  const deleteItineraryItem = useCallback(
    (id: string) => {
      updateData((prev) => ({
        ...prev,
        itineraryItems: prev.itineraryItems.filter((i) => i.id !== id),
      }));
    },
    [updateData]
  );

  return { addItineraryItem, updateItineraryItem, deleteItineraryItem };
}
