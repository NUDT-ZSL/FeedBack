import { useEffect, useRef, useCallback } from 'react';
import type { WSMessage } from '../types';

const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const HEARTBEAT_INTERVAL = 30000;
const RECONNECT_DELAY = 3000;
const THROTTLE_INTERVAL = 100;

type SubscriberCallback = (message: WSMessage) => void;

interface UseWebSocketReturn {
  send: (message: WSMessage) => void;
  subscribe: (callback: SubscriberCallback) => void;
  unsubscribe: () => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const flushTimeoutRef = useRef<number | null>(null);
  const subscribersRef = useRef<Set<SubscriberCallback>>(new Set());
  const messageQueueRef = useRef<WSMessage[]>([]);
  const shouldReconnectRef = useRef(true);

  const flushQueue = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      flushTimeoutRef.current = null;
      return;
    }

    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift();
      if (msg) {
        try {
          wsRef.current.send(JSON.stringify(msg));
        } catch {
        }
      }
    }

    flushTimeoutRef.current = null;
  }, []);

  const enqueueMessage = useCallback((message: WSMessage) => {
    messageQueueRef.current.push(message);
    if (flushTimeoutRef.current === null) {
      flushTimeoutRef.current = window.setTimeout(flushQueue, THROTTLE_INTERVAL);
    }
  }, [flushQueue]);

  const distributeMessage = useCallback((message: WSMessage) => {
    subscribersRef.current.forEach((callback) => {
      try {
        callback(message);
      } catch {
      }
    });
  }, []);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        heartbeatIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            enqueueMessage({ type: 'heartbeat' });
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WSMessage;
          if (
            message.type === 'plants_update' ||
            message.type === 'notification' ||
            message.type === 'leaderboard'
          ) {
            distributeMessage(message);
          }
        } catch {
        }
      };

      ws.onerror = () => {
      };

      ws.onclose = () => {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        if (flushTimeoutRef.current) {
          clearTimeout(flushTimeoutRef.current);
          flushTimeoutRef.current = null;
        }
        if (shouldReconnectRef.current) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, RECONNECT_DELAY);
        }
      };
    } catch {
    }
  }, [enqueueMessage, distributeMessage]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      messageQueueRef.current = [];
      subscribersRef.current.clear();
    };
  }, [connect]);

  const send = useCallback((message: WSMessage) => {
    enqueueMessage(message);
  }, [enqueueMessage]);

  const subscribe = useCallback((callback: SubscriberCallback) => {
    subscribersRef.current.add(callback);
  }, []);

  const unsubscribe = useCallback(() => {
    subscribersRef.current.clear();
  }, []);

  return {
    send,
    subscribe,
    unsubscribe,
  };
}
