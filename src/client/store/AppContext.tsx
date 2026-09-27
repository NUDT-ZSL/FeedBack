import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User, AppContextType, ApiResponse, AuthResponse } from '../types';

const AppContext = createContext<AppContextType | undefined>(undefined);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const FAVORITES_KEY = 'auth_favorites';

interface AppProviderProps {
  children: ReactNode;
}

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

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch('/api/user/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data: ApiResponse<AuthResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error || '登录失败');
    }

    const { user: userData, token: authToken } = data.data;
    setUser(userData);
    setToken(authToken);
    setFollowing(userData.following || []);
    saveAuthToStorage(userData, authToken);
  }, [saveAuthToStorage]);

  const register = useCallback(async (username: string, password: string, email?: string) => {
    const response = await fetch('/api/user/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data: ApiResponse<AuthResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error || '注册失败');
    }

    const { user: userData, token: authToken } = data.data;
    setUser(userData);
    setToken(authToken);
    setFollowing(userData.following || []);
    saveAuthToStorage(userData, authToken);
  }, [saveAuthToStorage]);

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

  const toggleFavorite = useCallback(async (recipeId: string) => {
    if (!token || !user) {
      throw new Error('需要登录');
    }

    const isFavorited = favorites.includes(recipeId);

    setFavorites(prev =>
      isFavorited ? prev.filter(id => id !== recipeId) : [...prev, recipeId]
    );

    try {
      const response = await fetch(`/api/recipe/${recipeId}/favorite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data: ApiResponse<{ favorited: boolean }> = await response.json();

      if (!data.success) {
        setFavorites(prev =>
          isFavorited ? [...prev, recipeId] : prev.filter(id => id !== recipeId)
        );
        throw new Error(data.error || '操作失败');
      }
    } catch (error) {
      setFavorites(prev =>
        isFavorited ? [...prev, recipeId] : prev.filter(id => id !== recipeId)
      );
      throw error;
    }
  }, [token, user, favorites]);

  const toggleFollow = useCallback(async (userId: string) => {
    if (!token || !user) {
      throw new Error('需要登录');
    }

    const isFollowing = following.includes(userId);

    setFollowing(prev =>
      isFollowing ? prev.filter(id => id !== userId) : [...prev, userId]
    );

    try {
      const endpoint = isFollowing ? '/api/user/unfollow' : '/api/user/follow';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data: ApiResponse = await response.json();

      if (!data.success) {
        setFollowing(prev =>
          isFollowing ? [...prev, userId] : prev.filter(id => id !== userId)
        );
        throw new Error(data.error || '操作失败');
      }
    } catch (error) {
      setFollowing(prev =>
        isFollowing ? [...prev, userId] : prev.filter(id => id !== userId)
      );
      throw error;
    }
  }, [token, user, following]);

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
