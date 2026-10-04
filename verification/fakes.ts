import type { Scheduler } from '../server/roomManager.ts';
import { Room, RoomManager } from '../server/roomManager.ts';
import { selectRandomQuestions } from '../shared/questions.ts';
import type { ServerMessage, User } from '../shared/types.ts';
import type { MatchResult, RadarData } from '../shared/types.ts';

export class FakeScheduler implements Scheduler {
  private now = 0;
  private nextId = 1;
  private queue: { id: number; runAt: number; callback: () => void }[] = [];

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.queue.push({ id, runAt: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.queue = this.queue.filter(timer => timer.id !== id);
  }

  get currentTime(): number {
    return this.now;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    while (true) {
      let earliest: { id: number; runAt: number; callback: () => void } | null = null;
      for (const timer of this.queue) {
        if (timer.runAt <= target && (!earliest || timer.runAt < earliest.runAt)) {
          earliest = timer;
        }
      }
      if (!earliest) break;
      this.queue = this.queue.filter(timer => timer.id !== earliest!.id);
      this.now = earliest.runAt;
      earliest.callback();
    }
    this.now = target;
  }
}

export class MockWebSocket {
  readyState = 1;
  readonly messages: ServerMessage[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  ofType(type: ServerMessage['type']): ServerMessage[] {
    return this.messages.filter(message => message.type === type);
  }
}

export interface ScriptedRoom {
  room: Room;
  manager: RoomManager;
  scheduler: FakeScheduler;
  users: User[];
  sockets: Map<string, MockWebSocket>;
}

export function createScriptedRoom(seed: number, names: string[] = ['小明', '小红']): ScriptedRoom {
  const scheduler = new FakeScheduler();
  const manager = new RoomManager({
    scheduler,
    selectQuestions: (count: number) => selectRandomQuestions(count, seed),
  });
  const room = manager.createRoom('TEST');
  const sockets = new Map<string, MockWebSocket>();

  const users = names.map((name, index) => {
    const socket = new MockWebSocket();
    sockets.set(`pending-${index}`, socket);
    const user = room.addUser({
      name,
      avatar: `avatar-${index}`,
      roomId: 'TEST',
      ws: socket,
    });
    sockets.delete(`pending-${index}`);
    sockets.set(user.id, socket);
    return user;
  });

  return { room, manager, scheduler, users, sockets };
}

export function playToCompletion(
  room: Room,
  scheduler: FakeScheduler,
  answerFor: (user: User, questionIndex: number) => number | null
): void {
  scheduler.advance(3000);
  let guard = 0;
  while (room.status === 'playing' && guard < 50) {
    guard++;
    const qi = room.currentQuestion;
    for (const user of room.users) {
      const answer = answerFor(user, qi);
      if (answer !== null) {
        room.submitAnswer(user.id, qi, answer, 1000);
      }
    }
    let inner = 0;
    while (room.status === 'playing' && room.currentQuestion === qi && inner < 100) {
      inner++;
      scheduler.advance(1000);
    }
  }
}

export function lastMessageOfType(sockets: Map<string, MockWebSocket>, type: ServerMessage['type']): ServerMessage | undefined {
  for (const socket of sockets.values()) {
    const found = socket.ofType(type);
    if (found.length > 0) return found[found.length - 1];
  }
  return undefined;
}

export function countBroadcasts(sockets: Map<string, MockWebSocket>, type: ServerMessage['type']): number {
  let count = 0;
  for (const socket of sockets.values()) count += socket.ofType(type).length;
  return count;
}

interface NormalizedMatchResult {
  matches: MatchResult[];
  radarData: RadarData;
}

export function normalizeMatchResult(
  payload: { matches: MatchResult[]; radarData: RadarData },
  room: Room
): NormalizedMatchResult {
  const nameOf = (userId: string) => room.getUser(userId)?.name ?? userId;
  return {
    matches: payload.matches.map(m => ({ ...m, userId: nameOf(m.userId) })),
    radarData: {
      ...payload.radarData,
      users: payload.radarData.users.map(u => ({ ...u, userId: nameOf(u.userId) })),
    },
  };
}
