import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ObservationRecord, CelestialBody } from '../types';

interface StarContextType {
  currentHour: number;
  setCurrentHour: (hour: number) => void;
  ra: number;
  dec: number;
  setRa: (ra: number) => void;
  setDec: (dec: number) => void;
  selectedStar: CelestialBody | null;
  setSelectedStar: (star: CelestialBody | null) => void;
  records: ObservationRecord[];
  addRecord: (star: CelestialBody, hour: number, ra: number, dec: number) => boolean;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
  showToast: string | null;
  setShowToast: (msg: string | null) => void;
}

const StarContext = createContext<StarContextType | undefined>(undefined);

export const StarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentHour, setCurrentHour] = useState(21);
  const [ra, setRa] = useState(0);
  const [dec, setDec] = useState(0);
  const [selectedStar, setSelectedStar] = useState<CelestialBody | null>(null);
  const [records, setRecords] = useState<ObservationRecord[]>([]);
  const [showToast, setShowToast] = useState<string | null>(null);

  const addRecord = useCallback((star: CelestialBody, hour: number, currentRa: number, currentDec: number) => {
    if (records.length >= 50) {
      setShowToast('观星册已满，请先删除旧录');
      setTimeout(() => setShowToast(null), 3000);
      return false;
    }
    const now = new Date();
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    const newRecord: ObservationRecord = {
      id: uuidv4(),
      timestamp: now,
      time: timeStr,
      starName: star.name,
      starColor: star.color,
      ra: currentRa,
      dec: currentDec,
      hour: hour,
    };
    setRecords(prev => [...prev, newRecord]);
    return true;
  }, [records.length]);

  const deleteRecord = useCallback((id: string) => {
    setRecords(prev => prev.filter(r => r.id !== id));
  }, []);

  const clearRecords = useCallback(() => {
    setRecords([]);
  }, []);

  const value = useMemo(() => ({
    currentHour,
    setCurrentHour,
    ra,
    dec,
    setRa,
    setDec,
    selectedStar,
    setSelectedStar,
    records,
    addRecord,
    deleteRecord,
    clearRecords,
    showToast,
    setShowToast,
  }), [currentHour, ra, dec, selectedStar, records, addRecord, deleteRecord, clearRecords, showToast]);

  return (
    <StarContext.Provider value={value}>
      {children}
    </StarContext.Provider>
  );
};

export const useStar = () => {
  const context = useContext(StarContext);
  if (context === undefined) {
    throw new Error('useStar must be used within a StarProvider');
  }
  return context;
};
