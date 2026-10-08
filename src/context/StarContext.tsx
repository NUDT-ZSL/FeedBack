import React, { createContext, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CelestialBody } from '../types';
import {
  createObservationStore,
  type ObservationState,
  type ObservationStore,
} from '../store/observationStore';

interface StarContextType extends Omit<ObservationState, 'toast'> {
  showToast: string | null;
  setCurrentHour: (hour: number) => void;
  setRa: (ra: number) => void;
  setDec: (dec: number) => void;
  adjustRa: (delta: number) => number;
  adjustDec: (delta: number) => number;
  setSelectedStar: (star: CelestialBody | null) => void;
  addRecord: () => boolean;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
  setShowToast: (message: string | null) => void;
}

const StarContext = createContext<StarContextType | undefined>(undefined);

export const StarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storeRef = useRef<ObservationStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createObservationStore();
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState);

  const value = useMemo<StarContextType>(() => {
    const { toast, ...rest } = state;
    return {
      ...rest,
      showToast: toast,
      setCurrentHour: store.setHour,
      setRa: store.setRa,
      setDec: store.setDec,
      adjustRa: store.adjustRa,
      adjustDec: store.adjustDec,
      setSelectedStar: store.selectStar,
      addRecord: store.addRecord,
      deleteRecord: store.deleteRecord,
      clearRecords: store.clearRecords,
      setShowToast: store.showToast,
    };
  }, [state, store]);

  return <StarContext.Provider value={value}>{children}</StarContext.Provider>;
};

export const useStar = () => {
  const context = useContext(StarContext);
  if (context === undefined) {
    throw new Error('useStar must be used within a StarProvider');
  }
  return context;
};
