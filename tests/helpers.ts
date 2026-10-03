import { WebSocket } from 'ws';
import type { CanvasElement, WSMessage } from '../src/types';

export function makeElement(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    type: 'rectangle',
    x: 10,
    y: 10,
    width: 100,
    height: 80,
    color: '#000000',
    strokeWidth: 2,
    rotation: 0,
    layer: 1,
    userId: 'test-user',
    createdAt: 1700000000000,
    opacity: 1,
    ...overrides,
  };
}

export class TestClient {
  readonly ws: WebSocket;
  readonly log: WSMessage[] = [];
  private inbox: WSMessage[] = [];
  private waiters: Array<{
    pred: (m: WSMessage) => boolean;
    resolve: (m: WSMessage) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.log.push(msg);
      const waiterIndex = this.waiters.findIndex((w) => w.pred(msg));
      if (waiterIndex !== -1) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new TestClient(ws);
      ws.on('open', () => resolve(client));
      ws.on('error', reject);
    });
  }

  send(message: unknown) {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  waitFor(pred: (m: WSMessage) => boolean, description: string, timeoutMs = 3000): Promise<WSMessage> {
    const buffered = this.inbox.findIndex(pred);
    if (buffered !== -1) {
      const [msg] = this.inbox.splice(buffered, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`等待消息超时: ${description}`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve, reject, timer });
    });
  }

  waitForType<T extends WSMessage['type']>(type: T, timeoutMs = 3000) {
    return this.waitFor((m) => m.type === type, `type=${type}`, timeoutMs) as Promise<
      Extract<WSMessage, { type: T }>
    >;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export interface BoardState {
  elements: CanvasElement[];
  version: number;
}

export async function fetchBoard(port: number): Promise<BoardState> {
  const res = await fetch(`http://127.0.0.1:${port}/api/board`);
  if (!res.ok) throw new Error(`GET /api/board 返回 ${res.status}`);
  return res.json() as Promise<BoardState>;
}

export async function waitUntil(
  cond: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待条件超时: ${description}`);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class AssertFailure extends Error {}

export function assert(cond: boolean, label: string, expected?: unknown, actual?: unknown): void {
  if (cond) return;
  let detail = label;
  if (expected !== undefined || actual !== undefined) {
    detail += `\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`;
  }
  throw new AssertFailure(detail);
}

export function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  assert(deepEqual(actual, expected), label, expected, actual);
}
