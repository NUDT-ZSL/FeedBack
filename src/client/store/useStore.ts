import { create } from 'zustand';
import type { User, Play, Interview, NotificationItem } from '../types';
import {
  setToken,
  getToken,
  wsManager,
  authApi,
  playApi,
  interviewApi,
  notificationApi,
} from '../api';
import type { WSMessage } from '../types';

interface AppState {
  user: User | null;
  isLoading: boolean;
  plays: Play[];
  playsTotal: number;
  playsPage: number;
  hasMorePlays: boolean;
  interviews: Interview[];
  notifications: NotificationItem[];
  unreadCount: number;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;

  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; role: 'actor' | 'director' }) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  loadPlays: (page?: number, search?: string, append?: boolean) => Promise<void>;
  loadInterviews: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearToast: () => void;
  updatePlay: (play: Play) => void;
  updateOrAddInterview: (interview: Interview) => void;
  removeInterview: (id: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  user: null,
  isLoading: false,
  plays: [],
  playsTotal: 0,
  playsPage: 1,
  hasMorePlays: true,
  interviews: [],
  notifications: [],
  unreadCount: 0,
  toast: null,

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 3000);
  },
  clearToast: () => set({ toast: null }),

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await authApi.login({ email, password });
      setToken(res.token);
      set({ user: res.user });
      wsManager.connect();
      get().showToast('登录成功', 'success');
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (data) => {
    set({ isLoading: true });
    try {
      const res = await authApi.register(data);
      setToken(res.token);
      set({ user: res.user });
      wsManager.connect();
      get().showToast('注册成功', 'success');
    } finally {
      set({ isLoading: false });
    }
  },

  logout: () => {
    setToken(null);
    wsManager.disconnect();
    set({ user: null, notifications: [], unreadCount: 0 });
  },

  fetchMe: async () => {
    if (!getToken()) return;
    try {
      const res = await authApi.me();
      set({ user: res.user });
      wsManager.connect();
    } catch (_err) {
      setToken(null);
    }
  },

  loadPlays: async (page = 1, search = '', append = false) => {
    const res = await playApi.list({ page, pageSize: 12, search });
    set((s) => ({
      plays: append ? [...s.plays, ...res.items] : res.items,
      playsTotal: res.total,
      playsPage: res.page,
      hasMorePlays: res.page * res.pageSize < res.total,
    }));
  },

  loadInterviews: async () => {
    const list = await interviewApi.list();
    set({ interviews: list });
  },

  loadNotifications: async () => {
    const res = await notificationApi.list();
    set({ notifications: res.list, unreadCount: res.unread });
  },

  markNotificationsRead: async () => {
    await notificationApi.markRead();
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  updatePlay: (play) => {
    set((s) => {
      const idx = s.plays.findIndex((p) => p.id === play.id);
      if (idx >= 0) {
        const plays = [...s.plays];
        plays[idx] = play;
        return { plays };
      }
      return { plays: [play, ...s.plays] };
    });
  },

  updateOrAddInterview: (interview) => {
    set((s) => {
      const idx = s.interviews.findIndex((i) => i.id === interview.id);
      if (idx >= 0) {
        const interviews = [...s.interviews];
        interviews[idx] = interview;
        return { interviews };
      }
      return { interviews: [...s.interviews, interview] };
    });
  },

  removeInterview: (id) => {
    set((s) => ({ interviews: s.interviews.filter((i) => i.id !== id) }));
  },
}));

export function initWSListeners() {
  wsManager.addListener((msg: WSMessage) => {
    const { showToast, updatePlay, loadNotifications, updateOrAddInterview, removeInterview } =
      useStore.getState();

    switch (msg.type) {
      case 'notification': {
        const notif = msg.payload as NotificationItem;
        loadNotifications();
        if (Notification && Notification.permission === 'granted') {
          new Notification(notif.title, { body: notif.content });
        }
        break;
      }
      case 'play_update': {
        const payload = msg.payload as { play?: Play; playId?: string; action: string };
        if (payload.action === 'delete' && payload.playId) {
          useStore.setState((s) => ({
            plays: s.plays.filter((p) => p.id !== payload.playId),
          }));
        } else if (payload.play) {
          updatePlay(payload.play);
        }
        break;
      }
      case 'interview_update': {
        const payload = msg.payload as {
          interview?: Interview;
          interviewId?: string;
          action: string;
        };
        if (payload.action === 'delete' && payload.interviewId) {
          removeInterview(payload.interviewId);
          showToast('面试安排已删除', 'info');
        } else if (payload.interview) {
          updateOrAddInterview(payload.interview);
          if (payload.action === 'create') showToast('有新的面试安排', 'info');
          else showToast('面试安排已更新', 'info');
        }
        break;
      }
      case 'application_status': {
        loadNotifications();
        break;
      }
      case 'application_update': {
        loadNotifications();
        break;
      }
    }
  });
}
