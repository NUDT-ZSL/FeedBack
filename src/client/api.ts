import type {
  User,
  Play,
  PlayListResponse,
  Role,
  Application,
  Interview,
  NotificationItem,
  NotificationResponse,
  WSMessage,
} from './types';

const API_BASE = '/api';
const WS_BASE = location.hostname === 'localhost'
  ? `ws://${location.hostname}:3001/ws`
  : `ws://${location.host}/ws`;

let authToken: string | null = localStorage.getItem('token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

export function getToken(): string | null {
  return authToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const authApi = {
  register: (data: { email: string; password: string; name: string; role: 'actor' | 'director' }) =>
    request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => request<{ user: User }>('/auth/me'),
};

export const playApi = {
  list: (params: { page?: number; pageSize?: number; search?: string } = {}) => {
    const q = new URLSearchParams(params as Record<string, string>);
    return request<PlayListResponse>(`/plays?${q.toString()}`);
  },
  get: (id: string) => request<Play>(`/plays/${id}`),
  myPlays: () => request<Play[]>('/my/plays'),
  create: (data: Partial<Play>) =>
    request<Play>('/plays', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Play>) =>
    request<Play>(`/plays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/plays/${id}`, { method: 'DELETE' }),
};

export const roleApi = {
  create: (playId: string, data: Partial<Role>) =>
    request<Role>(`/plays/${playId}/roles`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (playId: string, roleId: string, data: Partial<Role>) =>
    request<Role>(`/plays/${playId}/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (playId: string, roleId: string) =>
    request<{ success: boolean }>(`/plays/${playId}/roles/${roleId}`, {
      method: 'DELETE',
    }),
  reorder: (playId: string, roleIds: string[]) =>
    request<{ success: boolean }>(`/plays/${playId}/roles/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds }),
    }),
  applications: (roleId: string) =>
    request<Application[]>(`/roles/${roleId}/applications`),
};

export const applicationApi = {
  apply: (roleId: string, data: { introduction: string; experience?: string }) =>
    request<Application>(`/roles/${roleId}/apply`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  myApplications: () => request<Application[]>('/my/applications'),
  updateStatus: (id: string, status: 'approved' | 'rejected' | 'pending') =>
    request<Application>(`/applications/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
};

export const interviewApi = {
  list: () => request<Interview[]>('/interviews'),
  create: (data: Partial<Interview>) =>
    request<Interview>('/interviews', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Interview>) =>
    request<Interview>(`/interviews/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/interviews/${id}`, { method: 'DELETE' }),
};

export const notificationApi = {
  list: () => request<NotificationResponse>('/notifications'),
  markRead: () =>
    request<{ success: boolean }>('/notifications/read', { method: 'PUT' }),
};

type WSListener = (msg: WSMessage) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners = new Set<WSListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (!authToken) return;
    try {
      this.ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(authToken)}`);
      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.startHeartbeat();
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WSMessage;
          this.listeners.forEach((l) => l(msg));
        } catch (_err) {
          /* ignore */
        }
      };
      this.ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s');
        this.stopHeartbeat();
        this.scheduleReconnect();
      };
      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (err) {
      console.error('[WS] Connect failed:', err);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  addListener(l: WSListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}

export const wsManager = new WebSocketManager();

export default {
  auth: authApi,
  play: playApi,
  role: roleApi,
  application: applicationApi,
  interview: interviewApi,
  notification: notificationApi,
  wsManager,
  setToken,
  getToken,
};
