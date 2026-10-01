import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { roomManager } from './roomManager';
import type { ClientMessage, ServerMessage, User, ChatMessage } from '../shared/types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

interface WebSocketWithUser extends WebSocket {
  userId?: string;
  roomId?: string;
}

const userConnections = new Map<string, WebSocketWithUser>();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: '房间不存在' });
    return;
  }
  res.json({
    id: room.id,
    status: room.status,
    users: room.users.map(u => ({ id: u.id, name: u.name, avatar: u.avatar })),
  });
});

wss.on('connection', (ws: WebSocketWithUser) => {
  ws.on('message', (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (error) {
      console.error('消息解析错误:', error);
      sendError(ws, '无效的消息格式');
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
  });
});

function handleMessage(ws: WebSocketWithUser, message: ClientMessage): void {
  switch (message.type) {
    case 'JOIN_ROOM':
      handleJoinRoom(ws, message.payload);
      break;
    case 'LEAVE_ROOM':
      handleLeaveRoom(ws, message.payload);
      break;
    case 'START_GAME':
      handleStartGame(ws, message.payload);
      break;
    case 'SUBMIT_ANSWER':
      handleSubmitAnswer(ws, message.payload);
      break;
    case 'SEND_MESSAGE':
      handleSendMessage(ws, message.payload);
      break;
    case 'SEND_INVITE':
      handleSendInvite(ws, message.payload);
      break;
    case 'RESPOND_INVITE':
      handleRespondInvite(ws, message.payload);
      break;
    default:
      sendError(ws, '未知的消息类型');
  }
}

function handleJoinRoom(
  ws: WebSocketWithUser,
  payload: { roomId: string; userName: string; avatar: string }
): void {
  const { roomId, userName, avatar } = payload;

  if (!roomId || !userName || !avatar) {
    sendError(ws, '缺少必要参数');
    return;
  }

  const room = roomManager.getOrCreateRoom(roomId);

  if (room.status === 'playing') {
    sendError(ws, '游戏已开始，无法加入');
    return;
  }

  const user = room.addUser({
    name: userName,
    avatar,
    roomId,
    ws,
  });

  ws.userId = user.id;
  ws.roomId = roomId;
  userConnections.set(user.id, ws);

  const usersWithoutWs = room.users.map(u => {
    const { ws, ...userData } = u;
    void ws;
    return userData;
  });

  sendToUser(ws, {
    type: 'ROOM_JOINED',
    payload: { roomId, users: usersWithoutWs },
  });

  const { ws: userWs, ...newUserWithoutWs } = user;
  void userWs;
  room.broadcast({
    type: 'USER_JOINED',
    payload: { user: newUserWithoutWs as User },
  });
}

function handleLeaveRoom(
  ws: WebSocketWithUser,
  payload: { roomId: string }
): void {
  const { roomId } = payload;
  const userId = ws.userId;

  if (!userId || !roomId) return;

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  room.removeUser(userId);
  userConnections.delete(userId);

  ws.userId = undefined;
  ws.roomId = undefined;

  room.broadcast({
    type: 'USER_LEFT',
    payload: { userId },
  });

  if (room.users.length === 0) {
    roomManager.deleteRoom(roomId);
  }
}

function handleStartGame(
  ws: WebSocketWithUser,
  payload: { roomId: string }
): void {
  const { roomId } = payload;
  const userId = ws.userId;

  if (!userId || !roomId) {
    sendError(ws, '缺少必要参数');
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendError(ws, '房间不存在');
    return;
  }

  try {
    room.startGame();
  } catch (error) {
    sendError(ws, error instanceof Error ? error.message : '开始游戏失败');
  }
}

function handleSubmitAnswer(
  ws: WebSocketWithUser,
  payload: { roomId: string; questionIndex: number; answer: number; timeSpent: number }
): void {
  const { roomId, questionIndex, answer, timeSpent } = payload;
  const userId = ws.userId;

  if (!userId || !roomId) return;

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  room.submitAnswer(userId, questionIndex, answer, timeSpent);
}

function handleSendMessage(
  ws: WebSocketWithUser,
  payload: { roomId: string; targetUserId: string; content: string }
): void {
  const { roomId, targetUserId, content } = payload;
  const userId = ws.userId;

  if (!userId || !roomId || !targetUserId || !content) {
    sendError(ws, '缺少必要参数');
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const sender = room.getUser(userId);
  if (!sender) return;

  const targetWs = userConnections.get(targetUserId);
  if (!targetWs) {
    sendError(ws, '目标用户不在线');
    return;
  }

  const message: ChatMessage = {
    id: uuidv4(),
    senderId: userId,
    senderName: sender.name,
    content,
    timestamp: Date.now(),
  };

  sendToUser(targetWs, {
    type: 'NEW_MESSAGE',
    payload: { message },
  });

  sendToUser(ws, {
    type: 'NEW_MESSAGE',
    payload: { message },
  });
}

function handleSendInvite(
  ws: WebSocketWithUser,
  payload: { roomId: string; targetUserId: string }
): void {
  const { roomId, targetUserId } = payload;
  const userId = ws.userId;

  if (!userId || !roomId || !targetUserId) {
    sendError(ws, '缺少必要参数');
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const inviter = room.getUser(userId);
  if (!inviter) return;

  const targetWs = userConnections.get(targetUserId);
  if (!targetWs) {
    sendError(ws, '目标用户不在线');
    return;
  }

  const { ws: inviterWs, ...inviterWithoutWs } = inviter;
  void inviterWs;
  sendToUser(targetWs, {
    type: 'CHAT_INVITE',
    payload: { inviter: inviterWithoutWs as User, roomId },
  });
}

function handleRespondInvite(
  ws: WebSocketWithUser,
  payload: { roomId: string; inviterId: string; accepted: boolean }
): void {
  const { roomId, inviterId, accepted } = payload;
  const userId = ws.userId;

  if (!userId || !roomId || !inviterId) {
    sendError(ws, '缺少必要参数');
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const responder = room.getUser(userId);
  if (!responder) return;

  const inviterWs = userConnections.get(inviterId);
  if (!inviterWs) {
    sendError(ws, '邀请者不在线');
    return;
  }

  const { ws: responderWs, ...responderWithoutWs } = responder;
  void responderWs;
  sendToUser(inviterWs, {
    type: 'INVITE_RESPONSE',
    payload: { accepted, chatPartner: responderWithoutWs as User },
  });
}

function handleDisconnect(ws: WebSocketWithUser): void {
  const userId = ws.userId;
  const roomId = ws.roomId;

  if (userId && roomId) {
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.removeUser(userId);
      room.broadcast({
        type: 'USER_LEFT',
        payload: { userId },
      });

      if (room.users.length === 0) {
        roomManager.deleteRoom(roomId);
      }
    }
  }

  if (userId) {
    userConnections.delete(userId);
  }
}

function sendToUser(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, message: string): void {
  sendToUser(ws, { type: 'ERROR', payload: { message } });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`WebSocket 服务器已启动`);
});
