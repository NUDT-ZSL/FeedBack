import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketMessage, Poll, Danmaku, RoomState } from '../types';

export function useWebSocket(roomId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [currentPoll, setCurrentPoll] = useState<Poll | null>(null);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [blockedWords, setBlockedWords] = useState<string[]>([]);
  const [danmakuStream, setDanmakuStream] = useState<Danmaku[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!roomId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?roomId=${roomId}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          switch (message.type) {
            case 'poll_created':
            case 'poll_updated':
              setCurrentPoll(message.data);
              break;
            case 'danmaku_received':
              setDanmakuStream(prev => {
                const filtered = prev.slice(-9);
                return [...filtered, message.data];
              });
              break;
            case 'danmaku_toggled':
              setDanmakuEnabled(message.data.enabled);
              break;
            case 'word_blocked':
              setBlockedWords(prev => [...new Set([...prev, message.data.word])]);
              break;
            case 'room_state':
              handleRoomState(message.data);
              break;
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (roomId) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };
    } catch (e) {
      console.error('Failed to create WebSocket connection:', e);
    }
  }, [roomId]);

  const handleRoomState = (state: RoomState) => {
    setCurrentPoll(state.currentPoll);
    setDanmakuEnabled(state.danmakuEnabled);
    setBlockedWords(state.blockedWords);
    setDanmakuStream(state.recentDanmaku.slice(-10));
  };

  useEffect(() => {
    if (roomId) {
      connect();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [roomId, connect]);

  return {
    currentPoll,
    danmakuEnabled,
    blockedWords,
    danmakuStream,
    isConnected
  };
}
