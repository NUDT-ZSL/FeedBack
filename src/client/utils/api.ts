import { User, Book, Exchange, Message } from '../types';

export const BASE_URL = '/api';

const TOKEN_KEY = 'auth_token';

export const getToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const removeToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

export const request = async <T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

interface AuthResponse {
  user: User;
  token: string;
}

export const register = (data: { username: string; email: string; password: string }) =>
  request<AuthResponse>('/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const login = (data: { email: string; password: string }) =>
  request<AuthResponse>('/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getBooks = (params?: { search?: string; category?: string }) => {
  const queryString = params
    ? '?' + new URLSearchParams(params as Record<string, string>).toString()
    : '';
  return request<Book[]>(`/books${queryString}`);
};

export const createBook = (data: Omit<Book, 'id' | 'ownerId' | 'createdAt' | 'owner'>) =>
  request<Book>('/books', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateBook = (id: string, data: Partial<Book>) =>
  request<Book>(`/books/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteBook = (id: string) =>
  request<void>(`/books/${id}`, {
    method: 'DELETE',
  });

export const getUserBooks = (userId: string) =>
  request<Book[]>(`/users/${userId}/books`);

export const getExchanges = () =>
  request<Exchange[]>('/exchanges');

export const createExchange = (data: { bookId: string; message?: string }) =>
  request<Exchange>('/exchanges', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateExchange = (
  id: string,
  data: { status: Exchange['status']; message?: string }
) =>
  request<Exchange>(`/exchanges/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getMessages = () =>
  request<Message[]>('/messages');

export const markAllMessagesRead = () =>
  request<void>('/messages/read-all', {
    method: 'PUT',
  });

export const markMessageRead = (id: string) =>
  request<void>(`/messages/${id}/read`, {
    method: 'PUT',
  });
