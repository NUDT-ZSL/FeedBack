import React, { useSyncExternalStore, useMemo } from 'react';
import { CelestialBody, ObservationRecord } from '../types';
import * as store from '../store/observationStore';

export interface StarContextType {
  currentHour: number;
  setCurrentHour: typeof store.setCurrentHour;
  ra: number;
  dec: number;
  setRa: typeof store.setRa;
  setDec: typeof store.setDec;
  adjustRa: typeof store.adjustRa;
  adjustDec: typeof store.adjustDec;
  selectedStar: CelestialBody | null;
  setSelectedStar: typeof store.selectStar;
  records: ObservationRecord[];
  addRecord: typeof store.addRecord;
  recordCurrentObservation: typeof store.recordCurrentObservation;
  deleteRecord: typeof store.deleteRecord;
  clearRecords: typeof store.clearRecords;
  showToast: string | null;
  setShowToast: typeof store.setToast;
  showToastMessage: typeof store.showToastMessage;
}

export const useStar = (): StarContextType => {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);

  return useMemo<StarContextType>(
    () => ({
      currentHour: snapshot.currentHour,
      setCurrentHour: store.setCurrentHour,
      ra: snapshot.ra,
      dec: snapshot.dec,
      setRa: store.setRa,
      setDec: store.setDec,
      adjustRa: store.adjustRa,
      adjustDec: store.adjustDec,
      selectedStar: snapshot.selectedStar,
      setSelectedStar: store.selectStar,
      records: snapshot.records,
      addRecord: store.addRecord,
      recordCurrentObservation: store.recordCurrentObservation,
      deleteRecord: store.deleteRecord,
      clearRecords: store.clearRecords,
      showToast: snapshot.toast,
      setShowToast: store.setToast,
      showToastMessage: store.showToastMessage,
    }),
    [snapshot]
  );
};

export const StarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
