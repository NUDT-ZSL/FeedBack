import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import db, { Document } from './db';
import {
  TextOperation,
  VersionVector,
  ChangeMessage,
  ChangeAckMessage,
  CursorMessage,
  JoinMessage,
  LeaveMessage,
  UserListMessage,
  SyncMessage,
  ErrorMessage,
  WSMessage,
  transformOperation,
  applyOperation,
  compareVersions,
  generateOpId,
} from '../../shared/protocol';

const JWT_SECRET = process.env.JWT_SECRET || 'auto4-secret-key-change-in-production';
const AUTO_SAVE_INTERVAL_MS = 30_000;
const MAX_HISTORY_SIZE = 100;

export interface ClientSocket extends WebSocket {
  userId?: string;
  username?: string;
  documentId?: string;
  color?: string;
}

interface RoomState {
  clients: Set<ClientSocket>;
  cursors: Map<string, { userName: string; color: string; cursor: { line: number; column: number }; selection: { start: number; end: number } | null }>;
  currentContent: string;
  version: number;
  vector: VersionVector;
  history: TextOperation[];
  pendingOps: Map<string, TextOperation>;
  appliedOpIds: Set<string>;
  lastSavedVersion: number;
}

const rooms = new Map<string, RoomState>();

function authenticateRequest(req: IncomingMessage): { userId: string; username: string } | null {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const tokenFromQuery = url.searchParams.get('token');
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = tokenFromQuery || tokenFromHeader;

    if (!token) return null;

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}

function send(ws: ClientSocket, message: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastToRoom(
  documentId: string,
  message: WSMessage,
  excludeWs?: ClientSocket,
): void {
  const room = rooms.get(documentId);
  if (!room) return;

  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

async function getOrCreateRoom(documentId: string): Promise<RoomState> {
  let room = rooms.get(documentId);
  if (!room) {
    await db.read();
    const doc = db.data!.documents.find((d) => d.id === documentId);

    room = {
      clients: new Set(),
      cursors: new Map(),
      currentContent: doc?.content || '',
      version: doc?.version || 0,
      vector: {},
      history: [],
      pendingOps: new Map(),
      appliedOpIds: new Set(),
      lastSavedVersion: doc?.version || 0,
    };
    rooms.set(documentId, room);
  }
  return room;
}

function isOperationDuplicate(room: RoomState, opId: string): boolean {
  if (room.appliedOpIds.has(opId)) return true;
  if (room.pendingOps.has(opId)) return true;
  return room.history.some((h) => h.id === opId);
}

function transformAgainstHistory(
  op: TextOperation,
  history: TextOperation[],
  fromVersion: number,
  toVersion: number,
): TextOperation | null {
  let transformed: TextOperation | null = op;
  const startIdx = Math.max(0, history.length - (toVersion - fromVersion));

  for (let i = startIdx; i < history.length; i++) {
    if (!transformed) break;
    const appliedOp = history[i];
    if (appliedOp.id === transformed.id) continue;
    transformed = transformOperation(transformed, appliedOp);
  }

  return transformed;
}

async function saveRoomToDatabase(documentId: string): Promise<Document | null> {
  const room = rooms.get(documentId);
  if (!room) return null;

  await db.read();
  const doc = db.data!.documents.find((d) => d.id === documentId);
  if (!doc) return null;

  if (room.version === room.lastSavedVersion) return doc;

  doc.content = room.currentContent;
  doc.version = room.version;
  doc.updatedAt = new Date().toISOString();
  doc.history.push({
    version: room.version,
    content: room.currentContent,
    timestamp: new Date().toISOString(),
  });

  room.lastSavedVersion = room.version;

  await db.write();

  const syncMessage: SyncMessage = {
    type: 'sync',
    documentId,
    content: room.currentContent,
    version: room.version,
    vector: { ...room.vector },
    reason: 'save',
  };
  broadcastToRoom(documentId, syncMessage);

  return doc;
}

function sendSync(ws: ClientSocket, room: RoomState, documentId: string, reason: 'init' | 'reset' | 'save'): void {
  const syncMessage: SyncMessage = {
    type: 'sync',
    documentId,
    content: room.currentContent,
    version: room.version,
    vector: { ...room.vector },
    reason,
  };
  send(ws, syncMessage);
}

function sendUserList(room: RoomState, documentId: string): void {
  const users = Array.from(room.clients)
    .filter((c) => c.userId)
    .map((c) => ({
      userId: c.userId!,
      userName: c.username || '未知用户',
      color: c.color || generateUserColor(c.userId!),
      cursor: room.cursors.get(c.userId!)?.cursor,
    }));

  const userListMessage: UserListMessage = {
    type: 'user-list',
    documentId,
    users,
  };
  broadcastToRoom(documentId, userListMessage);
}

function handleJoin(ws: ClientSocket, message: JoinMessage): void {
  if (!ws.userId) return;

  const { documentId, userId, userName, color } = message;
  ws.documentId = documentId;
  ws.color = color || generateUserColor(userId);

  getOrCreateRoom(documentId).then((room) => {
    room.clients.add(ws);

    sendSync(ws, room, documentId, 'init');
    sendUserList(room, documentId);
  }).catch((err) => {
    console.error('加入房间失败:', err);
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 500,
      message: '加入房间失败',
    };
    send(ws, errorMsg);
  });
}

function handleLeave(ws: ClientSocket): void {
  if (!ws.documentId || !ws.userId) return;

  const room = rooms.get(ws.documentId);
  if (!room) return;

  room.clients.delete(ws);
  room.cursors.delete(ws.userId);

  if (room.clients.size === 0) {
    saveRoomToDatabase(ws.documentId).finally(() => {
      rooms.delete(ws.documentId!);
    });
  } else {
    sendUserList(room, ws.documentId);
  }

  ws.documentId = undefined;
}

function handleChange(ws: ClientSocket, message: ChangeMessage): void {
  if (!ws.documentId || !ws.userId) return;

  const { documentId, operation, currentVersion, vector: clientVector } = message;
  const room = rooms.get(documentId);
  if (!room) return;

  if (isOperationDuplicate(room, operation.id)) {
    const ack: ChangeAckMessage = {
      type: 'change-ack',
      documentId,
      operationId: operation.id,
      newVersion: room.version,
      applied: true,
    };
    send(ws, ack);
    return;
  }

  if (currentVersion < room.version) {
    sendSync(ws, room, documentId, 'reset');
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 409,
      message: '版本落后，请重置后重试',
      operationId: operation.id,
    };
    send(ws, errorMsg);
    return;
  }

  if (currentVersion > room.version) {
    sendSync(ws, room, documentId, 'reset');
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 400,
      message: '客户端版本高于服务端，请重置',
      operationId: operation.id,
    };
    send(ws, errorMsg);
    return;
  }

  const vectorCompare = compareVersions(clientVector, room.vector);
  if (vectorCompare < 0) {
    sendSync(ws, room, documentId, 'reset');
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 409,
      message: '版本向量落后，请重置后重试',
      operationId: operation.id,
    };
    send(ws, errorMsg);
    return;
  }

  room.pendingOps.set(operation.id, operation);

  let transformedOp: TextOperation | null = operation;
  const otherPendingOps = Array.from(room.pendingOps.values()).filter(op => op.id !== operation.id);
  for (const pendingOp of otherPendingOps) {
    if (!transformedOp) break;
    transformedOp = transformOperation(transformedOp, pendingOp);
  }

  if (!transformedOp) {
    room.pendingOps.delete(operation.id);
    const ack: ChangeAckMessage = {
      type: 'change-ack',
      documentId,
      operationId: operation.id,
      newVersion: room.version,
      applied: false,
    };
    send(ws, ack);
    return;
  }

  try {
    const newContent = applyOperation(room.currentContent, transformedOp);
    room.currentContent = newContent;
    room.version += 1;
    room.vector[transformedOp.userId] = (room.vector[transformedOp.userId] || 0) + 1;
    room.history.push(transformedOp);
    if (room.history.length > MAX_HISTORY_SIZE) {
      room.history.shift();
    }
    room.appliedOpIds.add(transformedOp.id);
    room.pendingOps.delete(operation.id);

    const ack: ChangeAckMessage = {
      type: 'change-ack',
      documentId,
      operationId: operation.id,
      newVersion: room.version,
      applied: true,
    };
    send(ws, ack);

    const broadcastMsg: ChangeMessage = {
      type: 'change',
      documentId,
      operation: transformedOp,
      currentVersion: room.version,
      vector: { ...room.vector },
    };
    broadcastToRoom(documentId, broadcastMsg, ws);
  } catch (err) {
    console.error('应用操作失败:', err);
    room.pendingOps.delete(operation.id);
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 500,
      message: '应用操作失败',
      operationId: operation.id,
    };
    send(ws, errorMsg);
  }
}

function handleCursor(ws: ClientSocket, message: CursorMessage): void {
  if (!ws.documentId || !ws.userId) return;

  const { documentId, cursor, selection } = message;
  const room = rooms.get(documentId);
  if (!room) return;

  room.cursors.set(ws.userId, {
    userName: ws.username || '未知用户',
    color: ws.color || generateUserColor(ws.userId),
    cursor,
    selection,
  });

  const broadcastMsg: CursorMessage = {
    ...message,
    userId: ws.userId,
    userName: ws.username || '未知用户',
    color: ws.color || generateUserColor(ws.userId),
  };
  broadcastToRoom(documentId, broadcastMsg, ws);
}

async function handleSave(ws: ClientSocket): Promise<void> {
  if (!ws.documentId) return;

  try {
    const doc = await saveRoomToDatabase(ws.documentId);
    if (doc) {
      const room = rooms.get(ws.documentId);
      if (room) {
        sendSync(ws, room, ws.documentId, 'save');
      }
    } else {
      const errorMsg: ErrorMessage = {
        type: 'error',
        code: 404,
        message: '文档不存在',
      };
      send(ws, errorMsg);
    }
  } catch (err) {
    console.error('保存失败:', err);
    const errorMsg: ErrorMessage = {
      type: 'error',
      code: 500,
      message: '保存失败',
    };
    send(ws, errorMsg);
  }
}

export function setupWebSocketServer(wss: WebSocketServer): void {
  const autoSaveTimer = setInterval(() => {
    const documentIds = Array.from(rooms.keys());
    for (const docId of documentIds) {
      saveRoomToDatabase(docId).catch((err) => {
        console.error(`自动保存文档 ${docId} 失败:`, err);
      });
    }
  }, AUTO_SAVE_INTERVAL_MS);

  wss.on('connection', (ws: ClientSocket, req: IncomingMessage) => {
    const auth = authenticateRequest(req);
    if (!auth) {
      const errorMsg: ErrorMessage = {
        type: 'error',
        code: 401,
        message: '未授权的连接，请提供有效 Token',
      };
      send(ws, errorMsg);
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.userId = auth.userId;
    ws.username = auth.username;

    ws.on('message', async (rawData) => {
      try {
        const message: WSMessage = JSON.parse(rawData.toString());

        switch (message.type) {
          case 'join':
            handleJoin(ws, message as JoinMessage);
            break;
          case 'leave':
            handleLeave(ws);
            break;
          case 'change':
            handleChange(ws, message as ChangeMessage);
            break;
          case 'cursor':
            handleCursor(ws, message as CursorMessage);
            break;
          case 'sync':
            if (ws.documentId) {
              const room = rooms.get(ws.documentId);
              if (room) {
                sendSync(ws, room, ws.documentId, 'init');
              }
            }
            break;
          case 'error':
            console.error('收到客户端错误:', message);
            break;
          default:
            const errorMsg: ErrorMessage = {
              type: 'error',
              code: 400,
              message: `未知的消息类型: ${(message as WSMessage).type}`,
            };
            send(ws, errorMsg);
        }
      } catch (err) {
        console.error('消息处理失败:', err);
        const errorMsg: ErrorMessage = {
          type: 'error',
          code: 400,
          message: '消息格式错误',
        };
        send(ws, errorMsg);
      }
    });

    ws.on('close', () => {
      handleLeave(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket 错误:', err);
      handleLeave(ws);
    });
  });

  wss.on('close', () => {
    clearInterval(autoSaveTimer);
    const savePromises = Array.from(rooms.keys()).map((docId) => saveRoomToDatabase(docId));
    Promise.all(savePromises).catch((err) => {
      console.error('服务器关闭时保存失败:', err);
    });
  });
}

export default setupWebSocketServer;
