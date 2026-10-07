import type { User, Maze, Attempt, Pagination } from '../types';

const BASE_URL = '/api';
const CACHE_PREFIX = 'maze_cache_';
const CACHE_EXPIRY = 5 * 60 * 1000;

interface ApiResponse<T> {
  data: T;
  message?: string;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = sessionStorage.getItem('token');

  const headers: HeadersInit = {
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

  const data = await response.json();
  return data as T;
}

function getCachedMazes(page: number): { mazes: Maze[]; pagination: Pagination } | null {
  try {
    const cacheKey = `${CACHE_PREFIX}mazes_${page}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data;
      }
      sessionStorage.removeItem(cacheKey);
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }
  return null;
}

function setCachedMazes(page: number, data: { mazes: Maze[]; pagination: Pagination }): void {
  try {
    const cacheKey = `${CACHE_PREFIX}mazes_${page}`;
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      })
    );
  } catch (e) {
    console.warn('Cache write error:', e);
  }
}

function getCachedMaze(id: string): Maze | null {
  try {
    const cacheKey = `${CACHE_PREFIX}maze_${id}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data;
      }
      sessionStorage.removeItem(cacheKey);
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }
  return null;
}

function setCachedMaze(id: string, data: Maze): void {
  try {
    const cacheKey = `${CACHE_PREFIX}maze_${id}`;
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      })
    );
  } catch (e) {
    console.warn('Cache write error:', e);
  }
}

export function clearMazeCache(): void {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch (e) {
    console.warn('Cache clear error:', e);
  }
}

export async function register(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const response = await request<ApiResponse<{ token: string; user: User }>>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return response.data;
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const response = await request<ApiResponse<{ token: string; user: User }>>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return response.data;
}

export async function getMazes(
  page: number = 1
): Promise<{ mazes: Maze[]; pagination: Pagination }> {
  const cached = getCachedMazes(page);
  if (cached) {
    return cached;
  }

  const response = await request<ApiResponse<{ mazes: Maze[]; pagination: Pagination }>>(
    `/mazes?page=${page}`
  );

  setCachedMazes(page, response.data);
  return response.data;
}

export async function getMaze(id: string): Promise<Maze> {
  const cached = getCachedMaze(id);
  if (cached) {
    return cached;
  }

  const response = await request<ApiResponse<Maze>>(`/mazes/${id}`);
  setCachedMaze(id, response.data);
  return response.data;
}

export async function createMaze(data: Partial<Maze>): Promise<Maze> {
  const response = await request<ApiResponse<Maze>>('/mazes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  clearMazeCache();
  return response.data;
}

export async function updateMaze(id: string, data: Partial<Maze>): Promise<Maze> {
  const response = await request<ApiResponse<Maze>>(`/mazes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  clearMazeCache();
  return response.data;
}

export async function deleteMaze(id: string): Promise<void> {
  await request(`/mazes/${id}`, {
    method: 'DELETE',
  });
  clearMazeCache();
}

export async function getAttempts(mazeId: string): Promise<Attempt[]> {
  const response = await request<ApiResponse<Attempt[]>>(`/mazes/${mazeId}/attempts`);
  return response.data;
}

export async function createAttempt(
  mazeId: string,
  data: { username: string; time_seconds: number }
): Promise<Attempt> {
  const response = await request<ApiResponse<Attempt>>(`/mazes/${mazeId}/attempts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.data;
}
