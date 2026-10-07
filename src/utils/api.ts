import type { Spice, Perfume } from '../types';

const API_BASE = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const result = (await response.json()) as ApiResponse<T>;

  if (!result.success || !response.ok) {
    throw new Error(result.error || '请求失败');
  }

  return result.data as T;
}

export const api = {
  getSpices: () => request<Spice[]>('/spices'),

  getPerfumes: () => request<Perfume[]>('/perfumes'),

  createPerfume: (perfume: Omit<Perfume, 'id' | 'createdAt'>) =>
    request<Perfume>('/perfumes', {
      method: 'POST',
      body: JSON.stringify(perfume),
    }),

  deletePerfume: (id: string) =>
    request<{ success: boolean }>(`/perfumes/${id}`, {
      method: 'DELETE',
    }),
};
