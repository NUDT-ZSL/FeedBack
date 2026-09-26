import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import {
  incrementOnlineCount,
  decrementOnlineCount,
  getOnlineCount,
  addBarrageMessage
} from './store';
import type { BarrageMessage } from './types';

interface ClientInfo {
  ws: WebSocket;
  eventId: string;
}

const clients: Map<string, ClientInfo[]> = new Map();

export const createWebSocketServer = (server: any): WebSocketServer => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const startTime = Date.now();
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const eventId = url.searchParams.get('eventId');

      if (!eventId) {
        ws.close(1008, 'Missing eventId');
        return;
      }

      const clientInfo: ClientInfo = { ws, eventId };

      if (!clients.has(eventId)) {
        clients.set(eventId, []);
      }
      clients.get(eventId)!.push(clientInfo);

      const onlineCount = incrementOnlineCount(eventId);
      console.log(`Client connected to event ${eventId}, online: ${onlineCount}`);

      broadcast(eventId, {
        type: 'onlineCount',
        count: onlineCount
      });

      ws.on('message', (data: WebSocket.Data) => {
        const msgStartTime = Date.now();
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'barrage' && message.message) {
            const barrageMessage: BarrageMessage = message.message;
            addBarrageMessage(barrageMessage);

            broadcast(eventId, {
              type: 'barrage',
              message: barrageMessage
            });

            const duration = Date.now() - msgStartTime;
            if (duration > 50) {
              console.warn(`Barrage processing took ${duration}ms`);
            }
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        const eventClients = clients.get(eventId);
        if (eventClients) {
          const index = eventClients.findIndex(c => c.ws === ws);
          if (index > -1) {
            eventClients.splice(index, 1);
          }
          if (eventClients.length === 0) {
            clients.delete(eventId);
          }
        }

        const onlineCount = decrementOnlineCount(eventId);
        console.log(`Client disconnected from event ${eventId}, online: ${onlineCount}`);

        broadcast(eventId, {
          type: 'onlineCount',
          count: onlineCount
        });
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      const totalDuration = Date.now() - startTime;
      if (totalDuration > 100) {
        console.warn(`Connection setup took ${totalDuration}ms`);
      }
    } catch (error) {
      console.error('Connection error:', error);
      ws.close(1011, 'Internal server error');
    }
  });

  return wss;
};

export const broadcast = (eventId: string, data: any): void => {
  const eventClients = clients.get(eventId);
  if (!eventClients) return;

  const message = JSON.stringify(data);
  const startTime = Date.now();

  eventClients.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch (error) {
        console.error('Failed to send message to client:', error);
      }
    }
  });

  const duration = Date.now() - startTime;
  if (duration > 50) {
    console.warn(`Broadcast to ${eventClients.length} clients took ${duration}ms`);
  }
};

export const getOnlineClientsCount = (eventId: string): number => {
  return getOnlineCount(eventId);
};
