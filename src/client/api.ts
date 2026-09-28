import type { Book, Annotation, ShareLink } from './types';

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export const api = {
  async getBooks(): Promise<Book[]> {
    return request<Book[]>('/books');
  },

  async getBook(id: string): Promise<Book> {
    return request<Book>(`/books/${id}`);
  },

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    return request<Annotation[]>(`/annotations?bookId=${bookId}`);
  },

  async createAnnotation(annotation: Omit<Annotation, 'id' | 'createdAt'>): Promise<Annotation> {
    return request<Annotation>('/annotations', {
      method: 'POST',
      body: JSON.stringify(annotation),
    });
  },

  async createShare(bookId: string, targetEmail: string): Promise<ShareLink> {
    return request<ShareLink>('/shares', {
      method: 'POST',
      body: JSON.stringify({ bookId, targetEmail }),
    });
  },

  async getShare(id: string): Promise<ShareLink | null> {
    return request<ShareLink | null>(`/shares/${id}`);
  },
};
