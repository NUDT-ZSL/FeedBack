import { io, type Socket } from 'socket.io-client';
import type { WSMessage, MessageHandler, BattleAction, RoomState, PlayerState } from '../types/index.js';

class NetworkHandler {
  private socket: Socket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private heartbeatInterval: number | null = null;
  private heartbeatTimeout: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private baseReconnectDelay = 1000;
  private isConnected = false;

  connect(): void {
    if (this.socket !== null && this.isConnected) {
      return;
    }

    this.socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: false,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('connect', undefined);
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnect', undefined);
      this.scheduleReconnect();
    });

    this.socket.on('connect_error', () => {
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.socket.on('pong', () => {
      this.clearHeartbeatTimeout();
    });

    const eventTypes = [
      'queue_joined', 'queue_left',
      'room_created', 'room_joined', 'room_deleted',
      'player_joined', 'player_left',
      'match_found', 'game_start',
      'turn_start', 'turn_ended',
      'card_played', 'invalid_play',
      'game_end', 'chat',
      'error'
    ];

    for (const eventType of eventTypes) {
      this.socket.on(eventType, (message: WSMessage) => {
        this.handleMessage(message);
      });
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket !== null) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = 0;
  }

  send(type: string, payload: unknown): void {
    if (this.socket === null || !this.isConnected) {
      throw new Error('Not connected to server');
    }
    this.socket.emit(type, payload);
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const handlers = this.handlers.get(type);
    if (handlers !== undefined) {
      handlers.add(handler);
    }
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers !== undefined) {
      handlers.delete(handler);
    }
  }

  private handleMessage(message: WSMessage): void {
    const handlers = this.handlers.get(message.type);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        try {
          handler(message.payload);
        } catch (error) {
          console.error(`Error handling message type ${message.type}:`, error);
        }
      }
    }
  }

  private emit(type: string, payload: unknown): void {
    const handlers = this.handlers.get(type);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error handling event type ${type}:`, error);
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      if (this.socket !== null && this.isConnected) {
        this.socket.emit('ping');
        this.setHeartbeatTimeout();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clearHeartbeatTimeout();
  }

  private setHeartbeatTimeout(): void {
    this.clearHeartbeatTimeout();
    this.heartbeatTimeout = window.setTimeout(() => {
      if (this.socket !== null) {
        this.socket.disconnect();
      }
    }, 60000);
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout !== null) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 10) {
      this.emit('maxReconnectAttempts', undefined);
      return;
    }
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.socket === null || !this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  joinQueue(nickname: string): void {
    this.send('join_queue', { nickname });
  }

  leaveQueue(): void {
    this.send('leave_queue', {});
  }

  createRoom(roomName: string, nickname: string): void {
    this.send('create_room', { roomName, nickname });
  }

  joinRoom(roomId: string, nickname: string): void {
    this.send('join_room', { roomId, nickname });
  }

  leaveRoom(roomId: string): void {
    this.send('leave_room', { roomId });
  }

  playCard(cardId: string, targetId: string): void {
    this.send('play_card', { cardId, targetId });
  }

  endTurn(): void {
    this.send('end_turn', {});
  }

  sendChat(message: string, roomId: string): void {
    this.send('chat', { message, roomId });
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get socketId(): string {
    return this.socket?.id || '';
  }
}

export const networkHandler = new NetworkHandler();
export type { BattleAction, RoomState, PlayerState };
