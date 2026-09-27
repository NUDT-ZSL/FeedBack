import { useCallback, useState } from 'react';

/**
 * State for an id list that is toggled optimistically: the change is applied
 * immediately and rolled back if the mutation rejects. Shared by favorites
 * and following so their duplicated toggle/rollback logic lives in one place.
 */
export function useOptimisticList(initialItems: string[] = []) {
  const [items, setItems] = useState<string[]>(initialItems);

  const toggle = useCallback(
    async (
      id: string,
      mutate: (isActive: boolean) => Promise<unknown>,
    ) => {
      const isActive = items.includes(id);

      setItems((prev) =>
        isActive ? prev.filter((x) => x !== id) : [...prev, id],
      );

      try {
        await mutate(isActive);
      } catch (error) {
        setItems((prev) =>
          isActive ? [...prev, id] : prev.filter((x) => x !== id),
        );
        throw error;
      }
    },
    [items],
  );

  return { items, setItems, toggle };
}
