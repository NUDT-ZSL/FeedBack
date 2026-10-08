import { v4 as uuidv4 } from 'uuid';
import { CelestialBody, ObservationRecord } from '../types';
import { clamp, cartesianToSpherical, hourToShichen } from '../utils';

export interface ObservationState {
  currentHour: number;
  ra: number;
  dec: number;
  selectedStar: CelestialBody | null;
  records: ObservationRecord[];
  toast: string | null;
}

export const MAX_RECORDS = 50;
export const RECORDS_FULL_MESSAGE = '观星册已满，请先删除旧录';
export const TOAST_DURATION_MS = 3000;

const initialState = (): ObservationState => ({
  currentHour: 21,
  ra: 0,
  dec: 0,
  selectedStar: null,
  records: [],
  toast: null,
});

let state: ObservationState = initialState();

const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const setState = (patch: Partial<ObservationState>) => {
  state = { ...state, ...patch };
  emit();
};

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getState = (): ObservationState => state;

export const resetObservationState = (): void => {
  state = initialState();
  emit();
};

let toastToken = 0;
let toastTimer: (ReturnType<typeof setTimeout> & { unref?: () => void }) | null = null;

const scheduleToastClear = (durationMs: number) => {
  const token = ++toastToken;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  const timer = setTimeout(() => {
    if (token === toastToken) {
      setState({ toast: null });
    }
  }, durationMs) as ReturnType<typeof setTimeout> & { unref?: () => void };
  toastTimer = timer;
  timer.unref?.();
};

export const setToast = (message: string | null): void => {
  if (message === null) {
    toastToken += 1;
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  setState({ toast: message });
};

export const showToastMessage = (message: string, durationMs: number = TOAST_DURATION_MS): void => {
  setState({ toast: message });
  scheduleToastClear(durationMs);
};

export const normalizeHour = (hour: number): number => ((hour % 24) + 24) % 24;

export const setCurrentHour = (hour: number): number => {
  const next = normalizeHour(hour);
  setState({ currentHour: next });
  return next;
};

export const setRa = (ra: number): void => {
  setState({ ra });
};

export const setDec = (dec: number): void => {
  setState({ dec });
};

export const adjustRa = (delta: number): number => {
  const next = ((state.ra + delta) % 360 + 360) % 360;
  setState({ ra: next });
  return next;
};

export const adjustDec = (delta: number): number => {
  const next = clamp(state.dec + delta, -90, 90);
  setState({ dec: next });
  return next;
};

export const selectStar = (star: CelestialBody | null): void => {
  setState({ selectedStar: star });
};

export const addRecord = (
  star: CelestialBody,
  hour: number,
  ra: number,
  dec: number
): boolean => {
  if (state.records.length >= MAX_RECORDS) {
    showToastMessage(RECORDS_FULL_MESSAGE);
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
    ra,
    dec,
    hour,
  };
  setState({ records: [...state.records, newRecord] });
  return true;
};

export const recordCurrentObservation = (): boolean => {
  const snapshot = state;
  if (!snapshot.selectedStar) {
    return false;
  }
  const coords = getSelectedStarCoords(snapshot);
  if (!coords) {
    return false;
  }
  return addRecord(snapshot.selectedStar, snapshot.currentHour, coords.ra, coords.dec);
};

export const deleteRecord = (id: string): void => {
  setState({ records: state.records.filter((record) => record.id !== id) });
};

export const clearRecords = (): void => {
  setState({ records: [] });
};

export const getShichenIndex = (snapshot: ObservationState = state): number =>
  hourToShichen(snapshot.currentHour);

export const getSkyRotationRad = (snapshot: ObservationState = state): number =>
  (snapshot.currentHour / 24) * Math.PI * 2;

export const getSkyRotationDeg = (snapshot: ObservationState = state): number =>
  (snapshot.currentHour / 24) * 360;

export const getSelectedStarCoords = (
  snapshot: ObservationState = state
): { ra: number; dec: number } | null => {
  if (!snapshot.selectedStar) {
    return null;
  }
  const { ra, dec } = cartesianToSpherical(...snapshot.selectedStar.position);
  return { ra, dec };
};

export const buildChartAnnotations = (
  now: Date,
  snapshot: ObservationState = state
): { timeLine: string; coordLine: string } => ({
  timeLine: `观测时间: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${snapshot.currentHour.toFixed(0)}时`,
  coordLine: `赤经: ${snapshot.ra.toFixed(1)}° 赤纬: ${snapshot.dec.toFixed(1)}°`,
});
