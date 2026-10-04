import type { ServerMessage, SocketLike, User } from '../shared/types';
import type { Scheduler } from '../shared/scheduler';
import { Room, RoomManager } from '../server/roomManager';

interface ScheduledTask {
  id: number;
  time: number;
  callback: () => void;
}

export class ManualScheduler implements Scheduler {
  private nowMs = 0;
  private nextId = 1;
  private queue: ScheduledTask[] = [];

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.queue.push({ id, time: this.nowMs + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter(task => task.id !== handle);
  }

  now(): number {
    return this.nowMs;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  advance(delayMs: number): void {
    const target = this.nowMs + delayMs;
    for (;;) {
      const next = this.queue
        .filter(task => task.time <= target)
        .sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!next) break;
      this.nowMs = next.time;
      this.queue = this.queue.filter(task => task.id !== next.id);
      next.callback();
    }
    this.nowMs = target;
  }

  runAll(): void {
    while (this.queue.length > 0) {
      const nextTime = Math.min(...this.queue.map(task => task.time));
      this.advance(nextTime - this.nowMs);
    }
  }
}

export class FakeWebSocket implements SocketLike {
  readyState = 1;
  readonly messages: ServerMessage[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  ofType<T extends ServerMessage['type']>(
    type: T
  ): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter(m => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

export interface TestRoomContext {
  manager: RoomManager;
  room: Room;
  scheduler: ManualScheduler;
  users: User[];
  sockets: FakeWebSocket[];
}

export function createTestRoom(options: { seed?: number; userCount?: number; roomId?: string } = {}): TestRoomContext {
  const scheduler = new ManualScheduler();
  const manager = new RoomManager({ scheduler, seed: options.seed ?? 42 });
  const room = manager.createRoom(options.roomId ?? 'TESTROOM');
  const users: User[] = [];
  const sockets: FakeWebSocket[] = [];

  for (let i = 0; i < (options.userCount ?? 2); i++) {
    const ws = new FakeWebSocket();
    const user = room.addUser({
      name: `用户${i + 1}`,
      avatar: `avatar-${i + 1}`,
      roomId: room.id,
      ws,
    });
    users.push(user);
    sockets.push(ws);
  }

  return { manager, room, scheduler, users, sockets };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  return false;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export class Suite {
  readonly results: CheckResult[] = [];

  constructor(readonly name: string) {}

  check(name: string, condition: boolean, detail?: string): boolean {
    this.results.push({ name, passed: condition, detail: condition ? undefined : detail });
    return condition;
  }

  assertEqual<T>(name: string, actual: T, expected: T): boolean {
    const passed = deepEqual(actual, expected);
    this.results.push({
      name,
      passed,
      detail: passed
        ? undefined
        : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    });
    return passed;
  }
}

export type SuiteFn = (suite: Suite) => void;
