import { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '../utils/api';
import { Message } from '../types';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: Message) => void;
  pollInterval?: number;
  pollFallback?: () => Promise<Message[]>;
}

const MAX_RECONNECT_INTERVAL = 30000;
const BASE_RECONNECT_INTERVAL = 1000;
const DEFAULT_POLL_INTERVAL = 5000;

export function useWebSocket({
  url,
  onMessage,
  pollInterval = DEFAULT_POLL_INTERVAL,
  pollFallback,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manuallyClosedRef = useRef(false);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearPollInterval = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (!pollFallback || pollIntervalRef.current) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const messages = await pollFallback();
        messages.forEach((msg) => {
          if (!msg.isRead) {
            onMessage?.(msg);
          }
        });
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, pollInterval);
  }, [pollFallback, pollInterval, onMessage]);

  const connect = useCallback(() => {
    clearReconnectTimeout();
    clearPollInterval();
    manuallyClosedRef.current = false;

    const token = getToken();
    if (!token) {
      return;
    }

    try {
      const wsUrl = url.startsWith('ws')
        ? url
        : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3002${url}`;
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        clearPollInterval();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Message;
          onMessage?.(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;

        if (manuallyClosedRef.current) {
          return;
        }

        if (pollFallback) {
          startPolling();
        }

        const backoffInterval = Math.min(
          BASE_RECONNECT_INTERVAL * Math.pow(2, reconnectAttemptsRef.current),
          MAX_RECONNECT_INTERVAL
        );
        reconnectAttemptsRef.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffInterval);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setIsConnected(false);
      if (pollFallback) {
        startPolling();
      }
    }
  }, [url, clearReconnectTimeout, clearPollInterval, pollFallback, startPolling, onMessage]);

  const disconnect = useCallback(() => {
    manuallyClosedRef.current = true;
    clearReconnectTimeout();
    clearPollInterval();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearReconnectTimeout, clearPollInterval]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    send,
    connect,
    disconnect,
  };
}
