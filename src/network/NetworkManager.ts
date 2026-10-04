import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  applyOperationToSnapshot,
  cloneOperation,
  cloneSnapshot,
  createEmptySnapshot,
  replayOperations,
  LOG_SOURCE_LOCAL,
  LOG_SOURCE_MOCK,
  LOG_SOURCE_SERVER
} from './OperationLog';
import type {
  Operation,
  OperationInput,
  ReplayResult,
  WorldSnapshot
} from './OperationLog';

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

export {
  replayOperations,
  LOG_SOURCE_LOCAL,
  LOG_SOURCE_MOCK,
  LOG_SOURCE_SERVER
};
export type {
  Operation,
  OperationInput,
  ReplayResult,
  WorldSnapshot
};
export type {
  MissingRange,
  TrackedBlock,
  TrackedPlayer
} from './OperationLog';

const GRID_MIN = 0;
const GRID_MAX = 49;

export class NetworkManager {
  private socket: Socket | null = null;
  private handlers: NetworkEventHandler = {};
  private isConnected = false;
  private isMockMode = true;
  private mockPlayers: Map<string, PlayerData> = new Map();
  private mockTimers: ReturnType<typeof setTimeout>[] = [];
  private playerId = '';

  private operationLog: Operation[] = [];
  private nextSeq = 1;
  private worldState: WorldSnapshot = createEmptySnapshot();

  constructor() {
    this.playerId = 'player_' + Math.random().toString(36).substr(2, 9);
  }

  connect(handlers: NetworkEventHandler = {}): void {
    if (this.isConnected) return;
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
        this.commit({ source: LOG_SOURCE_SERVER, type: 'player_join', player });
      });

      this.socket.on('player_leave', (playerId: string) => {
        this.commit({ source: LOG_SOURCE_SERVER, type: 'player_leave', playerId });
      });

      this.socket.on('player_move', (data: { playerId: string; x: number; y: number }) => {
        this.commit({ source: data.playerId, type: 'player_move', playerId: data.playerId, x: data.x, y: data.y });
      });

      this.socket.on('block_place', (data: { x: number; y: number; color: string }) => {
        this.commit({ source: LOG_SOURCE_SERVER, type: 'block_place', x: data.x, y: data.y, color: data.color });
      });

      this.socket.on('block_break', (data: { x: number; y: number }) => {
        this.commit({ source: LOG_SOURCE_SERVER, type: 'block_break', x: data.x, y: data.y });
      });

      this.socket.on('world_state', (data: { blocks: BlockData[]; players: PlayerData[] }) => {
        this.commit({ source: LOG_SOURCE_SERVER, type: 'world_state', blocks: data.blocks, players: data.players });
      });
    } catch (e) {
      console.warn('WebSocket连接失败，切换到本地模式');
      this.setupMockMode();
    }
  }

  private commit(input: OperationInput): Operation {
    const op = { ...input, seq: this.nextSeq++ } as Operation;
    this.operationLog.push(op);
    applyOperationToSnapshot(this.worldState, op);
    this.dispatch(op);
    return op;
  }

  private dispatch(op: Operation): void {
    switch (op.type) {
      case 'world_state':
        this.handlers.onWorldState?.(
          op.blocks.map(block => ({ ...block })),
          op.players.map(player => ({ ...player }))
        );
        break;
      case 'block_place':
        this.handlers.onBlockPlace?.(op.x, op.y, op.color);
        break;
      case 'block_break':
        this.handlers.onBlockBreak?.(op.x, op.y);
        break;
      case 'player_join':
        this.handlers.onPlayerJoin?.({ ...op.player });
        break;
      case 'player_leave':
        this.handlers.onPlayerLeave?.(op.playerId);
        break;
      case 'player_move':
        this.handlers.onPlayerMove?.(op.playerId, op.x, op.y);
        break;
    }
  }

  private setupMockMode(): void {
    this.isConnected = true;
    this.isMockMode = true;

    const timer = setTimeout(() => {
      this.handlers.onConnect?.();

      this.commit({
        source: LOG_SOURCE_MOCK,
        type: 'world_state',
        blocks: this.generateInitialBlocks(),
        players: []
      });

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
      this.commit({ source: LOG_SOURCE_MOCK, type: 'player_join', player: currentPlayer });

      const botTimer = setTimeout(() => {
        const botPlayer: PlayerData = {
          id: 'bot_1',
          name: playerNames[1],
          x: 28,
          y: 25,
          hatColor: hatColors[1],
          isCurrentPlayer: false
        };
        this.mockPlayers.set(botPlayer.id, botPlayer);
        this.commit({ source: LOG_SOURCE_MOCK, type: 'player_join', player: botPlayer });
        this.startBotMovement(botPlayer.id);

        const bot2Timer = setTimeout(() => {
          const bot2: PlayerData = {
            id: 'bot_2',
            name: playerNames[2],
            x: 33,
            y: 25,
            hatColor: hatColors[2],
            isCurrentPlayer: false
          };
          this.mockPlayers.set(bot2.id, bot2);
          this.commit({ source: LOG_SOURCE_MOCK, type: 'player_join', player: bot2 });
          this.startBotMovement(bot2.id);
          this.scheduleBotLeaveCycle(bot2.id);
        }, 1500);
        this.mockTimers.push(bot2Timer);
      }, 1500);
      this.mockTimers.push(botTimer);
    }, 100);
    this.mockTimers.push(timer);
  }

  private scheduleBotLeaveCycle(botId: string): void {
    const leaveTimer = setTimeout(() => {
      const bot = this.mockPlayers.get(botId);
      if (!bot) return;
      this.mockPlayers.delete(botId);
      this.commit({ source: LOG_SOURCE_MOCK, type: 'player_leave', playerId: botId });

      const rejoinTimer = setTimeout(() => {
        bot.x = 33;
        bot.y = 25;
        this.mockPlayers.set(botId, bot);
        this.commit({ source: LOG_SOURCE_MOCK, type: 'player_join', player: { ...bot } });
        this.scheduleBotLeaveCycle(botId);
      }, 8000);
      this.mockTimers.push(rejoinTimer);
    }, 8000);
    this.mockTimers.push(leaveTimer);
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
    const interval = setInterval(() => {
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
      const newX = Math.max(GRID_MIN, Math.min(GRID_MAX, bot.x + dir.dx));
      const newY = Math.max(GRID_MIN, Math.min(GRID_MAX, bot.y + dir.dy));

      if (newX !== bot.x || newY !== bot.y) {
        bot.x = newX;
        bot.y = newY;
        this.commit({ source: botId, type: 'player_move', playerId: botId, x: newX, y: newY });
      }
    }, 800);
    this.mockTimers.push(interval);
  }

  sendPlayerMove(x: number, y: number): void {
    if (this.isMockMode) {
      const me = this.mockPlayers.get(this.playerId);
      if (!me) return;
      const newX = Math.max(GRID_MIN, Math.min(GRID_MAX, x));
      const newY = Math.max(GRID_MIN, Math.min(GRID_MAX, y));
      if (newX === me.x && newY === me.y) return;
      me.x = newX;
      me.y = newY;
      this.commit({ source: this.playerId, type: 'player_move', playerId: this.playerId, x: newX, y: newY });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('player_move', { x, y });
    }
  }

  sendBlockPlace(x: number, y: number, color: string): void {
    if (this.isMockMode) {
      this.commit({ source: LOG_SOURCE_LOCAL, type: 'block_place', x, y, color });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('block_place', { x, y, color });
    }
  }

  sendBlockBreak(x: number, y: number): void {
    if (this.isMockMode) {
      this.commit({ source: LOG_SOURCE_LOCAL, type: 'block_break', x, y });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('block_break', { x, y });
    }
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getLastSeq(): number {
    return this.nextSeq - 1;
  }

  getOperationLog(): Operation[] {
    return this.operationLog.map(cloneOperation);
  }

  getOperationsSince(seq: number): Operation[] {
    return this.operationLog.filter(op => op.seq > seq).map(cloneOperation);
  }

  getSnapshot(): WorldSnapshot {
    return cloneSnapshot(this.worldState);
  }

  replayLog(sinceSeq = 0): ReplayResult {
    return replayOperations(this.getOperationsSince(sinceSeq));
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    for (const timer of this.mockTimers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.mockTimers = [];
    this.isConnected = false;
  }
}
