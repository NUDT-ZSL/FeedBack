import { useCallback, useState } from 'react';
import {
  WorkshopEngine,
  loadHistory,
  saveHistory,
  toHistoryRecord,
  type HistoryRecordV2,
  type Operation,
  type Recipe,
  type WorkshopState,
} from '@/simulation';

export function useWorkshop() {
  const [recipe, setRecipe] = useState<Recipe>({ bark: 20, bamboo: 30, water: 350 });
  const [engine, setEngine] = useState<WorkshopEngine | null>(null);
  const [state, setState] = useState<WorkshopState | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [history, setHistory] = useState<HistoryRecordV2[]>(() => loadHistory());

  const start = useCallback(() => {
    const next = new WorkshopEngine(recipe);
    setEngine(next);
    setState({ ...next.getState() });
    setOperations([]);
  }, [recipe]);

  const apply = useCallback(
    (operation: Operation) => {
      if (!engine) return;
      engine.apply(operation);
      setOperations((prev) => [...prev, operation]);
      setState({ ...engine.getState() });
    },
    [engine],
  );

  const reset = useCallback(() => {
    setEngine(null);
    setState(null);
    setOperations([]);
  }, []);

  const saveRecord = useCallback(() => {
    if (!state) return;
    const record = toHistoryRecord(
      `batch-${Date.now()}`,
      Date.now(),
      state,
      operations,
    );
    setHistory((prev) => {
      const next = [record, ...prev];
      saveHistory(next);
      return next;
    });
  }, [state, operations]);

  return {
    recipe,
    setRecipe,
    state,
    started: engine !== null,
    apply,
    start,
    reset,
    history,
    saveRecord,
  };
}
