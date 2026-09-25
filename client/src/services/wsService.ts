export type MessageType =
  | 'join'
  | 'leave'
  | 'message'
  | 'ping'
  | 'pong'
  | 'doc_update'
  | 'cursor'
  | 'presence'
  | 'error';

export interface WSMessage<T = unknown> {
  type: MessageType;
  data?: T;
  roomId?: string;
  userId?: string;
  timestamp: number;
  messageId: string;
}

export interface WSConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
}

type MessageHandler = (message: WSMessage) => void;
type RoomMessageHandler = (message: WSMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private config: WSConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private generalHandlers: Set<MessageHandler> = new Set();
  private roomHandlers: Map<string, Set<RoomMessageHandler>> = new Map();
  private joinedRooms: Set<string> = new Set();
  private userId: string | null = null;
  private isManualClose = false;
  private pendingMessages: WSMessage[] = [];

  constructor(config: WSConfig) {
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      heartbeatTimeout: 10000,
      ...config,
    };
  }

  connect(userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.userId = userId;
      this.isManualClose = false;

      try {
        const url = this.config.url.includes('?')
          ? `${this.config.url}&userId=${encodeURIComponent(userId)}`
          : `${this.config.url}?userId=${encodeURIComponent(userId)}`;

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushPendingMessages();
          for (const roomId of this.joinedRooms) {
            this.sendJoin(roomId);
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          reject(error);
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          if (!this.isManualClose) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.isManualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Manual disconnect');
      }
      this.ws = null;
    }
    this.joinedRooms.clear();
    this.generalHandlers.clear();
    this.roomHandlers.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  joinRoom(roomId: string, handler?: RoomMessageHandler): void {
    if (this.joinedRooms.has(roomId)) {
      if (handler) {
        if (!this.roomHandlers.has(roomId)) {
          this.roomHandlers.set(roomId, new Set());
        }
        this.roomHandlers.get(roomId)!.add(handler);
      }
      return;
    }

    this.joinedRooms.add(roomId);
    if (handler) {
      if (!this.roomHandlers.has(roomId)) {
        this.roomHandlers.set(roomId, new Set());
      }
      this.roomHandlers.get(roomId)!.add(handler);
    }

    this.sendJoin(roomId);
  }

  leaveRoom(roomId: string, handler?: RoomMessageHandler): void {
    if (handler && this.roomHandlers.has(roomId)) {
      this.roomHandlers.get(roomId)!.delete(handler);
    }

    if (!handler || (this.roomHandlers.get(roomId)?.size ?? 0) === 0) {
      this.joinedRooms.delete(roomId);
      this.roomHandlers.delete(roomId);
      this.sendMessage({
        type: 'leave',
        roomId,
        userId: this.userId ?? undefined,
      });
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.generalHandlers.add(handler);
    return () => {
      this.generalHandlers.delete(handler);
    };
  }

  sendToRoom<T = unknown>(roomId: string, data: T, type: MessageType = 'message'): void {
    this.sendMessage({
      type,
      data,
      roomId,
      userId: this.userId ?? undefined,
    });
  }

  private sendJoin(roomId: string): void {
    this.sendMessage({
      type: 'join',
      roomId,
      userId: this.userId ?? undefined,
    });
  }

  private sendMessage(message: Omit<WSMessage, 'timestamp' | 'messageId'>): void {
    const fullMessage: WSMessage = {
      ...message,
      timestamp: Date.now(),
      messageId: this.generateMessageId(),
    };

    const serialized = this.serialize(fullMessage);

    if (this.isConnected()) {
      this.ws!.send(serialized);
    } else {
      this.pendingMessages.push(fullMessage);
    }
  }

  private handleMessage(rawData: string): void {
    try {
      const message = this.deserialize(rawData);

      if (message.type === 'ping') {
        this.sendMessage({ type: 'pong' });
        return;
      }

      if (message.type === 'pong') {
        this.clearHeartbeatTimeout();
        return;
      }

      for (const handler of this.generalHandlers) {
        try {
          handler(message);
        } catch {
          // 静默处理单个处理器错误
        }
      }

      if (message.roomId && this.roomHandlers.has(message.roomId)) {
        const handlers = this.roomHandlers.get(message.roomId)!;
        for (const handler of handlers) {
          try {
            handler(message);
          } catch {
            // 静默处理单个处理器错误
          }
        }
      }
    } catch {
      // 反序列化失败，静默处理
    }
  }

  private serialize(message: WSMessage): string {
    return JSON.stringify(message);
  }

  private deserialize(data: string): WSMessage {
    const parsed = JSON.parse(data);
    if (
      typeof parsed.type !== 'string' ||
      typeof parsed.timestamp !== 'number' ||
      typeof parsed.messageId !== 'string'
    ) {
      throw new Error('Invalid WS message format');
    }
    return parsed as WSMessage;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendMessage({ type: 'ping' });
        this.heartbeatTimeoutTimer = setTimeout(() => {
          if (this.ws) {
            this.ws.close(4000, 'Heartbeat timeout');
          }
        }, this.config.heartbeatTimeout);
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? 10)) {
      return;
    }

    this.reconnectAttempts++;
    const delay = (this.config.reconnectInterval ?? 5000) * Math.min(this.reconnectAttempts, 5);

    this.reconnectTimer = setTimeout(() => {
      if (this.userId && !this.isManualClose) {
        this.connect(this.userId).catch(() => {
          // 重连失败将再次触发 scheduleReconnect
        });
      }
    }, delay);
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0 && this.isConnected()) {
      const message = this.pendingMessages.shift()!;
      this.ws!.send(this.serialize(message));
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

let wsServiceInstance: WebSocketService | null = null;

export function createWSService(config: WSConfig): WebSocketService {
  if (wsServiceInstance) {
    wsServiceInstance.disconnect();
  }
  wsServiceInstance = new WebSocketService(config);
  return wsServiceInstance;
}

export function getWSService(): WebSocketService | null {
  return wsServiceInstance;
}

export default WebSocketService;
