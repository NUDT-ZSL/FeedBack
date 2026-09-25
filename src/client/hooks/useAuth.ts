import { useState, useEffect } from 'react';

// JWT Token的类型定义
interface User {
  id: string;
  email: string;
  name: string;
  level: 'normal' | 'vip';
  bookingCount: number;
}

// 认证Hook - 全局状态管理
// 数据流向：所有组件通过此Hook获取用户token和身份信息
// 调用关系：App.tsx -> useAuth -> localStorage -> 后端API
export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 初始化时从localStorage读取token
  useEffect(() => {
    const savedToken = localStorage.getItem('gym_token');
    const savedUser = localStorage.getItem('gym_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  // 登录：存储token和用户信息
  const login = (newToken: string, userData: User) => {
    localStorage.setItem('gym_token', newToken);
    localStorage.setItem('gym_user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
  };

  // 退出登录：清除存储
  const logout = () => {
    localStorage.removeItem('gym_token');
    localStorage.removeItem('gym_user');
    setToken(null);
    setUser(null);
  };

  // 更新用户信息（用于VIP升级后同步）
  const updateUser = (userData: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...userData };
      localStorage.setItem('gym_user', JSON.stringify(updated));
      setUser(updated);
    }
  };

  return { token, user, loading, login, logout, updateUser };
}

export type { User };
