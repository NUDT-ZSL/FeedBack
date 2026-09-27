import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { User, AppContextType } from '../types';
import { authApi, recipeApi, userApi } from '../api/endpoints';
import { useOptimisticList } from '../hooks/useOptimisticList';
import {
  clearAuth,
  loadAuth,
  loadFavorites,
  saveAuth,
  saveFavorites,
} from './authStorage';

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const {
    items: favoriteItems,
    setItems: setFavoriteItems,
    toggle: toggleFavoriteItem,
  } = useOptimisticList();
  const {
    items: followingItems,
    setItems: setFollowingItems,
    toggle: toggleFollowingItem,
  } = useOptimisticList();

  const isAuthenticated = !!user && !!token;

  // Session hydration is the only place localStorage auth data is read.
  useEffect(() => {
    const persisted = loadAuth();
    if (persisted) {
      setToken(persisted.token);
      setUser(persisted.user);
      setFollowingItems(persisted.user.following || []);
    }
    setFavoriteItems(loadFavorites());
  }, [setFavoriteItems, setFollowingItems]);

  useEffect(() => {
    saveFavorites(favoriteItems);
  }, [favoriteItems]);

  const applyAuth = useCallback(
    (userData: User, authToken: string) => {
      setUser(userData);
      setToken(authToken);
      setFollowingItems(userData.following || []);
      saveAuth(userData, authToken);
    },
    [setFollowingItems],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const { user: userData, token: authToken } = await authApi.login(
        username,
        password,
      );
      applyAuth(userData, authToken);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      const { user: userData, token: authToken } = await authApi.register(
        username,
        password,
        email,
      );
      applyAuth(userData, authToken);
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setFavoriteItems([]);
    setFollowingItems([]);
    clearAuth();
  }, [setFavoriteItems, setFollowingItems]);

  const requireToken = useCallback(() => {
    if (!token || !user) {
      throw new Error('需要登录');
    }
    return token;
  }, [token, user]);

  const toggleFavorite = useCallback(
    async (recipeId: string) => {
      const authToken = requireToken();
      await toggleFavoriteItem(recipeId, () =>
        recipeApi.toggleFavorite(authToken, recipeId),
      );
    },
    [requireToken, toggleFavoriteItem],
  );

  const toggleFollow = useCallback(
    async (userId: string) => {
      const authToken = requireToken();
      await toggleFollowingItem(userId, (isFollowing) =>
        isFollowing
          ? userApi.unfollow(authToken, userId)
          : userApi.follow(authToken, userId),
      );
    },
    [requireToken, toggleFollowingItem],
  );

  const value: AppContextType = {
    user,
    isAuthenticated,
    token,
    favorites: favoriteItems,
    following: followingItems,
    login,
    logout,
    register,
    toggleFavorite,
    toggleFollow,
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
