import type { TravelData } from '../../types';

export const STORAGE_KEY = 'travel_planner_data';
export const DEBOUNCE_DELAY = 300;

export const initialData: TravelData = {
  projects: [],
  members: [],
  itineraryItems: [],
  budgetSplits: [],
  packingItems: [],
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// Each entity field is sanitized independently so that a missing or
// malformed field never prevents the other entities from loading.
export function sanitizeTravelData(raw: unknown): TravelData {
  const source =
    raw !== null && typeof raw === 'object'
      ? (raw as Partial<Record<keyof TravelData, unknown>>)
      : {};
  return {
    projects: asArray(source.projects),
    members: asArray(source.members),
    itineraryItems: asArray(source.itineraryItems),
    budgetSplits: asArray(source.budgetSplits),
    packingItems: asArray(source.packingItems),
  };
}

export function loadFromStorage(): TravelData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return sanitizeTravelData(JSON.parse(stored));
    }
  } catch (error) {
    console.error('Failed to load data from localStorage:', error);
  }
  return initialData;
}

export function saveToStorage(data: TravelData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
