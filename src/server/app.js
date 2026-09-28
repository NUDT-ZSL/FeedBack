import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { jwtSecret } from './data.js';
import {
  authHandler,
  playHandler,
  roleHandler,
  applicationHandler,
  interviewHandler,
  notificationHandler,
  authMiddleware,
  directorOnly,
  actorOnly,
  setWSCallbacks,
} from './handlers.js';

const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', authHandler.register);
app.post('/api/auth/login', authHandler.login);
app.get('/api/auth/me', authMiddleware, authHandler.me);

app.get('/api/plays', playHandler.list);
app.get('/api/plays/:id', playHandler.get);
app.post('/api/plays', authMiddleware, directorOnly, playHandler.create);
app.put('/api/plays/:id', authMiddleware, directorOnly, playHandler.update);
app.delete('/api/plays/:id', authMiddleware, directorOnly, playHandler.delete);
app.get('/api/my/plays', authMiddleware, directorOnly, playHandler.myPlays);

app.post('/api/plays/:playId/roles', authMiddleware, directorOnly, roleHandler.create);
app.put('/api/plays/:playId/roles/:roleId', authMiddleware, directorOnly, roleHandler.update);
app.delete('/api/plays/:playId/roles/:roleId', authMiddleware, directorOnly, roleHandler.delete);
app.put('/api/plays/:playId/roles/reorder', authMiddleware, directorOnly, roleHandler.reorder);
app.get('/api/roles/:roleId/applications', authMiddleware, directorOnly, roleHandler.applications);

app.post('/api/roles/:roleId/apply', authMiddleware, actorOnly, applicationHandler.apply);
app.get('/api/my/applications', authMiddleware, actorOnly, applicationHandler.myApplications);
app.put('/api/applications/:id/status', authMiddleware, directorOnly, applicationHandler.updateStatus);

app.get('/api/interviews', authMiddleware, interviewHandler.list);
app.post('/api/interviews', authMiddleware, directorOnly, interviewHandler.create);
app.put('/api/interviews/:id', authMiddleware, directorOnly, interviewHandler.update);
app.delete('/api/interviews/:id', authMiddleware, directorOnly, interviewHandler.delete);

app.get('/api/notifications', authMiddleware, notificationHandler.list);
app.put('/api/notifications/read', authMiddleware, notificationHandler.markRead);

app.use((_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const userSockets = new Map();

wss.on('connection', (ws, req) => {
  let userId = null;
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const token = urlParams.get('token');

  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      userId = decoded.id;
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(ws);
      console.log(`[WS] User ${userId} connected`);
    } catch (err) {
      console.log('[WS] Invalid token');
    }
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (_err) {
      /* ignore parse errors */
    }
  });

  ws.on('close', () => {
    if (userId && userSockets.has(userId)) {
      userSockets.get(userId).delete(ws);
      if (userSockets.get(userId).size === 0) {
        userSockets.delete(userId);
      }
      console.log(`[WS] User ${userId} disconnected`);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function sendToUser(userId, message) {
  const data = JSON.stringify(message);
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.forEach((client) => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  }
}

setWSCallbacks(broadcast, sendToUser);

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Theater Casting Server`);
  console.log(`📡 REST API:   http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`⏰ Started at: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================\n`);
  console.log(`📋 Test Accounts:`);
  console.log(`   导演: director@theater.com / 123456`);
  console.log(`   演员: actor1@theater.com / 123456`);
  console.log(`   演员: actor2@theater.com / 123456`);
  console.log(`   演员: actor3@theater.com / 123456\n`);
});

export default app;
