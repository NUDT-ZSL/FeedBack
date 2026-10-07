import type { User } from '../types';
import * as api from './api';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function getCurrentUser(): User | null {
  try {
    const userStr = sessionStorage.getItem(USER_KEY);
    if (userStr) {
      return JSON.parse(userStr) as User;
    }
  } catch (e) {
    console.warn('Failed to parse user from sessionStorage:', e);
  }
  return null;
}

function setCurrentUser(user: User): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function removeCurrentUser(): void {
  sessionStorage.removeItem(USER_KEY);
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const result = await api.login(username, password);
  setToken(result.token);
  setCurrentUser(result.user);
  return result;
}

export async function register(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const result = await api.register(username, password);
  setToken(result.token);
  setCurrentUser(result.user);
  return result;
}

export function logout(): void {
  removeToken();
  removeCurrentUser();
  api.clearMazeCache();
}
