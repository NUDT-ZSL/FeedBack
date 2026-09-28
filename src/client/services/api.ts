import { Band, Schedule, ConflictInfo } from '../types';

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw data;
  }

  return data as T;
}

export const bandsApi = {
  getBands: (status?: string): Promise<Band[]> => {
    const query = status ? `?status=${status}` : '';
    return request<Band[]>(`/bands${query}`);
  },

  getBand: (id: string): Promise<Band> => {
    return request<Band>(`/bands/${id}`);
  },

  createBand: (data: {
    name: string;
    description: string;
    genres: string[];
    memberCount: number;
    contact: string;
    requestId?: string;
  }): Promise<{ id: string; status: string; message: string }> => {
    return request('/bands', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  reviewBand: (id: string, status: 'approved' | 'rejected'): Promise<{ id: string; status: string; message: string }> => {
    return request(`/bands/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  }
};

export const scheduleApi = {
  getSchedules: (stage?: string): Promise<Schedule[]> => {
    const query = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    return request<Schedule[]>(`/schedule${query}`);
  },

  getSchedule: (id: string): Promise<Schedule> => {
    return request<Schedule>(`/schedule/${id}`);
  },

  createSchedule: (data: {
    bandId: string;
    stage: string;
    startTime: string;
    endTime: string;
  }): Promise<Schedule> => {
    return request('/schedule', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  updateSchedule: (id: string, data: Partial<{
    stage: string;
    startTime: string;
    endTime: string;
  }>): Promise<Schedule> => {
    return request(`/schedule/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  deleteSchedule: (id: string): Promise<{ message: string }> => {
    return request(`/schedule/${id}`, {
      method: 'DELETE'
    });
  }
};
