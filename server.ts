import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { AddressInfo } from 'net';
import type { CanvasElement, WSMessage } from './src/types';

export interface BoardSnapshot {
  elements: CanvasElement[];
  version: number;
  userIds: string[];
}

export interface BoardServer {
  app: Express;
  httpServer: HttpServer;
  wss: WebSocketServer;
  getSnapshot: () => BoardSnapshot;
  listen: (port?: number) => Promise<number>;
  close: () => Promise<void>;
}

export function createBoardServer(): BoardServer {
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  let boardElements: CanvasElement[] = [];
  let boardVersion = 0;
  const connectedUsers = new Map<string, WebSocket>();

  app.get('/api/board', (_req, res) => {
    res.json({
      elements: boardElements,
      version: boardVersion,
    });
  });

  app.post('/api/board', (req, res) => {
    const { elements } = req.body;
    if (Array.isArray(elements)) {
      boardElements = elements;
      boardVersion++;
      res.json({ success: true, version: boardVersion });
    } else {
      res.status(400).json({ success: false, error: 'Invalid data' });
    }
  });

  function broadcast(message: WSMessage, excludeUserId?: string) {
    const data = JSON.stringify(message);
    connectedUsers.forEach((ws, userId) => {
      if (userId !== excludeUserId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  function broadcastUserCount() {
    const userIds = Array.from(connectedUsers.keys());
    broadcast({
      type: 'users',
      count: userIds.length,
      userIds,
      timestamp: Date.now(),
    });
  }

  wss.on('connection', (ws) => {
    const userId = uuidv4();
    connectedUsers.set(userId, ws);

    console.log(`User connected: ${userId}, total: ${connectedUsers.size}`);

    ws.send(JSON.stringify({
      type: 'sync',
      elements: boardElements,
    }));

    broadcast({
      type: 'join',
      userId,
      timestamp: Date.now(),
    }, userId);

    broadcastUserCount();

    ws.on('message', (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'draw':
            if (!boardElements.find(e => e.id === message.element.id)) {
              boardElements.push(message.element);
              boardVersion++;
            }
            broadcast(message, userId);
            break;
          case 'update':
            const elementIndex = boardElements.findIndex(e => e.id === message.elementId);
            if (elementIndex !== -1) {
              boardElements[elementIndex] = {
                ...boardElements[elementIndex],
                ...message.updates,
              };
              boardVersion++;
            }
            broadcast(message, userId);
            break;
          case 'delete':
            if (boardElements.some(e => e.id === message.elementId)) {
              boardElements = boardElements.filter(e => e.id !== message.elementId);
              boardVersion++;
              broadcast(message, userId);
            }
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      connectedUsers.delete(userId);
      console.log(`User disconnected: ${userId}, total: ${connectedUsers.size}`);
      broadcast({
        type: 'leave',
        userId,
        timestamp: Date.now(),
      });
      broadcastUserCount();
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connectedUsers.delete(userId);
      broadcastUserCount();
    });
  });

  return {
    app,
    httpServer,
    wss,
    getSnapshot: () => ({
      elements: boardElements.map((element) => ({ ...element })),
      version: boardVersion,
      userIds: Array.from(connectedUsers.keys()),
    }),
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },
    close() {
      for (const ws of connectedUsers.values()) {
        ws.terminate();
      }
      return new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.closeAllConnections?.();
          httpServer.close(() => resolve());
        });
      });
    },
  };
}

const entryPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
if (entryPath === import.meta.url) {
  const PORT = 3001;
  const board = createBoardServer();
  board.listen(PORT).then(() => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  });
}
