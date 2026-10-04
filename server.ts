import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { pathToFileURL } from 'url';
import type { CanvasElement, WSMessage } from './src/types';

export interface BoardStateSnapshot {
  elements: CanvasElement[];
  version: number;
  userCount: number;
}

export interface BoardServerOptions {
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface BoardServer {
  app: express.Application;
  server: HttpServer;
  wss: WebSocketServer;
  getState: () => BoardStateSnapshot;
  close: () => Promise<void>;
}

export function createBoardServer(options: BoardServerOptions = {}): BoardServer {
  const logger = options.logger ?? console;
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

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

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isValidElement(element: unknown): element is CanvasElement {
    return isObject(element)
      && typeof element.id === 'string'
      && element.id.length > 0
      && typeof element.type === 'string';
  }

  wss.on('connection', (ws) => {
    const userId = uuidv4();
    connectedUsers.set(userId, ws);

    logger.log(`User connected: ${userId}, total: ${connectedUsers.size}`);

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
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        logger.error('Error parsing message:', error);
        return;
      }

      if (!isObject(message) || typeof message.type !== 'string') {
        logger.error('Invalid message: not an object with a string type');
        return;
      }

      try {
        switch (message.type) {
          case 'draw': {
            const element: unknown = message.element;
            if (!isValidElement(element)) {
              logger.error('Invalid draw message: missing or malformed element');
              break;
            }
            if (!boardElements.find(e => e.id === element.id)) {
              boardElements.push(element);
              boardVersion++;
            }
            broadcast(message as WSMessage, userId);
            break;
          }
          case 'update': {
            if (typeof message.elementId !== 'string'
              || !isObject(message.updates)) {
              logger.error('Invalid update message: missing elementId or updates');
              break;
            }
            const elementIndex = boardElements.findIndex(e => e.id === message.elementId);
            if (elementIndex !== -1) {
              boardElements[elementIndex] = {
                ...boardElements[elementIndex],
                ...message.updates,
              };
              boardVersion++;
            }
            broadcast(message as WSMessage, userId);
            break;
          }
          case 'delete': {
            if (typeof message.elementId !== 'string') {
              logger.error('Invalid delete message: missing elementId');
              break;
            }
            const beforeCount = boardElements.length;
            boardElements = boardElements.filter(e => e.id !== message.elementId);
            if (boardElements.length !== beforeCount) {
              boardVersion++;
            }
            broadcast(message as WSMessage, userId);
            break;
          }
          default:
            logger.error(`Unknown message type: ${message.type}`);
        }
      } catch (error) {
        logger.error('Error handling message:', error);
      }
    });

    ws.on('close', () => {
      connectedUsers.delete(userId);
      logger.log(`User disconnected: ${userId}, total: ${connectedUsers.size}`);
      broadcast({
        type: 'leave',
        userId,
        timestamp: Date.now(),
      });
      broadcastUserCount();
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
      connectedUsers.delete(userId);
      broadcastUserCount();
    });
  });

  return {
    app,
    server,
    wss,
    getState: () => ({
      elements: boardElements,
      version: boardVersion,
      userCount: connectedUsers.size,
    }),
    close: () => new Promise<void>((resolve, reject) => {
      wss.close();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}

const isMainModule = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const { server } = createBoardServer();
  const PORT = 3001;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  });
}
