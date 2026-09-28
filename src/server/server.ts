import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { PlantManager } from './plantManager';
import { NotificationManager } from './notificationManager';
import type {
  User,
  Plant,
  PlantSpecies,
  Notification,
  LeaderboardEntry,
  WSMessage,
} from './types';
import { calculateGrowthStage, calculateProgress } from './types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users: Map<string, User> = new Map();
const plantManager = new PlantManager();
const notificationManager = new NotificationManager();

const avatarOptions = ['👨', '👩', '🧑', '👴', '👵', '🧔', '👱', '👸'];

function createUser(username: string, password: string, avatarIndex: number): User {
  return {
    id: uuidv4(),
    username,
    password,
    avatar: avatarOptions[avatarIndex % avatarOptions.length],
    friends: [],
  };
}

const user1 = createUser('小明', '123456', 0);
const user2 = createUser('小红', '123456', 1);
const user3 = createUser('园丁', '123456', 2);

user1.friends = [user2.id, user3.id];
user2.friends = [user1.id, user3.id];
user3.friends = [user1.id, user2.id];

users.set(user1.id, user1);
users.set(user2.id, user2);
users.set(user3.id, user3);

plantManager.setUsers(users);
notificationManager.setUsers(users);

function createExamplePlants(userId: string, baseTime: number): void {
  const species: PlantSpecies[] = ['cactus', 'sunflower', 'succulent'];
  const names = {
    cactus: ['小刺刺', '仙人球', '仙人掌宝宝'],
    sunflower: ['向日葵', '小太阳', '阳光花'],
    succulent: ['肉肉', '多肉宝贝', '小肉肉'],
  };

  for (let i = 0; i < 3; i++) {
    const speciesType = species[i];
    const plantName = names[speciesType][i];
    const plant = plantManager.createPlant(userId, speciesType, plantName);
    const adjustedTime = baseTime - i * 5 * 60 * 1000;
    plant.createdAt = adjustedTime;
    plant.progress = calculateProgress(adjustedTime, baseTime);
    plant.stage = calculateGrowthStage(adjustedTime, baseTime);
  }
}

const now = Date.now();
createExamplePlants(user1.id, now);
createExamplePlants(user2.id, now - 3 * 60 * 1000);
createExamplePlants(user3.id, now - 6 * 60 * 1000);

plantManager.calculateGrowth();

app.use(cors());
app.use(express.json());

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  for (const user of users.values()) {
    if (user.username === username) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
  }

  const newUser: User = {
    id: uuidv4(),
    username,
    password,
    avatar: avatarOptions[Math.floor(Math.random() * avatarOptions.length)],
    friends: [],
  };

  users.set(newUser.id, newUser);
  plantManager.setUsers(users);
  notificationManager.setUsers(users);

  res.json({ success: true, user: { id: newUser.id, username: newUser.username, avatar: newUser.avatar } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  for (const user of users.values()) {
    if (user.username === username && user.password === password) {
      return res.json({
        success: true,
        user: { id: user.id, username: user.username, avatar: user.avatar, friends: user.friends },
      });
    }
  }

  res.status(401).json({ success: false, message: '用户名或密码错误' });
});

app.get('/api/user/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }
  res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar, friends: user.friends } });
});

app.get('/api/search-users', (req, res) => {
  const query = (req.query.q as string)?.toLowerCase();
  if (!query) {
    return res.json({ success: true, users: [] });
  }

  const result: Array<{ id: string; username: string; avatar: string }> = [];
  for (const user of users.values()) {
    if (user.username.toLowerCase().includes(query)) {
      result.push({ id: user.id, username: user.username, avatar: user.avatar });
    }
  }

  res.json({ success: true, users: result });
});

app.post('/api/friends/:userId/:friendId', (req, res) => {
  const { userId, friendId } = req.params;
  const user = users.get(userId);
  const friend = users.get(friendId);

  if (!user || !friend) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  if (userId === friendId) {
    return res.status(400).json({ success: false, message: '不能添加自己为好友' });
  }

  if (!user.friends.includes(friendId)) {
    user.friends.push(friendId);
  }
  if (!friend.friends.includes(userId)) {
    friend.friends.push(userId);
  }

  const notification = notificationManager.createNotification(
    friendId,
    'friend',
    `${user.username} 加你为好友了！`,
    userId
  );
  notificationManager.sendNotification(friendId, notification);

  res.json({ success: true, message: '添加好友成功' });
});

app.get('/api/friends/:userId', (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const friends: Array<{ id: string; username: string; avatar: string }> = [];
  for (const friendId of user.friends) {
    const friend = users.get(friendId);
    if (friend) {
      friends.push({ id: friend.id, username: friend.username, avatar: friend.avatar });
    }
  }

  res.json({ success: true, friends });
});

app.post('/api/plants', (req, res) => {
  const { ownerId, species, name } = req.body;
  if (!ownerId || !species || !name) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  const plant = plantManager.createPlant(ownerId, species, name);
  const plants = plantManager.getPlantsByUser(ownerId);
  notificationManager.broadcastPlantsUpdate(ownerId, plants);

  res.json({ success: true, plant });
});

app.get('/api/plants/:userId', (req, res) => {
  const plants = plantManager.getPlantsByUser(req.params.userId);
  res.json({ success: true, plants });
});

app.get('/api/plants/detail/:plantId', (req, res) => {
  const plant = plantManager.getPlant(req.params.plantId);
  if (!plant) {
    return res.status(404).json({ success: false, message: '植物不存在' });
  }
  res.json({ success: true, plant });
});

app.post('/api/plants/water/:plantId/:userId', (req, res) => {
  const { plantId, userId } = req.params;
  const result = plantManager.waterPlant(plantId, userId);

  if (!result.success) {
    return res.status(400).json(result);
  }

  if (result.updatedPlant) {
    const plants = plantManager.getPlantsByUser(result.updatedPlant.ownerId);
    notificationManager.broadcastPlantsUpdate(result.updatedPlant.ownerId, plants);

    if (result.updatedPlant.ownerId !== userId) {
      const notification = notificationManager.createNotification(
        result.updatedPlant.ownerId,
        'water',
        `你的植物「${result.updatedPlant.name}」被好友浇水了！`,
        userId,
        plantId
      );
      notificationManager.sendNotification(result.updatedPlant.ownerId, notification);
    }
  }

  res.json(result);
});

app.post('/api/plants/fertilize/:plantId/:userId', (req, res) => {
  const { plantId, userId } = req.params;
  const result = plantManager.fertilizePlant(plantId, userId);

  if (!result.success) {
    return res.status(400).json(result);
  }

  if (result.updatedPlant) {
    const plants = plantManager.getPlantsByUser(result.updatedPlant.ownerId);
    notificationManager.broadcastPlantsUpdate(result.updatedPlant.ownerId, plants);

    if (result.updatedPlant.ownerId !== userId) {
      const notification = notificationManager.createNotification(
        result.updatedPlant.ownerId,
        'fertilize',
        `你的植物「${result.updatedPlant.name}」被好友施肥了！`,
        userId,
        plantId
      );
      notificationManager.sendNotification(result.updatedPlant.ownerId, notification);
    }
  }

  res.json(result);
});

app.post('/api/plants/light/:plantId/:userId', (req, res) => {
  const { plantId, userId } = req.params;
  const result = plantManager.adjustLight(plantId, userId);

  if (!result.success) {
    return res.status(400).json(result);
  }

  if (result.updatedPlant) {
    const plants = plantManager.getPlantsByUser(result.updatedPlant.ownerId);
    notificationManager.broadcastPlantsUpdate(result.updatedPlant.ownerId, plants);
  }

  res.json(result);
});

app.get('/api/diary/:plantId', (req, res) => {
  const diary = plantManager.getDiary(req.params.plantId);
  res.json({ success: true, diary });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = plantManager.getLeaderboard();
  res.json({ success: true, leaderboard });
});

wss.on('connection', (ws: WebSocket) => {
  let currentUserId: string | null = null;

  ws.on('message', (data: string) => {
    try {
      const message: WSMessage = JSON.parse(data);

      if (message.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        return;
      }

      if (message.type === 'subscribe' && message.userId && message.targetUserId) {
        currentUserId = message.userId;
        notificationManager.addConnection(message.userId, ws);
        notificationManager.subscribe(message.userId, message.targetUserId);

        const plants = plantManager.getPlantsByUser(message.targetUserId);
        ws.send(JSON.stringify({
          type: 'plants_update',
          targetUserId: message.targetUserId,
          payload: plants,
        }));

        const leaderboard = plantManager.getLeaderboard();
        ws.send(JSON.stringify({
          type: 'leaderboard',
          payload: leaderboard,
        }));

        const notifications = notificationManager.getNotifications(message.userId);
        ws.send(JSON.stringify({
          type: 'notification',
          payload: notifications,
        }));
      }

      if (message.type === 'unsubscribe' && message.userId && message.targetUserId) {
        notificationManager.unsubscribe(message.userId, message.targetUserId);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    if (currentUserId) {
      notificationManager.removeConnection(currentUserId, ws);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

setInterval(() => {
  const stageChanges = plantManager.calculateGrowth();

  const updatedUsers = new Set<string>();
  for (const change of stageChanges) {
    updatedUsers.add(change.plant.ownerId);

    const notification = notificationManager.createNotification(
      change.plant.ownerId,
      'stage',
      `你的植物「${change.plant.name}」成长到了新的阶段！`,
      change.plant.ownerId,
      change.plant.id
    );
    notificationManager.sendNotification(change.plant.ownerId, notification);
  }

  for (const userId of updatedUsers) {
    const plants = plantManager.getPlantsByUser(userId);
    notificationManager.broadcastPlantsUpdate(userId, plants);
  }

  const leaderboard = plantManager.getLeaderboard();
  notificationManager.broadcastLeaderboard(leaderboard);
}, 5 * 60 * 1000);

setInterval(() => {
  const leaderboard = plantManager.getLeaderboard();
  notificationManager.broadcastLeaderboard(leaderboard);
}, 30 * 1000);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Example users:`);
  for (const user of users.values()) {
    console.log(`  ${user.username} (${user.id}) - password: 123456`);
  }
});
