import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage } from './types.js';

type Channel = Set<WebSocket>;

const channels = new Map<string, Channel>();

let wss: WebSocketServer;

export function initWs(server: import('http').Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        if (msg.type === 'subscribe') {
          const channel = (msg.payload as { channel: string }).channel;
          subscribe(ws, channel);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      channels.forEach((subs) => subs.delete(ws));
    });
  });

  return wss;
}

function subscribe(ws: WebSocket, channel: string) {
  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }
  channels.get(channel)!.add(ws);
}

export function broadcast(channel: string, msg: WsMessage) {
  const subs = channels.get(channel);
  if (!subs) return;
  const data = JSON.stringify(msg);
  subs.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}
