import type { User } from '../types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const FAVORITES_KEY = 'auth_favorites';

export interface PersistedAuth {
  token: string;
  user: User;
}

/** Reads the persisted session; clears corrupt entries and returns null. */
export function loadAuth(): PersistedAuth | null {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  const savedUser = localStorage.getItem(USER_KEY);

  if (!savedToken || !savedUser) {
    return null;
  }

  try {
    return { token: savedToken, user: JSON.parse(savedUser) as User };
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(FAVORITES_KEY);
    return null;
  }
}

export function saveAuth(user: User, token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function loadFavorites(): string[] {
  const savedFavorites = localStorage.getItem(FAVORITES_KEY);
  if (!savedFavorites) {
    return [];
  }

  try {
    return JSON.parse(savedFavorites) as string[];
  } catch {
    localStorage.removeItem(FAVORITES_KEY);
    return [];
  }
}

export function saveFavorites(favorites: string[]): void {
  if (favorites.length > 0) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } else {
    localStorage.removeItem(FAVORITES_KEY);
  }
}
