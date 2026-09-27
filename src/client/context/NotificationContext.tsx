import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Message } from '../types';
import { getMessages, markAllMessagesRead as apiMarkAllRead, markMessageRead as apiMarkRead } from '../utils/api';
import { useAuth } from './AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';

interface NotificationContextType {
  unreadCount: number;
  messages: Message[];
  isConnected: boolean;
  refreshMessages: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const { isAuthenticated } = useAuth();

  const handleMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      const exists = prev.some((m) => m.id === message.id);
      if (exists) {
        return prev.map((m) => (m.id === message.id ? message : m));
      }
      return [message, ...prev];
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await getMessages();
      setMessages(data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  }, []);

  const { isConnected } = useWebSocket({
    url: '/ws/messages',
    onMessage: handleMessage,
    pollFallback: isAuthenticated ? getMessages : undefined,
  });

  useEffect(() => {
    if (isAuthenticated) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [isAuthenticated, fetchMessages]);

  const unreadCount = messages.filter((m) => !m.isRead).length;

  const refreshMessages = useCallback(async () => {
    await fetchMessages();
  }, [fetchMessages]);

  const markAllRead = useCallback(async () => {
    await apiMarkAllRead();
    setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
  }, []);

  const markRead = useCallback(async (id: string) => {
    await apiMarkRead(id);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        messages,
        isConnected,
        refreshMessages,
        markAllRead,
        markRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
