import type { CelestialBody, ObservationRecord } from '../types.ts';
import { clamp, cartesianToSpherical, formatTime } from '../utils.ts';

export const MAX_RECORDS = 50;
export const TOAST_DURATION_MS = 3000;
export const TOAST_RECORDS_FULL = '观星册已满，请先删除旧录';
export const TOAST_NO_STAR = '请先选择一颗星体';

export interface ObservationState {
  ra: number;
  dec: number;
  currentHour: number;
  selectedStar: CelestialBody | null;
  records: ObservationRecord[];
  toast: string | null;
}

export const normalizeRa = (ra: number): number => ((ra % 360) + 360) % 360;

export const normalizeDec = (dec: number): number => clamp(dec, -90, 90);

export const normalizeHour = (hour: number): number =>
  ((hour % 24) + 24) % 24;

export interface ObservationStore {
  getState: () => ObservationState;
  subscribe: (listener: () => void) => () => void;
  setRa: (ra: number) => number;
  adjustRa: (delta: number) => number;
  setDec: (dec: number) => number;
  adjustDec: (delta: number) => number;
  setHour: (hour: number) => number;
  selectStar: (star: CelestialBody | null) => void;
  addRecord: () => boolean;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
  showToast: (message: string | null) => void;
}

const createId = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `rec-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
};

export const createObservationStore = (
  initial?: Partial<ObservationState>
): ObservationStore => {
  let state: ObservationState = {
    ra: 0,
    dec: 0,
    currentHour: 21,
    selectedStar: null,
    records: [],
    toast: null,
    ...initial,
  };

  const listeners = new Set<() => void>();
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const update = (patch: Partial<ObservationState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const showToast = (message: string | null) => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (message !== null) {
      toastTimer = setTimeout(() => {
        toastTimer = null;
        update({ toast: null });
      }, TOAST_DURATION_MS);
      const unrefable = toastTimer as unknown as { unref?: () => void };
      if (typeof unrefable.unref === 'function') unrefable.unref();
    }
    update({ toast: message });
  };

  const setRa = (ra: number): number => {
    const next = normalizeRa(ra);
    update({ ra: next });
    return next;
  };

  const adjustRa = (delta: number): number => setRa(state.ra + delta);

  const setDec = (dec: number): number => {
    const next = normalizeDec(dec);
    update({ dec: next });
    return next;
  };

  const adjustDec = (delta: number): number => setDec(state.dec + delta);

  const setHour = (hour: number): number => {
    const next = normalizeHour(hour);
    update({ currentHour: next });
    return next;
  };

  const selectStar = (star: CelestialBody | null) => {
    if (star === null) {
      update({ selectedStar: null });
      return;
    }
    if (state.selectedStar && state.selectedStar.name === star.name) {
      update({ selectedStar: null });
      return;
    }
    const { ra, dec } = cartesianToSpherical(...star.position);
    update({
      selectedStar: star,
      ra: normalizeRa(ra),
      dec: normalizeDec(dec),
    });
  };

  const addRecord = (): boolean => {
    const star = state.selectedStar;
    if (!star) {
      showToast(TOAST_NO_STAR);
      return false;
    }
    if (state.records.length >= MAX_RECORDS) {
      showToast(TOAST_RECORDS_FULL);
      return false;
    }
    const record: ObservationRecord = {
      id: createId(),
      timestamp: new Date(),
      time: formatTime(state.currentHour),
      starName: star.name,
      starColor: star.color,
      ra: state.ra,
      dec: state.dec,
      hour: state.currentHour,
    };
    update({ records: [...state.records, record] });
    return true;
  };

  const deleteRecord = (id: string) => {
    update({ records: state.records.filter((r) => r.id !== id) });
  };

  const clearRecords = () => {
    update({ records: [] });
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getState: () => state,
    subscribe,
    setRa,
    adjustRa,
    adjustDec,
    setDec,
    setHour,
    selectStar,
    addRecord,
    deleteRecord,
    clearRecords,
    showToast,
  };
};
