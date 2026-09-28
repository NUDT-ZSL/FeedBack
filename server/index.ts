import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import cors from 'cors';
import { GameEngine } from './gameEngine.js';
import { RoomManager } from './roomManager.js';
import type { WSMessage } from '../types/index.js';

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const gameEngine = new GameEngine();
const roomManager = new RoomManager(gameEngine);

interface PlayerInfo {
  socketId: string;
  nickname: string;
  avatar: string;
}

const waitingQueue: PlayerInfo[] = [];
const socketToPlayer: Map<string, { playerId: string; nickname: string; avatar: string }> = new Map();

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function createPlayerId(): string {
  return 'player_' + generateId();
}

function createRoomId(): string {
  return 'room_' + generateId();
}

function createAvatar(): string {
  const avatars = ['😀', '😎', '🤖', '👾', '🎮', '🃏', '⚔️', '🛡️', '🔥', '💎'];
  return avatars[Math.floor(Math.random() * avatars.length)] || '👤';
}

function sendToSocket(socketId: string, event: string, data: unknown): void {
  io.to(socketId).emit(event, data);
}

function broadcastToRoom(roomId: string, event: string, data: unknown): void {
  roomManager.broadcastToRoom(roomId, event, data, sendToSocket);
}

function tryMatchPlayers(): void {
  while (waitingQueue.length >= 2) {
    const player1 = waitingQueue.shift();
    const player2 = waitingQueue.shift();
    if (!player1 || !player2) break;

    const roomId = createRoomId();
    const roomName = '匹配对战';
    roomManager.createRoom(roomId, roomName);

    const playerId1 = createPlayerId();
    const playerId2 = createPlayerId();

    socketToPlayer.set(player1.socketId, { playerId: playerId1, nickname: player1.nickname, avatar: player1.avatar });
    socketToPlayer.set(player2.socketId, { playerId: playerId2, nickname: player2.nickname, avatar: player2.avatar });

    const room1 = roomManager.joinRoom(roomId, player1.socketId, playerId1, player1.nickname, player1.avatar);
    const room2 = roomManager.joinRoom(roomId, player2.socketId, playerId2, player2.nickname, player2.avatar);

    const room = room2 || room1;
    if (room) {
      const matchFoundMsg1: WSMessage = {
        type: 'match_found',
        payload: { roomId, room, yourId: playerId1, opponent: room.players[playerId2] },
        timestamp: Date.now(),
      };
      sendToSocket(player1.socketId, 'match_found', matchFoundMsg1);

      const matchFoundMsg2: WSMessage = {
        type: 'match_found',
        payload: { roomId, room, yourId: playerId2, opponent: room.players[playerId1] },
        timestamp: Date.now(),
      };
      sendToSocket(player2.socketId, 'match_found', matchFoundMsg2);

      if (room.phase === 'playing') {
        const gameStartMsg: WSMessage = {
          type: 'game_start',
          payload: { room, firstPlayer: room.currentTurn },
          timestamp: Date.now(),
        };
        broadcastToRoom(roomId, 'game_start', gameStartMsg);

        const firstPlayer = room.players[room.currentTurn];
        if (firstPlayer) {
          const turnStartMsg: WSMessage = {
            type: 'turn_start',
            payload: { playerId: room.currentTurn, turnNumber: room.turnNumber },
            timestamp: Date.now(),
          };
          broadcastToRoom(roomId, 'turn_start', turnStartMsg);
        }
      }
    }
  }
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), waitingQueue: waitingQueue.length });
});

app.get('/rooms', (_req: Request, res: Response) => {
  const rooms = [];
  for (const [roomId] of (roomManager as unknown as { rooms: Map<string, unknown> }).rooms) {
    const room = roomManager.getRoom(roomId);
    if (room) {
      rooms.push({
        id: room.id,
        name: room.name,
        playerCount: Object.keys(room.players).length,
        phase: room.phase,
      });
    }
  }
  res.json({ rooms });
});

io.on('connection', (socket: Socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_queue', (payload: { nickname: string }) => {
    try {
      const { nickname } = payload;
      if (!nickname?.trim()) {
        throw new Error('昵称不能为空');
      }

      const existingIndex = waitingQueue.findIndex(p => p.socketId === socket.id);
      if (existingIndex !== -1) {
        waitingQueue.splice(existingIndex, 1);
      }

      const avatar = createAvatar();
      waitingQueue.push({ socketId: socket.id, nickname: nickname.trim(), avatar });
      socketToPlayer.set(socket.id, { playerId: '', nickname: nickname.trim(), avatar });

      const queuedMsg: WSMessage = {
        type: 'queue_joined',
        payload: { position: waitingQueue.length, avatar },
        timestamp: Date.now(),
      };
      socket.emit('queue_joined', queuedMsg);

      tryMatchPlayers();
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('error', errorMsg);
    }
  });

  socket.on('leave_queue', () => {
    const index = waitingQueue.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      waitingQueue.splice(index, 1);
    }
    const leftMsg: WSMessage = {
      type: 'queue_left',
      payload: {},
      timestamp: Date.now(),
    };
    socket.emit('queue_left', leftMsg);
  });

  socket.on('create_room', (payload: { roomName: string; nickname: string }) => {
    try {
      const { roomName, nickname } = payload;
      if (!nickname?.trim()) throw new Error('昵称不能为空');
      if (!roomName?.trim()) throw new Error('房间名不能为空');
      if (roomName.length > 8) throw new Error('房间名最多8个字符');

      const roomId = createRoomId();
      const playerId = createPlayerId();
      const avatar = createAvatar();

      socketToPlayer.set(socket.id, { playerId, nickname: nickname.trim(), avatar });
      roomManager.createRoom(roomId, roomName.trim());
      const room = roomManager.joinRoom(roomId, socket.id, playerId, nickname.trim(), avatar);

      const createdMsg: WSMessage = {
        type: 'room_created',
        payload: { roomId, room, yourId: playerId, roomName: roomName.trim() },
        timestamp: Date.now(),
      };
      socket.emit('room_created', createdMsg);
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('error', errorMsg);
    }
  });

  socket.on('join_room', (payload: { roomId: string; nickname: string }) => {
    try {
      const { roomId, nickname } = payload;
      if (!nickname?.trim()) throw new Error('昵称不能为空');
      if (!roomId?.trim()) throw new Error('房间ID不能为空');

      const room = roomManager.getRoom(roomId);
      if (!room) throw new Error('房间不存在');

      const playerId = createPlayerId();
      const avatar = createAvatar();

      socketToPlayer.set(socket.id, { playerId, nickname: nickname.trim(), avatar });
      const updatedRoom = roomManager.joinRoom(roomId, socket.id, playerId, nickname.trim(), avatar);

      const joinedMsg: WSMessage = {
        type: 'room_joined',
        payload: { roomId, room: updatedRoom, yourId: playerId },
        timestamp: Date.now(),
      };
      socket.emit('room_joined', joinedMsg);

      const playerJoinedMsg: WSMessage = {
        type: 'player_joined',
        payload: { playerId, nickname: nickname.trim(), avatar },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'player_joined', playerJoinedMsg);

      if (updatedRoom.phase === 'playing') {
        const opponentId = Object.keys(updatedRoom.players).find(id => id !== playerId);
        const opponent = opponentId ? updatedRoom.players[opponentId] : undefined;

        const matchFoundMsg: WSMessage = {
          type: 'match_found',
          payload: { roomId, room: updatedRoom, yourId: playerId, opponent },
          timestamp: Date.now(),
        };
        socket.emit('match_found', matchFoundMsg);

        const gameStartMsg: WSMessage = {
          type: 'game_start',
          payload: { room: updatedRoom, firstPlayer: updatedRoom.currentTurn },
          timestamp: Date.now(),
        };
        broadcastToRoom(roomId, 'game_start', gameStartMsg);

        const firstPlayer = updatedRoom.players[updatedRoom.currentTurn];
        if (firstPlayer) {
          const turnStartMsg: WSMessage = {
            type: 'turn_start',
            payload: { playerId: updatedRoom.currentTurn, turnNumber: updatedRoom.turnNumber },
            timestamp: Date.now(),
          };
          broadcastToRoom(roomId, 'turn_start', turnStartMsg);
        }
      }
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('error', errorMsg);
    }
  });

  socket.on('leave_room', (payload: { roomId: string }) => {
    try {
      const { roomId } = payload;
      const room = roomManager.leaveRoom(roomId, socket.id);

      if (room === null) {
        const deletedMsg: WSMessage = {
          type: 'room_deleted',
          payload: { roomId },
          timestamp: Date.now(),
        };
        socket.emit('room_deleted', deletedMsg);
        return;
      }

      const playerInfo = socketToPlayer.get(socket.id);
      const leftMsg: WSMessage = {
        type: 'player_left',
        payload: { room, playerId: playerInfo?.playerId || socket.id },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'player_left', leftMsg);

      if (room.phase === 'ended' && room.winner) {
        const winnerPlayer = room.players[room.winner];
        const gameEndMsg: WSMessage = {
          type: 'game_end',
          payload: {
            winner: room.winner,
            winnerName: winnerPlayer?.nickname || '对手',
            room,
          },
          timestamp: Date.now(),
        };
        broadcastToRoom(roomId, 'game_end', gameEndMsg);
      }
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('error', errorMsg);
    }
  });

  socket.on('play_card', (payload: { cardId: string; targetId: string }) => {
    try {
      const playerInfo = roomManager.getPlayerBySocketId(socket.id);
      if (!playerInfo) {
        throw new Error('玩家不在房间内');
      }

      const { roomId, playerId } = playerInfo;
      const { cardId, targetId } = payload;

      const room = roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('房间不存在');
      }

      const result = gameEngine.playCard(room, playerId, cardId, targetId);
      roomManager.updateRoomState(roomId, result.room);

      const playedMsg: WSMessage = {
        type: 'card_played',
        payload: { room: result.room, action: result.action },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'card_played', playedMsg);

      if (result.room.phase === 'ended' && result.room.winner) {
        const winnerPlayer = result.room.players[result.room.winner];
        const gameEndMsg: WSMessage = {
          type: 'game_end',
          payload: {
            winner: result.room.winner,
            winnerName: winnerPlayer?.nickname || '未知玩家',
            room: result.room,
          },
          timestamp: Date.now(),
        };
        broadcastToRoom(roomId, 'game_end', gameEndMsg);
      }
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'invalid_play',
        payload: { reason: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('invalid_play', errorMsg);
    }
  });

  socket.on('end_turn', () => {
    try {
      const playerInfo = roomManager.getPlayerBySocketId(socket.id);
      if (!playerInfo) {
        throw new Error('玩家不在房间内');
      }

      const { roomId, playerId } = playerInfo;
      const room = roomManager.getRoom(roomId);
      if (!room) {
        throw new Error('房间不存在');
      }

      if (room.currentTurn !== playerId) {
        throw new Error('不是你的回合');
      }

      const result = gameEngine.endTurn(room);
      roomManager.updateRoomState(roomId, result.room);

      const endedMsg: WSMessage = {
        type: 'turn_ended',
        payload: { room: result.room, nextPlayerId: result.room.currentTurn },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'turn_ended', endedMsg);

      const turnStartMsg: WSMessage = {
        type: 'turn_start',
        payload: { playerId: result.room.currentTurn, turnNumber: result.room.turnNumber },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'turn_start', turnStartMsg);
    } catch (error) {
      const errorMsg: WSMessage = {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      };
      socket.emit('error', errorMsg);
    }
  });

  socket.on('chat', (payload: { message: string; roomId: string }) => {
    try {
      const { message, roomId } = payload;
      const playerInfo = socketToPlayer.get(socket.id);
      if (!playerInfo) return;

      const chatMsg: WSMessage = {
        type: 'chat',
        payload: {
          playerId: playerInfo.playerId,
          nickname: playerInfo.nickname,
          message,
        },
        timestamp: Date.now(),
      };
      broadcastToRoom(roomId, 'chat', chatMsg);
    } catch (error) {
      console.error('Chat error:', error);
    }
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    const queueIndex = waitingQueue.findIndex(p => p.socketId === socket.id);
    if (queueIndex !== -1) {
      waitingQueue.splice(queueIndex, 1);
    }

    const playerInfo = roomManager.getPlayerBySocketId(socket.id);
    if (playerInfo) {
      const { roomId } = playerInfo;
      const room = roomManager.leaveRoom(roomId, socket.id);

      if (room !== null) {
        const socketPlayer = socketToPlayer.get(socket.id);
        const leftMsg: WSMessage = {
          type: 'player_left',
          payload: { room, playerId: socketPlayer?.playerId || socket.id },
          timestamp: Date.now(),
        };
        broadcastToRoom(roomId, 'player_left', leftMsg);

        if (room.phase === 'ended' && room.winner) {
          const winnerPlayer = room.players[room.winner];
          const gameEndMsg: WSMessage = {
            type: 'game_end',
            payload: {
              winner: room.winner,
              winnerName: winnerPlayer?.nickname || '对手',
              room,
            },
            timestamp: Date.now(),
          };
          broadcastToRoom(roomId, 'game_end', gameEndMsg);
        }
      }
    }

    socketToPlayer.delete(socket.id);
  });
});

const PORT = 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
