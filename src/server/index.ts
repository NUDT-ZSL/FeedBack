import http from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { setWebSocketServer, registerClient, unregisterClient, updateClientSubscriptions } from './routes/schedule.js';

const app = createApp();
const server = http.createServer(app);
const PORT = 3099;

const wss = new WebSocketServer({ server, path: '/ws' });

setWebSocketServer(wss);

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  registerClient(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'subscribe' && Array.isArray(data.bandIds)) {
        updateClientSubscriptions(ws, data.bandIds);
        console.log(`Client subscribed to ${data.bandIds.length} bands`);
      }
    } catch (e) {
      console.error('WebSocket message parse failed:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    unregisterClient(ws);
  });

  ws.send(JSON.stringify({ type: 'hello', message: 'connected to festival schedule service' }));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket running at ws://localhost:${PORT}/ws`);
});
