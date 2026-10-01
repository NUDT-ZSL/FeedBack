import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const USER_COLORS = [
  '#e53935', '#fb8c00', '#fdd835', '#43a047',
  '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'
];
const MAX_USERS_PER_ROOM = 8;
const MAX_LEVEL = 5;

interface MindMapNode {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  level: number;
  color: string;
  textColor: string;
  lastModifiedBy: string;
  lastModifiedByName: string;
  lastModifiedAt: number;
  isNew?: boolean;
  fromAngle?: number;
}

interface User {
  id: string;
  name: string;
  color: string;
  cursorX: number;
  cursorY: number;
  selectedNodeId: string | null;
  ws: WebSocket;
}

interface Room {
  id: string;
  nodes: Map<string, MindMapNode>;
  users: Map<string, User>;
  usedColors: Set<string>;
}

type WSMessage =
  | { type: 'join_room'; roomId: string; userName: string }
  | { type: 'cursor_update'; x: number; y: number }
  | { type: 'node_select'; nodeId: string | null }
  | { type: 'node_add'; parentId: string; angle: number }
  | { type: 'node_update'; node: Partial<MindMapNode> & { id: string } }
  | { type: 'node_delete'; nodeId: string }
  | { type: 'node_move'; nodeId: string; x: number; y: number }
  | { type: 'node_text_edit'; nodeId: string; text: string };

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      nodes: new Map(),
      users: new Map(),
      usedColors: new Set()
    };
    const rootNode: MindMapNode = {
      id: uuidv4(),
      parentId: null,
      text: '主题',
      x: 0,
      y: 0,
      level: 0,
      color: '#1565c0',
      textColor: '#ffffff',
      lastModifiedBy: 'system',
      lastModifiedByName: '系统',
      lastModifiedAt: Date.now()
    };
    room.nodes.set(rootNode.id, rootNode);
    rooms.set(roomId, room);
  }
  return room;
}

function assignColor(room: Room): string {
  for (const color of USER_COLORS) {
    if (!room.usedColors.has(color)) {
      room.usedColors.add(color);
      return color;
    }
  }
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

function broadcast(room: Room, message: object, excludeUserId?: string) {
  const data = JSON.stringify(message);
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

function sendToUser(user: User, message: object) {
  if (user.ws.readyState === WebSocket.OPEN) {
    user.ws.send(JSON.stringify(message));
  }
}

function collectDescendantIds(room: Room, nodeId: string): string[] {
  const ids: string[] = [];
  const stack = [nodeId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    ids.push(currentId);
    for (const [id, node] of room.nodes) {
      if (node.parentId === currentId) {
        stack.push(id);
      }
    }
  }
  return ids;
}

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let currentRoom: Room | null = null;
  let currentUser: User | null = null;

  ws.on('message', (raw) => {
    try {
      const data = raw.toString();
      const msg: WSMessage = JSON.parse(data);

      if (msg.type === 'join_room') {
        const roomId = msg.roomId || 'default';
        const userName = msg.userName || `用户${Math.floor(Math.random() * 1000)}`;

        const room = getOrCreateRoom(roomId);

        if (room.users.size >= MAX_USERS_PER_ROOM) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: '房间已满，最多支持8人同时在线'
            }));
          }
          ws.close();
          return;
        }

        const userId = uuidv4();
        const color = assignColor(room);

        const user: User = {
          id: userId,
          name: userName,
          color,
          cursorX: 0,
          cursorY: 0,
          selectedNodeId: null,
          ws
        };

        room.users.set(userId, user);
        currentRoom = room;
        currentUser = user;

        const publicUsers = Array.from(room.users.values()).map(u => ({
          id: u.id, name: u.name, color: u.color,
          cursorX: u.cursorX, cursorY: u.cursorY, selectedNodeId: u.selectedNodeId
        }));
        const publicNodes = Array.from(room.nodes.values()).map(n => {
          const { isNew, fromAngle, ...rest } = n;
          return rest;
        });

        sendToUser(user, {
          type: 'room_joined',
          roomId,
          userId,
          userColor: color,
          userName,
          nodes: publicNodes,
          users: publicUsers
        });

        broadcast(room, {
          type: 'user_joined',
          user: { id: user.id, name: user.name, color: user.color, cursorX: 0, cursorY: 0, selectedNodeId: null }
        }, userId);
        return;
      }

      if (!currentRoom || !currentUser) return;

      if (msg.type === 'cursor_update') {
        currentUser.cursorX = msg.x;
        currentUser.cursorY = msg.y;
        broadcast(currentRoom, {
          type: 'cursor_update',
          userId: currentUser.id,
          x: msg.x,
          y: msg.y
        }, currentUser.id);
      }

      else if (msg.type === 'node_select') {
        currentUser.selectedNodeId = msg.nodeId;
        broadcast(currentRoom, {
          type: 'node_select',
          userId: currentUser.id,
          nodeId: msg.nodeId
        }, currentUser.id);
      }

      else if (msg.type === 'node_add') {
        const parent = currentRoom.nodes.get(msg.parentId);
        if (!parent) return;
        if (parent.level >= MAX_LEVEL) {
          sendToUser(currentUser, { type: 'error', message: '最多支持展开5层' });
          return;
        }

        const siblingCount = Array.from(currentRoom.nodes.values()).filter(n => n.parentId === msg.parentId).length;
        const angle = msg.angle !== undefined ? msg.angle : (siblingCount % 4) * 90;
        const rad = (angle * Math.PI) / 180;
        const distance = 200;
        const offsetX = Math.cos(rad) * distance;
        const offsetY = Math.sin(rad) * distance;

        const newNode: MindMapNode = {
          id: uuidv4(),
          parentId: msg.parentId,
          text: '新节点',
          x: parent.x + offsetX,
          y: parent.y + offsetY,
          level: parent.level + 1,
          color: '#c0ca33',
          textColor: '#263238',
          lastModifiedBy: currentUser.id,
          lastModifiedByName: currentUser.name,
          lastModifiedAt: Date.now(),
          isNew: true,
          fromAngle: angle
        };

        currentRoom.nodes.set(newNode.id, newNode);

        const { isNew, fromAngle, ...publicNode } = newNode;
        broadcast(currentRoom, {
          type: 'node_add',
          node: publicNode,
          fromAngle: angle
        });
      }

      else if (msg.type === 'node_update') {
        const node = currentRoom.nodes.get(msg.node.id);
        if (!node) return;

        Object.assign(node, msg.node, {
          lastModifiedBy: currentUser!.id,
          lastModifiedByName: currentUser!.name,
          lastModifiedAt: Date.now()
        });

        broadcast(currentRoom, {
          type: 'node_update',
          node: {
            id: node.id,
            color: node.color,
            textColor: node.textColor,
            lastModifiedBy: node.lastModifiedBy,
            lastModifiedByName: node.lastModifiedByName,
            lastModifiedAt: node.lastModifiedAt
          }
        });
      }

      else if (msg.type === 'node_delete') {
        const node = currentRoom.nodes.get(msg.nodeId);
        if (!node || node.parentId === null) return;

        const idsToDelete = collectDescendantIds(currentRoom, msg.nodeId);
        for (const id of idsToDelete) {
          currentRoom.nodes.delete(id);
        }

        broadcast(currentRoom, {
          type: 'node_delete',
          nodeIds: idsToDelete
        });
      }

      else if (msg.type === 'node_move') {
        const node = currentRoom.nodes.get(msg.nodeId);
        if (!node) return;

        node.x = msg.x;
        node.y = msg.y;
        node.lastModifiedBy = currentUser.id;
        node.lastModifiedByName = currentUser.name;
        node.lastModifiedAt = Date.now();

        broadcast(currentRoom, {
          type: 'node_move',
          nodeId: msg.nodeId,
          x: msg.x,
          y: msg.y,
          lastModifiedBy: currentUser.id,
          lastModifiedByName: currentUser.name,
          lastModifiedAt: node.lastModifiedAt
        }, currentUser.id);
      }

      else if (msg.type === 'node_text_edit') {
        const node = currentRoom.nodes.get(msg.nodeId);
        if (!node) return;

        node.text = msg.text;
        node.lastModifiedBy = currentUser.id;
        node.lastModifiedByName = currentUser.name;
        node.lastModifiedAt = Date.now();

        broadcast(currentRoom, {
          type: 'node_text_edit',
          nodeId: msg.nodeId,
          text: msg.text,
          lastModifiedBy: currentUser.id,
          lastModifiedByName: currentUser.name,
          lastModifiedAt: node.lastModifiedAt
        }, currentUser.id);
      }

    } catch (err) {
      console.error('消息处理错误:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentUser) {
      currentRoom.users.delete(currentUser.id);
      currentRoom.usedColors.delete(currentUser.color);

      broadcast(currentRoom, {
        type: 'user_left',
        userId: currentUser.id
      });

      if (currentRoom.users.size === 0) {
        setTimeout(() => {
          if (currentRoom && currentRoom.users.size === 0) {
            rooms.delete(currentRoom.id);
          }
        }, 60000);
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`MindMeld 服务器运行在 http://localhost:${PORT}`);
});
