import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { BudgetSplit } from '../../types';
import type { UpdateData } from './types';

export function useBudgetSplits(updateData: UpdateData) {
  const addBudgetSplit = useCallback(
    (split: Omit<BudgetSplit, 'id' | 'createdAt'>) => {
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
    },
    [updateData]
  );

  const updateBudgetSplit = useCallback(
    (id: string, updates: Partial<BudgetSplit>) => {
      updateData((prev) => ({
        ...prev,
        budgetSplits: prev.budgetSplits.map((b) =>
          b.id === id ? { ...b, ...updates } : b
        ),
      }));
    },
    [updateData]
  );

  const deleteBudgetSplit = useCallback(
    (id: string) => {
      updateData((prev) => ({
        ...prev,
        budgetSplits: prev.budgetSplits.filter((b) => b.id !== id),
      }));
    },
    [updateData]
  );

  return { addBudgetSplit, updateBudgetSplit, deleteBudgetSplit };
}
