import { io, Socket } from 'socket.io-client';
import {
  Operation,
  WorldSnapshot,
  ReplayOptions,
  ReplayResult,
  MutableWorldState,
  applyOperation,
  createEmptyState,
  stateToSnapshot,
  replayOperations
} from './OperationLog';

export {
  Operation,
  WorldSnapshot,
  SnapshotBlock,
  SnapshotPlayer,
  ReplayOptions,
  ReplayResult,
  MissingRange,
  replayOperations
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

export class NetworkManager {
  private socket: Socket | null = null;
  private handlers: NetworkEventHandler = {};
  private isConnected = false;
  private isMockMode = true;
  private mockPlayers: Map<string, PlayerData> = new Map();
  private playerId = '';
  private operationLog: Operation[] = [];
  private liveState: MutableWorldState = createEmptyState();
  private nextSeqValue = 1;

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
        this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'player_join', player });
        handlers.onPlayerJoin?.(player);
      });

      this.socket.on('player_leave', (playerId: string) => {
        this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'player_leave', playerId });
        handlers.onPlayerLeave?.(playerId);
      });

      this.socket.on('player_move', (data: { playerId: string; x: number; y: number }) => {
        this.recordOperation({ seq: this.nextSeq(), source: data.playerId, type: 'player_move', playerId: data.playerId, x: data.x, y: data.y });
        handlers.onPlayerMove?.(data.playerId, data.x, data.y);
      });

      this.socket.on('block_place', (data: { x: number; y: number; color: string; source?: string }) => {
        this.recordOperation({ seq: this.nextSeq(), source: data.source ?? 'server', type: 'block_place', x: data.x, y: data.y, color: data.color });
        handlers.onBlockPlace?.(data.x, data.y, data.color);
      });

      this.socket.on('block_break', (data: { x: number; y: number; source?: string }) => {
        this.recordOperation({ seq: this.nextSeq(), source: data.source ?? 'server', type: 'block_break', x: data.x, y: data.y });
        handlers.onBlockBreak?.(data.x, data.y);
      });

      this.socket.on('world_state', (data: { blocks: BlockData[]; players: PlayerData[] }) => {
        this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'world_state', blocks: data.blocks, players: data.players });
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
      this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'player_join', player: currentPlayer });
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
        this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'player_join', player: botPlayer });
        this.handlers.onPlayerJoin?.(botPlayer);

        this.startBotMovement(botPlayer.id);
      }, 1500);

      const initialBlocks = this.generateInitialBlocks();
      const initialPlayers = Array.from(this.mockPlayers.values());
      this.recordOperation({ seq: this.nextSeq(), source: 'server', type: 'world_state', blocks: initialBlocks, players: initialPlayers });
      this.handlers.onWorldState?.(initialBlocks, initialPlayers);
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
        this.recordOperation({ seq: this.nextSeq(), source: botId, type: 'player_move', playerId: botId, x: newX, y: newY });
        this.handlers.onPlayerMove?.(botId, newX, newY);
      }
    }, 800);
  }

  sendPlayerMove(x: number, y: number): void {
    if (this.isMockMode) {
      const me = this.mockPlayers.get(this.playerId);
      if (me) {
        me.x = x;
        me.y = y;
      }
      this.recordOperation({ seq: this.nextSeq(), source: this.playerId, type: 'player_move', playerId: this.playerId, x, y });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('player_move', { x, y });
    }
  }

  sendBlockPlace(x: number, y: number, color: string): void {
    if (this.isMockMode) {
      this.recordOperation({ seq: this.nextSeq(), source: this.playerId, type: 'block_place', x, y, color });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('block_place', { x, y, color });
    }
  }

  sendBlockBreak(x: number, y: number): void {
    if (this.isMockMode) {
      this.recordOperation({ seq: this.nextSeq(), source: this.playerId, type: 'block_break', x, y });
      return;
    }
    if (this.socket && this.isConnected) {
      this.socket.emit('block_break', { x, y });
    }
  }

  private nextSeq(): number {
    return this.nextSeqValue++;
  }

  private recordOperation(op: Operation): void {
    this.operationLog.push(op);
    applyOperation(this.liveState, op);
  }

  getOperationLog(): Operation[] {
    return this.operationLog.map(op => this.cloneOperation(op));
  }

  getOperationsSince(seq: number): Operation[] {
    return this.operationLog.filter(op => op.seq > seq).map(op => this.cloneOperation(op));
  }

  getLastSeq(): number {
    return this.nextSeqValue - 1;
  }

  getSnapshot(): WorldSnapshot {
    return stateToSnapshot(this.liveState);
  }

  replayOperations(ops: Operation[], options?: ReplayOptions): ReplayResult {
    return replayOperations(ops, options);
  }

  replayFromLog(sinceSeq = 0): ReplayResult {
    return replayOperations(this.getOperationsSince(sinceSeq), { baseSeq: sinceSeq });
  }

  private cloneOperation(op: Operation): Operation {
    if (op.type === 'world_state') {
      return {
        ...op,
        blocks: op.blocks.map(block => ({ ...block })),
        players: op.players.map(player => ({ ...player }))
      };
    }
    if (op.type === 'player_join') {
      return { ...op, player: { ...op.player } };
    }
    return { ...op };
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
