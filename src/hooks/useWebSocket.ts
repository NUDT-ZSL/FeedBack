import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store/useStore';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface WebSocketMessage {
  type: string;
  data: unknown;
}

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const reconnectTimeoutRef = useRef<number | null>(null);

  const {
    setUser,
    setRoom,
    addMessage,
    setMatches,
    showToast,
    showInvite,
    setChatPartner
  } = useStore();

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'USER_UPDATED':
          setUser(message.data as Parameters<typeof setUser>[0]);
          break;
        case 'ROOM_UPDATED':
          setRoom(message.data as Parameters<typeof setRoom>[0]);
          break;
        case 'NEW_MESSAGE':
          addMessage(message.data as Parameters<typeof addMessage>[0]);
          break;
        case 'MATCH_RESULTS':
          setMatches(message.data as Parameters<typeof setMatches>[0]);
          break;
        case 'TOAST': {
          const toastData = message.data as { message: string; type: 'success' | 'error' | 'info' };
          showToast(toastData.message, toastData.type);
          break;
        }
        case 'INVITE': {
          const inviteData = message.data as { inviter: Parameters<typeof showInvite>[0]; roomId: string };
          showInvite(inviteData.inviter, inviteData.roomId);
          break;
        }
        case 'CHAT_PARTNER':
          setChatPartner(message.data as Parameters<typeof setChatPartner>[0]);
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [setUser, setRoom, addMessage, setMatches, showToast, showInvite, setChatPartner]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || statusRef.current === 'connecting') {
      return;
    }

    statusRef.current = 'connecting';
    wsRef.current = new WebSocket('ws://localhost:3001');

    wsRef.current.onopen = () => {
      statusRef.current = 'connected';
      reconnectAttemptsRef.current = 0;
      console.log('WebSocket connected');
    };

    wsRef.current.onmessage = handleMessage;

    wsRef.current.onclose = (event) => {
      statusRef.current = 'disconnected';
      console.log('WebSocket disconnected:', event.code, event.reason);

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        statusRef.current = 'reconnecting';
        reconnectAttemptsRef.current++;
        console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [handleMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    statusRef.current = 'disconnected';
    reconnectAttemptsRef.current = 0;
  }, []);

  const sendMessage = useCallback((type: string, data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type, data });
      wsRef.current.send(message);
      return true;
    }

    console.warn('WebSocket is not connected. Message not sent:', { type, data });
    return false;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    sendMessage,
    connect,
    disconnect,
    getStatus: () => statusRef.current
  };
}
