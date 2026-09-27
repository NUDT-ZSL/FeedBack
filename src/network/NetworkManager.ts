import { io, Socket } from 'socket.io-client';

export interface BlockData {
  x: number;
  y: number;
  color: string;
  isIndestructible: boolean;
}

export interface PlayerData {
  id: string;
  name: string;
  x: number;
  y: number;
  hatColor: string;
  isCurrentPlayer?: boolean;
}

export type NetworkEventHandler = {
  onPlayerJoin?: (player: PlayerData) => void;
  onPlayerLeave?: (playerId: string) => void;
  onPlayerMove?: (playerId: string, x: number, y: number) => void;
  onBlockPlace?: (x: number, y: number, color: string) => void;
  onBlockBreak?: (x: number, y: number) => void;
  onWorldState?: (blocks: BlockData[], players: PlayerData[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export class NetworkManager {
  private socket: Socket | null = null;
  private handlers: NetworkEventHandler = {};
  private isConnected = false;
  private isMockMode = true;
  private mockPlayers: Map<string, PlayerData> = new Map();
  private playerId = '';

  constructor() {
    this.playerId = 'player_' + Math.random().toString(36).substr(2, 9);
  }

  connect(handlers: NetworkEventHandler = {}): void {
    this.handlers = handlers;

    if (this.isMockMode) {
      this.setupMockMode();
      return;
    }

    try {
      this.socket = io('http://localhost:3000', {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        handlers.onConnect?.();
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        handlers.onDisconnect?.();
      });

      this.socket.on('player_join', (player: PlayerData) => {
        handlers.onPlayerJoin?.(player);
      });

      this.socket.on('player_leave', (playerId: string) => {
        handlers.onPlayerLeave?.(playerId);
      });

      this.socket.on('player_move', (data: { playerId: string; x: number; y: number }) => {
        handlers.onPlayerMove?.(data.playerId, data.x, data.y);
      });

      this.socket.on('block_place', (data: { x: number; y: number; color: string }) => {
        handlers.onBlockPlace?.(data.x, data.y, data.color);
      });

      this.socket.on('block_break', (data: { x: number; y: number }) => {
        handlers.onBlockBreak?.(data.x, data.y);
      });

      this.socket.on('world_state', (data: { blocks: BlockData[]; players: PlayerData[] }) => {
        handlers.onWorldState?.(data.blocks, data.players);
      });
    } catch (e) {
      console.warn('WebSocket连接失败，切换到本地模式');
      this.setupMockMode();
    }
  }

  private setupMockMode(): void {
    this.isConnected = true;
    this.isMockMode = true;

    setTimeout(() => {
      this.handlers.onConnect?.();

      const hatColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
      const playerNames = ['玩家', '小明', '小红', '小刚'];

      const currentPlayer: PlayerData = {
        id: this.playerId,
        name: playerNames[0] + '(我)',
        x: 25,
        y: 25,
        hatColor: hatColors[0],
        isCurrentPlayer: true
      };

      this.mockPlayers.set(this.playerId, currentPlayer);
      this.handlers.onPlayerJoin?.(currentPlayer);

      setTimeout(() => {
        const botPlayer: PlayerData = {
          id: 'bot_1',
          name: playerNames[1],
          x: 28,
          y: 25,
          hatColor: hatColors[1],
          isCurrentPlayer: false
        };
        this.mockPlayers.set(botPlayer.id, botPlayer);
        this.handlers.onPlayerJoin?.(botPlayer);

        this.startBotMovement(botPlayer.id);
      }, 1500);

      this.handlers.onWorldState?.(this.generateInitialBlocks(), Array.from(this.mockPlayers.values()));
    }, 100);
  }

  private generateInitialBlocks(): BlockData[] {
    const blocks: BlockData[] = [];
    for (let x = 0; x < 50; x++) {
      blocks.push({
        x,
        y: 49,
        color: '#654321',
        isIndestructible: true
      });
    }
    return blocks;
  }

  private startBotMovement(botId: string): void {
    setInterval(() => {
      const bot = this.mockPlayers.get(botId);
      if (!bot) return;

      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 0 }
      ];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const newX = Math.max(0, Math.min(49, bot.x + dir.dx));
      const newY = Math.max(0, Math.min(49, bot.y + dir.dy));

      if (newX !== bot.x || newY !== bot.y) {
        bot.x = newX;
        bot.y = newY;
        this.handlers.onPlayerMove?.(botId, newX, newY);
      }
    }, 800);
  }

  sendPlayerMove(x: number, y: number): void {
    if (this.isMockMode) return;
    if (this.socket && this.isConnected) {
      this.socket.emit('player_move', { x, y });
    }
  }

  sendBlockPlace(x: number, y: number, color: string): void {
    if (this.isMockMode) return;
    if (this.socket && this.isConnected) {
      this.socket.emit('block_place', { x, y, color });
    }
  }

  sendBlockBreak(x: number, y: number): void {
    if (this.isMockMode) return;
    if (this.socket && this.isConnected) {
      this.socket.emit('block_break', { x, y });
    }
  }

  getPlayerId(): string {
    return this.playerId;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  }
}
