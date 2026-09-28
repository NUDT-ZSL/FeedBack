import { create } from 'zustand';
import { Schedule, Band, NotificationItem } from '../types';

interface AppState {
  schedules: Schedule[];
  bands: Band[];
  favorites: string[];
  notifications: NotificationItem[];
  isAdmin: boolean;

  setSchedules: (schedules: Schedule[]) => void;
  addSchedule: (schedule: Schedule) => void;
  updateSchedule: (schedule: Schedule) => void;
  removeSchedule: (id: string) => void;

  setBands: (bands: Band[]) => void;
  updateBandStatus: (id: string, status: Band['status']) => void;

  toggleFavorite: (bandId: string) => void;
  isFavorite: (bandId: string) => boolean;

  addNotification: (notification: Omit<NotificationItem, 'id'>) => void;
  removeNotification: (id: string) => void;

  setIsAdmin: (isAdmin: boolean) => void;
}

const loadFavorites = (): string[] => {
  try {
    const saved = localStorage.getItem('festival_favorites');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const saveFavorites = (favorites: string[]) => {
  try {
    localStorage.setItem('festival_favorites', JSON.stringify(favorites));
  } catch {
    console.error('收藏保存失败');
  }
};

export const useStore = create<AppState>((set, get) => ({
  schedules: [],
  bands: [],
  favorites: loadFavorites(),
  notifications: [],
  isAdmin: false,

  setSchedules: (schedules) => set({ schedules }),
  addSchedule: (schedule) => set(state => ({
    schedules: [...state.schedules, schedule].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )
  })),
  updateSchedule: (schedule) => set(state => ({
    schedules: state.schedules.map(s => s.id === schedule.id ? schedule : s)
  })),
  removeSchedule: (id) => set(state => ({
    schedules: state.schedules.filter(s => s.id !== id)
  })),

  setBands: (bands) => set({ bands }),
  updateBandStatus: (id, status) => set(state => ({
    bands: state.bands.map(b => b.id === id ? { ...b, status } : b)
  })),

  toggleFavorite: (bandId) => {
    const favorites = get().favorites;
    const newFavorites = favorites.includes(bandId)
      ? favorites.filter(id => id !== bandId)
      : [...favorites, bandId];
    saveFavorites(newFavorites);
    set({ favorites: newFavorites });
  },
  isFavorite: (bandId) => get().favorites.includes(bandId),

  addNotification: (notification) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    set(state => ({
      notifications: [...state.notifications, { ...notification, id }]
    }));
  },
  removeNotification: (id) => set(state => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),

  setIsAdmin: (isAdmin) => set({ isAdmin })
}));
