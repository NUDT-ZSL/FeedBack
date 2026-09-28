import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export default function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO 已连接');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO 已断开');
      setConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { socket: socketRef.current, connected };
}
