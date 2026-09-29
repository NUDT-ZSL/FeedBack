import { useState, useCallback, useEffect } from 'react';
import type { Plant, CareRecord, Reminder, CareType, PlantCategory, Difficulty } from '../types';

const API_BASE = '/api';

export function usePlants() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/plants`);
      if (!res.ok) throw new Error('Failed to fetch plants');
      const data = await res.json();
      setPlants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlantById = useCallback(async (id: string): Promise<Plant | null> => {
    try {
      const res = await fetch(`${API_BASE}/plants/${id}`);
      if (!res.ok) throw new Error('Failed to fetch plant');
      return await res.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  const addPlant = useCallback(async (plantData: {
    name: string;
    category: PlantCategory;
    purchaseDate: string;
    difficulty: Difficulty;
    image?: string;
    nextWateringDate?: string;
    nextFertilizingDate?: string;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/plants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plantData),
      });
      if (!res.ok) throw new Error('Failed to add plant');
      const newPlant = await res.json();
      setPlants(prev => [...prev, newPlant]);
      return newPlant;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    }
  }, []);

  const updatePlant = useCallback(async (id: string, updates: Partial<Plant>) => {
    try {
      const res = await fetch(`${API_BASE}/plants/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update plant');
      const updated = await res.json();
      setPlants(prev => prev.map(p => p.id === id ? updated : p));
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    }
  }, []);

  const fetchRecords = useCallback(async (plantId: string): Promise<CareRecord[]> => {
    try {
      const res = await fetch(`${API_BASE}/plants/${plantId}/records`);
      if (!res.ok) throw new Error('Failed to fetch records');
      return await res.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return [];
    }
  }, []);

  const addRecord = useCallback(async (plantId: string, recordData: {
    type: CareType;
    note?: string;
  }): Promise<{ record: CareRecord; healthScore: number } | null> => {
    try {
      const res = await fetch(`${API_BASE}/plants/${plantId}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData),
      });
      if (!res.ok) throw new Error('Failed to add record');
      const result = await res.json();
      await fetchPlants();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [fetchPlants]);

  const fetchTodayReminders = useCallback(async (): Promise<Reminder[]> => {
    try {
      const res = await fetch(`${API_BASE}/reminders/today`);
      if (!res.ok) throw new Error('Failed to fetch reminders');
      return await res.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return [];
    }
  }, []);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  return {
    plants,
    loading,
    error,
    fetchPlants,
    fetchPlantById,
    addPlant,
    updatePlant,
    fetchRecords,
    addRecord,
    fetchTodayReminders,
  };
}
