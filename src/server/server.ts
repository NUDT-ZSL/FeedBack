import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import projectsRouter from './routes/projects';
import usersRouter from './routes/users';

const app = express();
const PORT = 3000;
const JWT_SECRET = 'volunteer-platform-secret-key';

app.use(cors());
app.use(express.json());

app.use('/api/projects', projectsRouter);
app.use('/api/users', usersRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
(global as any).wss = wss;

wss.on('connection', (ws: any, req) => {
  const token = req.url?.split('token=')[1];
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      ws.userId = decoded.id;
      ws.userRole = decoded.role;
    } catch (err) {
      console.log('WebSocket token verification failed');
    }
  }

  ws.on('message', (message: string) => {
    console.log('WebSocket message received:', message);
  });

  ws.send(JSON.stringify({ type: 'connected', data: { message: 'WebSocket连接成功' } }));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});
