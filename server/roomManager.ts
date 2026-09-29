import type { PlayerState, RoomState } from '../types/index.js';
import { GameEngine } from './gameEngine.js';

interface Room {
  id: string;
  name: string;
  players: Map<string, { socketId: string; playerState: PlayerState }>;
  state: RoomState;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private gameEngine: GameEngine;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
  }

  public createRoom(roomId: string, roomName: string): RoomState {
    if (this.rooms.has(roomId)) {
      throw new Error('Room already exists');
    }

    const room: Room = {
      id: roomId,
      name: roomName,
      players: new Map(),
      state: {
        id: roomId,
        name: roomName,
        players: {},
        currentTurn: '',
        turnNumber: 0,
        phase: 'waiting',
        winner: null,
        battleLog: [],
      },
    };

    this.rooms.set(roomId, room);
    return room.state;
  }

  public joinRoom(
    roomId: string,
    socketId: string,
    playerId: string,
    nickname: string,
    avatar: string
  ): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.players.size >= 2) {
      throw new Error('Room is full');
    }

    if (room.state.phase !== 'waiting') {
      throw new Error('Game already started');
    }

    const playerState = this.gameEngine.createPlayerState(
      playerId,
      nickname,
      avatar
    );

    room.players.set(socketId, {
      socketId,
      playerState,
    });

    room.state.players[playerId] = playerState;

    if (room.players.size === 2) {
      room.state = this.gameEngine.startGame(room.state);
    }

    return room.state;
  }

  public leaveRoom(roomId: string, socketId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const playerEntry = room.players.get(socketId);
    if (playerEntry) {
      delete room.state.players[playerEntry.playerState.id];
      room.players.delete(socketId);
    }

    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      return null;
    }

    if (room.state.phase === 'playing') {
      room.state.phase = 'ended';
      const remainingPlayer = Array.from(room.players.values())[0];
      if (remainingPlayer) {
        room.state.winner = remainingPlayer.playerState.id;
      }
    }

    return room.state;
  }

  public getRoom(roomId: string): RoomState | undefined {
    const room = this.rooms.get(roomId);
    return room?.state;
  }

  public getRoomBySocketId(socketId: string): { roomId: string; room: Room } | undefined {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.players.has(socketId)) {
        return { roomId, room };
      }
    }
    return undefined;
  }

  public getPlayerBySocketId(socketId: string): { roomId: string; playerId: string; playerState: PlayerState } | undefined {
    for (const [roomId, room] of this.rooms.entries()) {
      const playerEntry = room.players.get(socketId);
      if (playerEntry) {
        return {
          roomId,
          playerId: playerEntry.playerState.id,
          playerState: playerEntry.playerState,
        };
      }
    }
    return undefined;
  }

  public updateRoomState(roomId: string, state: RoomState): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    room.state = state;

    for (const [_socketId, playerEntry] of room.players.entries()) {
      const playerState = state.players[playerEntry.playerState.id];
      if (playerState) {
        playerEntry.playerState = playerState;
      }
    }
  }

  public broadcastToRoom(
    roomId: string,
    event: string,
    data: unknown,
    send: (socketId: string, event: string, data: unknown) => void
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    for (const socketId of room.players.keys()) {
      send(socketId, event, data);
    }
  }
}
