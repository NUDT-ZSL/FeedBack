import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User, AppContextType } from '../types';
import * as authApi from '../api/auth';
import * as recipeApi from '../api/recipes';
import * as userApi from '../api/users';

const AppContext = createContext<AppContextType | undefined>(undefined);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const FAVORITES_KEY = 'auth_favorites';

interface AppProviderProps {
  children: ReactNode;
}

type IdListUpdater = React.Dispatch<React.SetStateAction<string[]>>;

const toggleId = (list: string[], id: string, active: boolean): string[] =>
  active ? list.filter((item) => item !== id) : [...list, id];

export function AppProvider({ children }: AppProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [following, setFollowing] = useState<string[]>([]);

  const isAuthenticated = !!user && !!token;

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    const savedFavorites = localStorage.getItem(FAVORITES_KEY);

    if (savedToken && savedUser) {
      try {
        const parsedUser: User = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        setFollowing(parsedUser.following || []);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(FAVORITES_KEY);
      }
    }

    if (savedFavorites) {
      try {
        setFavorites(JSON.parse(savedFavorites));
      } catch {
        localStorage.removeItem(FAVORITES_KEY);
      }
    }
  }, []);

  const saveAuthToStorage = useCallback((userData: User, authToken: string) => {
    localStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }, []);

  const clearAuthFromStorage = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const applyAuth = useCallback(
    (userData: User, authToken: string) => {
      setUser(userData);
      setToken(authToken);
      setFollowing(userData.following || []);
      saveAuthToStorage(userData, authToken);
    },
    [saveAuthToStorage],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const { user: userData, token: authToken } = await authApi.login(username, password);
      applyAuth(userData, authToken);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      const { user: userData, token: authToken } = await authApi.register(username, password, email);
      applyAuth(userData, authToken);
    },
    [applyAuth],
  );

  useEffect(() => {
    if (favorites.length > 0) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } else {
      localStorage.removeItem(FAVORITES_KEY);
    }
  }, [favorites]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setFavorites([]);
    setFollowing([]);
    clearAuthFromStorage();
  }, [clearAuthFromStorage]);

  /**
   * Shared optimistic-toggle flow used by favorites and follows:
   * apply the toggle locally, call the API, roll back on failure.
   */
  const runOptimisticToggle = useCallback(
    async (
      id: string,
      list: string[],
      setList: IdListUpdater,
      action: (authToken: string) => Promise<unknown>,
    ) => {
      if (!token || !user) {
        throw new Error('需要登录');
      }

      const isActive = list.includes(id);
      setList((prev) => toggleId(prev, id, isActive));

      try {
        await action(token);
      } catch (error) {
        setList((prev) => {
          const rolledBack = toggleId(prev, id, !isActive);
          // Keep the rollback idempotent so a failed toggle can never
          // duplicate the id in the list.
          return Array.from(new Set(rolledBack));
        });
        throw error;
      }
    },
    [token, user],
  );

  const toggleFavorite = useCallback(
    (recipeId: string) =>
      runOptimisticToggle(recipeId, favorites, setFavorites, (authToken) =>
        recipeApi.toggleFavorite(recipeId, authToken),
      ),
    [runOptimisticToggle, favorites],
  );

  const toggleFollow = useCallback(
    (userId: string) =>
      runOptimisticToggle(userId, following, setFollowing, (authToken) =>
        following.includes(userId)
          ? userApi.unfollowUser(userId, authToken)
          : userApi.followUser(userId, authToken),
      ),
    [runOptimisticToggle, following],
  );

  const toggleLike = useCallback((recipeId: string) => {
    console.log('toggleLike', recipeId);
  }, []);

  const value: AppContextType = {
    user,
    isAuthenticated,
    token,
    favorites,
    following,
    login,
    logout,
    register,
    toggleFavorite,
    toggleFollow,
    toggleLike,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAuth(): AppContextType {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AppProvider');
  }
  return context;
}
