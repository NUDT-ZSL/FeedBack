import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { URL } from 'url';
import { roomManager } from './roomManager';
import {
  CreatePollRequest,
  VoteSubmission,
  DanmakuSubmission,
  WebSocketMessage,
} from './types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3001;
const BROADCAST_DELAY_MS = 100;

app.use(cors());
app.use(express.json());

interface Client {
  ws: WebSocket;
  roomId: string;
  role: 'student' | 'teacher';
  lastBroadcast: number;
  messageQueue: WebSocketMessage[];
}

const clients = new Map<string, Client>();

function broadcastToRoom(roomId: string, message: WebSocketMessage): void {
  const now = Date.now();
  clients.forEach((client) => {
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      if (now - client.lastBroadcast >= BROADCAST_DELAY_MS) {
        client.ws.send(JSON.stringify(message));
        client.lastBroadcast = now;
      } else {
        client.messageQueue.push(message);
        if (!client.messageQueue.length) {
          const delay = BROADCAST_DELAY_MS - (now - client.lastBroadcast);
          setTimeout(() => flushMessageQueue(client), delay);
        }
      }
    }
  });
}

function flushMessageQueue(client: Client): void {
  if (client.messageQueue.length === 0 || client.ws.readyState !== WebSocket.OPEN) {
    client.messageQueue = [];
    return;
  }

  const messages = [...client.messageQueue];
  client.messageQueue = [];
  client.lastBroadcast = Date.now();

  messages.forEach(msg => {
    client.ws.send(JSON.stringify(msg));
  });
}

app.post('/api/rooms', (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const roomId = roomManager.createRoom();
    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Create room took ${elapsed}ms, exceeding 200ms target`);
    }
    res.json({ roomId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.post('/api/rooms/:roomId/join', (req: Request, res: Response) => {
  const startTime = Date.now();
  const { roomId } = req.params;
  try {
    const exists = roomManager.roomExists(roomId);
    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Join room took ${elapsed}ms, exceeding 200ms target`);
    }
    if (exists) {
      res.json({ exists: true });
    } else {
      res.status(404).json({ error: 'Room not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

app.post('/api/polls', (req: Request, res: Response) => {
  const startTime = Date.now();
  const { roomId, title, type, options }: CreatePollRequest = req.body;

  if (!roomId || !title || !type || !options || options.length < 2 || options.length > 6) {
    res.status(400).json({ error: 'Invalid poll data' });
    return;
  }

  try {
    const poll = roomManager.createPoll(roomId, title, type, options);
    if (!poll) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Create poll took ${elapsed}ms, exceeding 200ms target`);
    }

    broadcastToRoom(roomId, {
      type: 'poll_created',
      data: poll,
    });

    res.json(poll);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

app.post('/api/polls/vote', (req: Request, res: Response) => {
  const startTime = Date.now();
  const { roomId, pollId, optionIds, studentId }: VoteSubmission = req.body;

  if (!roomId || !pollId || !optionIds || optionIds.length === 0) {
    res.status(400).json({ error: 'Invalid vote data' });
    return;
  }

  try {
    const poll = roomManager.submitVote(roomId, pollId, optionIds, studentId);
    if (!poll) {
      res.status(404).json({ error: 'Room or poll not found' });
      return;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Submit vote took ${elapsed}ms, exceeding 200ms target`);
    }

    broadcastToRoom(roomId, {
      type: 'poll_updated',
      data: poll,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

app.post('/api/danmaku', (req: Request, res: Response) => {
  const startTime = Date.now();
  const { roomId, text }: DanmakuSubmission = req.body;

  if (!roomId || !text || text.trim().length === 0) {
    res.status(400).json({ error: 'Invalid danmaku data' });
    return;
  }

  try {
    const danmaku = roomManager.submitDanmaku(roomId, text.trim());
    if (!danmaku) {
      res.status(400).json({ error: 'Danmaku disabled or contains blocked words' });
      return;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Submit danmaku took ${elapsed}ms, exceeding 200ms target`);
    }

    broadcastToRoom(roomId, {
      type: 'danmaku_received',
      data: danmaku,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit danmaku' });
  }
});

app.put('/api/rooms/:roomId/danmaku', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Invalid enabled value' });
    return;
  }

  try {
    const success = roomManager.toggleDanmaku(roomId, enabled);
    if (!success) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    broadcastToRoom(roomId, {
      type: 'danmaku_toggled',
      data: { enabled },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle danmaku' });
  }
});

app.post('/api/rooms/:roomId/block-word', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { word } = req.body;

  if (!word || word.trim().length === 0) {
    res.status(400).json({ error: 'Invalid word' });
    return;
  }

  try {
    const success = roomManager.addBlockedWord(roomId, word.trim());
    if (!success) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    broadcastToRoom(roomId, {
      type: 'word_blocked',
      data: { word: word.trim() },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to block word' });
  }
});

app.delete('/api/rooms/:roomId/block-word', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { word } = req.body;

  if (!word || word.trim().length === 0) {
    res.status(400).json({ error: 'Invalid word' });
    return;
  }

  try {
    const success = roomManager.removeBlockedWord(roomId, word.trim());
    if (!success) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unblock word' });
  }
});

app.get('/api/rooms/:roomId/wordcloud', (req: Request, res: Response) => {
  const startTime = Date.now();
  const { roomId } = req.params;

  try {
    const wordCloudData = roomManager.getWordCloudData(roomId, 60000, 30);

    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Get word cloud took ${elapsed}ms, exceeding 200ms target`);
    }

    res.json(wordCloudData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get word cloud data' });
  }
});

app.get('/api/rooms/:roomId/state', (req: Request, res: Response) => {
  const { roomId } = req.params;

  try {
    const state = roomManager.getRoomState(roomId);
    if (!state) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get room state' });
  }
});

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket, request) => {
  const url = request.url ? new URL(request.url, 'http://localhost') : null;
  const roomId = url?.searchParams.get('roomId');
  const role = (url?.searchParams.get('role') as 'student' | 'teacher') || 'student';

  if (!roomId || !roomManager.roomExists(roomId)) {
    ws.close(4001, 'Invalid room ID');
    return;
  }

  const clientId = `${roomId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const client: Client = {
    ws,
    roomId,
    role,
    lastBroadcast: 0,
    messageQueue: [],
  };

  clients.set(clientId, client);

  const roomState = roomManager.getRoomState(roomId);
  if (roomState) {
    ws.send(JSON.stringify({
      type: 'room_state',
      data: roomState,
    } as WebSocketMessage));
  }

  ws.on('message', () => {
  });

  ws.on('close', () => {
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(clientId);
  });
});

setInterval(() => {
  roomManager.cleanupOldRooms();
}, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
