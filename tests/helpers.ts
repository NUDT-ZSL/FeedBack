import { WebSocket } from 'ws';
import { strict as assert } from 'assert';
import { createBoardServer, type BoardServer } from '../server';
import type { CanvasElement, WSMessage } from '../src/types';

export const DEFAULT_TIMEOUT_MS = 5000;

export interface RunningServer {
  server: BoardServer;
  port: number;
  wsUrl: string;
  httpUrl: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const silentLogger = { log: () => {}, error: () => {} };
  const board = createBoardServer({ logger: silentLogger });
  board.wss.on('connection', () => {});
  await new Promise<void>((resolve) => {
    board.server.listen(0, '127.0.0.1', resolve);
  });
  const address = board.server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Failed to determine test server address');
  }
  const port = address.port;
  return {
    server: board,
    port,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    httpUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const client of board.wss.clients) {
        client.terminate();
      }
      await board.close();
    },
  };
}

export class TestClient {
  readonly ws: WebSocket;
  readonly messages: WSMessage[] = [];
  private waiters: Array<{
    predicate: (message: WSMessage) => boolean;
    resolve: (message: WSMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      let message: WSMessage;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.messages.push(message);
      const pending = [...this.waiters];
      for (const waiter of pending) {
        if (waiter.predicate(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
  }

  static connect(wsUrl: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(message: WSMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  ofType<T extends WSMessage['type']>(type: T): Array<Extract<WSMessage, { type: T }>> {
    return this.messages.filter((m) => m.type === type) as Array<Extract<WSMessage, { type: T }>>;
  }

  waitForMessage(
    predicate: (message: WSMessage) => boolean,
    description: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<WSMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.timer === timer);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = 15,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
}

export interface BoardResponse {
  elements: CanvasElement[];
  version: number;
}

export async function getBoard(httpUrl: string): Promise<BoardResponse> {
  const res = await fetch(`${httpUrl}/api/board`);
  assert.equal(res.status, 200, `GET /api/board should return 200, got ${res.status}`);
  return (await res.json()) as BoardResponse;
}

export function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    throw new Error(
      `${label} mismatch\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

export function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

let elementCounter = 0;

export function makeElement(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  elementCounter += 1;
  return {
    id,
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    color: '#3366ff',
    strokeWidth: 2,
    rotation: 0,
    layer: 1,
    userId: `test-user-${elementCounter}`,
    createdAt: 1700000000000 + elementCounter,
    opacity: 1,
    ...overrides,
  };
}

export function drawMessage(userId: string, element: CanvasElement) {
  return { type: 'draw' as const, userId, element, timestamp: Date.now() };
}

export function updateMessage(userId: string, elementId: string, updates: Partial<CanvasElement>) {
  return { type: 'update' as const, userId, elementId, updates, timestamp: Date.now() };
}

export function deleteMessage(userId: string, elementId: string) {
  return { type: 'delete' as const, userId, elementId, timestamp: Date.now() };
}
