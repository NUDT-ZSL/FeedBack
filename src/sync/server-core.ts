import express from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { CanvasElement } from '../types';
import type { ClientMessage, Op, ServerMessage, VersionedOp } from './protocol';
import { BoardState } from './merge';

export interface SyncServerOptions {
  /** Max retained ops for incremental catch-up. Older clients get a full sync. */
  logLimit?: number;
  wsPath?: string;
}

export interface SyncServer {
  server: Server;
  state: BoardState;
  getVersion: () => number;
  listen: () => Promise<number>;
  close: () => Promise<void>;
}

/**
 * Collaborative board server.
 *
 * - Maintains a monotonically increasing `version`; every accepted op is
 *   stamped with the next version and appended to an op log.
 * - Clients announce their `lastVersion` in `hello`; the server answers
 *   with `catchup` (missing ops), `synced` (nothing missing), or `sync`
 *   (full snapshot when the log no longer reaches back far enough).
 * - Ops are deduplicated by opId (safe retries) and merged through the
 *   same deterministic BoardState used by clients.
 */
export function createSyncServer(options: SyncServerOptions = {}): SyncServer {
  const logLimit = options.logLimit ?? 1000;
  const wsPath = options.wsPath ?? '/ws';

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: wsPath });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  const state = new BoardState();
  let version = 0;
  const opLog: VersionedOp[] = [];
  const opVersions = new Map<string, number>();
  const clients = new Map<string, WebSocket>();

  app.get('/api/board', (_req, res) => {
    res.json({ elements: state.getElements(), version });
  });

  // Escape hatch: full board reset (replaces the old snapshot POST).
  app.post('/api/board', (req, res) => {
    const { elements } = req.body as { elements?: CanvasElement[] };
    if (!Array.isArray(elements)) {
      res.status(400).json({ success: false, error: 'Invalid data' });
      return;
    }
    state.reset();
    state.loadSnapshot(elements);
    opLog.length = 0;
    version++;
    broadcast({ type: 'sync', elements: state.getElements(), version });
    res.json({ success: true, version });
  });

  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function broadcast(message: ServerMessage, excludeUserId?: string): void {
    const data = JSON.stringify(message);
    clients.forEach((ws, userId) => {
      if (userId !== excludeUserId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  function broadcastUserCount(): void {
    const userIds = Array.from(clients.keys());
    broadcast({ type: 'users', count: userIds.length, userIds });
  }

  function handleHello(ws: WebSocket, lastVersion: number | null): void {
    if (lastVersion === null || lastVersion === undefined) {
      send(ws, { type: 'sync', elements: state.getElements(), version });
      return;
    }
    if (lastVersion > version) {
      // Client claims a version from the future: resync fully.
      send(ws, { type: 'sync', elements: state.getElements(), version });
      return;
    }
    if (lastVersion === version) {
      send(ws, { type: 'synced', version });
      return;
    }
    const oldest = opLog.length > 0 ? opLog[0].version : version + 1;
    if (lastVersion < oldest - 1) {
      // Gap too old for the retained log: full snapshot.
      send(ws, { type: 'sync', elements: state.getElements(), version });
      return;
    }
    const missing = opLog.filter((entry) => entry.version > lastVersion);
    send(ws, { type: 'catchup', ops: missing, version });
  }

  function handleOp(ws: WebSocket, userId: string, op: Op): void {
    const existing = opVersions.get(op.opId);
    if (existing !== undefined || state.hasSeen(op.opId)) {
      // Duplicate delivery (client retry after a lost ack): just re-ack.
      send(ws, { type: 'ack', opId: op.opId, version: existing ?? version });
      return;
    }
    if (typeof op.baseVersion === 'number' && op.baseVersion > version) {
      // Client is ahead of us (e.g. server restarted): reject so the
      // client resyncs instead of forking the version stream.
      send(ws, { type: 'reject', opId: op.opId, reason: 'base-version-ahead', version });
      return;
    }
    version++;
    state.applyOp(op);
    opLog.push({ version, op });
    if (opLog.length > logLimit) opLog.splice(0, opLog.length - logLimit);
    opVersions.set(op.opId, version);
    if (opVersions.size > logLimit * 2) {
      const cutoff = version - logLimit;
      opVersions.forEach((v, k) => {
        if (v < cutoff) opVersions.delete(k);
      });
    }
    broadcast({ type: 'op', version, op }, userId);
    send(ws, { type: 'ack', opId: op.opId, version });
  }
  wss.on('connection', (ws) => {
    const connId = uuidv4();
    clients.set(connId, ws);
    broadcast({ type: 'join', userId: connId, timestamp: Date.now() }, connId);
    broadcastUserCount();

    ws.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch (error) {
        console.error('Error parsing message:', error);
        return;
      }
      switch (message.type) {
        case 'hello':
          handleHello(ws, message.lastVersion);
          break;
        case 'op':
          handleOp(ws, connId, message.op);
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(connId);
      broadcast({ type: 'leave', userId: connId, timestamp: Date.now() });
      broadcastUserCount();
    });

    ws.on('error', () => {
      clients.delete(connId);
      broadcastUserCount();
    });
  });

  return {
    server,
    state,
    getVersion: () => version,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        clients.forEach((ws) => ws.terminate());
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
