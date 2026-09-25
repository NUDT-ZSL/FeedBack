import type {
  Event,
  EventWithStats,
  Registration,
  CreateEventRequest,
  RegisterRequest,
  RegisterResponse,
  VerifyRequest,
  VerifyResponse,
} from '../shared/types';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  getEvents: () => request<EventWithStats[]>('/events'),

  getEvent: (id: string) => request<EventWithStats>(`/events/${id}`),

  createEvent: (payload: CreateEventRequest) =>
    request<Event>('/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: RegisterRequest) =>
    request<RegisterResponse>('/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRegistration: (id: string) =>
    request<Registration>(`/registrations/${id}`),

  getRegistrationsByEvent: (eventId: string) =>
    request<Registration[]>(`/registrations/event/${eventId}`),

  verify: (payload: VerifyRequest) =>
    request<VerifyResponse>('/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
