import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { PackingItem } from '../../types';
import type { UpdateData } from './types';

export function usePackingItems(updateData: UpdateData) {
  const addPackingItem = useCallback(
    (item: Omit<PackingItem, 'id'>) => {
      const newItem: PackingItem = {
        ...item,
        id: uuidv4(),
      };
      updateData((prev) => ({
        ...prev,
        packingItems: [...prev.packingItems, newItem].sort(
          (a, b) => a.order - b.order
        ),
      }));
      return newItem;
    },
    [updateData]
  );

  const updatePackingItem = useCallback(
    (id: string, updates: Partial<PackingItem>) => {
      updateData((prev) => ({
        ...prev,
        packingItems: prev.packingItems
          .map((p) => (p.id === id ? { ...p, ...updates } : p))
          .sort((a, b) => a.order - b.order),
      }));
    },
    [updateData]
  );

  const deletePackingItem = useCallback(
    (id: string) => {
      updateData((prev) => ({
        ...prev,
        packingItems: prev.packingItems.filter((p) => p.id !== id),
      }));
    },
    [updateData]
  );

  return { addPackingItem, updatePackingItem, deletePackingItem };
}
