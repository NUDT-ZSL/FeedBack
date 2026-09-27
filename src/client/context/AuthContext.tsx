import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { login as apiLogin, register as apiRegister, getToken, setToken, removeToken } from '../utils/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(getToken());

  useEffect(() => {
    const storedToken = getToken();
    if (storedToken) {
      setTokenState(storedToken);
      try {
        const payload = JSON.parse(atob(storedToken.split('.')[1]));
        if (payload.exp && payload.exp * 1000 > Date.now()) {
          setUser({
            id: payload.userId,
            username: payload.username,
            email: payload.email,
            avatar: payload.avatar,
            createdAt: payload.createdAt,
          });
        } else {
          removeToken();
          setTokenState(null);
        }
      } catch {
        removeToken();
        setTokenState(null);
      }
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiLogin({ email, password });
    setUser(response.user);
    setTokenState(response.token);
    setToken(response.token);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const response = await apiRegister({ username, email, password });
    setUser(response.user);
    setTokenState(response.token);
    setToken(response.token);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setTokenState(null);
    removeToken();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
