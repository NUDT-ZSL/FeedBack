import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import bandsRouter from './routes/bands.js';
import scheduleRouter, { setWebSocketServer, registerClient, unregisterClient, updateClientSubscriptions } from './routes/schedule.js';

const app = express();
const server = http.createServer(app);
const PORT = 3099;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '音乐节管理系统服务正常' });
});

app.use('/api/bands', bandsRouter);
app.use('/api/schedule', scheduleRouter);

const wss = new WebSocketServer({ server, path: '/ws' });

setWebSocketServer(wss);

wss.on('connection', (ws) => {
  console.log('WebSocket 客户端已连接');
  registerClient(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'subscribe' && Array.isArray(data.bandIds)) {
        updateClientSubscriptions(ws, data.bandIds);
        console.log(`客户端订阅了 ${data.bandIds.length} 个乐队`);
      }
    } catch (e) {
      console.error('WebSocket 消息解析失败:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket 客户端已断开');
    unregisterClient(ws);
  });

  ws.send(JSON.stringify({ type: 'hello', message: '欢迎连接音乐节排期服务' }));
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 服务运行在 ws://localhost:${PORT}/ws`);
});
