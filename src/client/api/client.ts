import type { ApiResponse } from '../types';

/**
 * Error thrown when the server answered with `success: false`. Network-level
 * failures reject with the original fetch error instead, so callers can tell
 * "server said no" apart from "request never completed".
 */
export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string | null;
  body?: unknown;
}

/**
 * Single transport layer for the JSON API: applies the shared headers,
 * unwraps the ApiResponse envelope and surfaces the server error message.
 */
export async function apiRequest<T>(
  path: string,
  fallbackError: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = 'GET', token, body } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data: ApiResponse<T> = await response.json();

  if (!data.success) {
    throw new ApiRequestError(data.error || fallbackError);
  }

  return data.data as T;
}
