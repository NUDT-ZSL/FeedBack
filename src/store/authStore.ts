import { create } from 'zustand';
import type { User } from '@/types';
import { authApi } from '@/api/client';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User | null) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.login(username, password);
      if (result.success) {
        localStorage.setItem('tea_user_id', result.user.id);
        localStorage.setItem('tea_username', result.user.username);
        set({ user: result.user, isLoading: false });
        return true;
      }
      return false;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  register: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.register(username, password);
      if (result.success) {
        localStorage.setItem('tea_user_id', result.user.id);
        localStorage.setItem('tea_username', result.user.username);
        set({ user: result.user, isLoading: false });
        return true;
      }
      return false;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem('tea_user_id');
    localStorage.removeItem('tea_username');
    set({ user: null });
  },

  setUser: (user: User | null) => set({ user }),

  clearError: () => set({ error: null }),
}));
