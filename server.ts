import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { CanvasElement, WSMessage } from './src/types';

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
          boardElements = boardElements.filter(e => e.id !== message.elementId);
          boardVersion++;
          broadcast(message, userId);
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

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});
