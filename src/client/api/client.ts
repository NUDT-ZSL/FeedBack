import type { ApiResponse } from '../types';

/**
 * Error thrown for API-level failures (`success: false` payloads).
 * Network failures surface as the original fetch error instead, so
 * callers can distinguish the two and keep their existing messages.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Message used when the API reports failure without an error text. */
  errorFallback: string;
}

/**
 * Single place that knows how to talk to the backend: JSON headers,
 * bearer token injection and ApiResponse unwrapping.
 */
export async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, token, errorFallback } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data: ApiResponse<T> = await response.json();

  if (!data.success) {
    throw new ApiError(data.error || errorFallback, response.status);
  }

  return data.data as T;
}
