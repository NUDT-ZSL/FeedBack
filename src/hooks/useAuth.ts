import { useState, useEffect } from 'react';
import { ADMIN_PASSWORD } from '../constants';

const STORAGE_KEY = 'admin_logged_in';

export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isLoggedIn));
  }, [isLoggedIn]);

  const login = (password: string): boolean => {
    if (password === ADMIN_PASSWORD) {
      setIsLoggedIn(true);
      return true;
    }
    return false;
  };

  const logout = (): void => {
    setIsLoggedIn(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    isLoggedIn,
    login,
    logout,
  };
}
