import type { User, Tea, TeaWithNotes, TastingNote, TeaFilters } from '@/types';

const BASE_URL = '/api';

const getHeaders = (): HeadersInit => {
  const userId = localStorage.getItem('tea_user_id');
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'x-user-id': userId } : {}),
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || '请求失败');
  }
  return response.json();
};

export const authApi = {
  register: async (username: string, password: string): Promise<{ success: boolean; user: User }> => {
    const response = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(response);
  },

  login: async (username: string, password: string): Promise<{ success: boolean; user: User }> => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(response);
  },

  logout: async (): Promise<{ success: boolean }> => {
    const response = await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(response);
  },
};

export const teaApi = {
  getTeas: async (page = 1, limit = 10, filters: Partial<TeaFilters> = {}): Promise<{ success: boolean; teas: Tea[]; total: number }> => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...Object.fromEntries(
        Object.entries(filters)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ),
    });
    
    const response = await fetch(`${BASE_URL}/teas?${params}`, {
      headers: getHeaders(),
    });
    return handleResponse(response);
  },

  getTea: async (id: string): Promise<{ success: boolean; tea: TeaWithNotes }> => {
    const response = await fetch(`${BASE_URL}/teas/${id}`, {
      headers: getHeaders(),
    });
    return handleResponse(response);
  },

  createTea: async (formData: FormData): Promise<{ success: boolean; tea: Tea }> => {
    const userId = localStorage.getItem('tea_user_id');
    const response = await fetch(`${BASE_URL}/teas`, {
      method: 'POST',
      headers: userId ? { 'x-user-id': userId } : {},
      body: formData,
    });
    return handleResponse(response);
  },

  updateTea: async (id: string, formData: FormData): Promise<{ success: boolean; tea: Tea }> => {
    const userId = localStorage.getItem('tea_user_id');
    const response = await fetch(`${BASE_URL}/teas/${id}`, {
      method: 'PUT',
      headers: userId ? { 'x-user-id': userId } : {},
      body: formData,
    });
    return handleResponse(response);
  },

  deleteTea: async (id: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${BASE_URL}/teas/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(response);
  },

  exportTeas: async (): Promise<void> => {
    const response = await fetch(`${BASE_URL}/export`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error('导出失败');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const contentDisposition = response.headers.get('Content-Disposition');
    const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || '我的茶品收藏.json';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};

export const tastingNoteApi = {
  createNote: async (teaId: string, note: Omit<TastingNote, 'id' | 'tea_id' | 'created_at'>): Promise<{ success: boolean; note: TastingNote }> => {
    const response = await fetch(`${BASE_URL}/teas/${teaId}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(note),
    });
    return handleResponse(response);
  },

  updateNote: async (id: string, note: Omit<TastingNote, 'id' | 'tea_id' | 'created_at'>): Promise<{ success: boolean; note: TastingNote }> => {
    const response = await fetch(`${BASE_URL}/notes/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(note),
    });
    return handleResponse(response);
  },

  deleteNote: async (id: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${BASE_URL}/notes/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(response);
  },
};
