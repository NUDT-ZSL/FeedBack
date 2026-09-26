import express from 'express';
import cors from 'cors';
import { v4 as generateId } from 'uuid';
import type { User, Pet, Item, Application, Notification, Comment } from './types.ts';

const app = express();
app.use(cors());
app.use(express.json());

const users: User[] = [
  {
    id: 'u1',
    username: '小明',
    password: '123456',
    avatar: undefined,
    createdAt: new Date('2025-01-01').toISOString(),
  },
  {
    id: 'u2',
    username: '小红',
    password: '123456',
    avatar: undefined,
    createdAt: new Date('2025-01-02').toISOString(),
  },
];

const pets: Pet[] = [
  {
    id: 'p1',
    ownerId: 'u1',
    name: '豆豆',
    breed: '金毛寻回犬',
    age: '2岁',
    personality: '温顺友善，喜欢和人互动，特别爱玩飞盘',
    photo: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute+金毛寻回犬+pet+portrait&image_size=square_hd',
    availableForBorrow: true,
    availableForAdoption: false,
    createdAt: new Date('2025-02-01').toISOString(),
  },
  {
    id: 'p2',
    ownerId: 'u1',
    name: '咪咪',
    breed: '英国短毛猫',
    age: '1岁',
    personality: '安静乖巧，喜欢窝在沙发上打盹，偶尔活泼',
    photo: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute+英国短毛猫+pet+portrait&image_size=square_hd',
    availableForBorrow: true,
    availableForAdoption: true,
    createdAt: new Date('2025-02-05').toISOString(),
  },
  {
    id: 'p3',
    ownerId: 'u2',
    name: '旺财',
    breed: '柯基犬',
    age: '3岁',
    personality: '活泼好动，短腿跑得飞快，喜欢追逐球类',
    photo: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute+柯基犬+pet+portrait&image_size=square_hd',
    availableForBorrow: true,
    availableForAdoption: false,
    createdAt: new Date('2025-02-10').toISOString(),
  },
  {
    id: 'p4',
    ownerId: 'u2',
    name: '雪球',
    breed: '布偶猫',
    age: '6个月',
    personality: '粘人可爱，蓝眼睛特别漂亮，喜欢被抱着',
    photo: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute+布偶猫+pet+portrait&image_size=square_hd',
    availableForBorrow: false,
    availableForAdoption: true,
    createdAt: new Date('2025-02-15').toISOString(),
  },
];

const items: Item[] = [
  {
    id: 'i1',
    ownerId: 'u1',
    name: '宠物自动喂食器',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=automatic+pet+feeder+product&image_size=square_hd',
    condition: '几乎全新',
    location: '北京市朝阳区',
    availableForBorrow: true,
    createdAt: new Date('2025-03-01').toISOString(),
  },
  {
    id: 'i2',
    ownerId: 'u1',
    name: '大型犬用航空箱',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=large+dog+travel+crate+carrier&image_size=square_hd',
    condition: '轻微使用痕迹',
    location: '北京市海淀区',
    availableForBorrow: true,
    createdAt: new Date('2025-03-05').toISOString(),
  },
  {
    id: 'i3',
    ownerId: 'u2',
    name: '猫咪逗猫棒套装',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cat+teaser+toy+set&image_size=square_hd',
    condition: '全新',
    location: '上海市浦东新区',
    availableForBorrow: true,
    createdAt: new Date('2025-03-10').toISOString(),
  },
];

const applications: Application[] = [
  {
    id: 'a1',
    type: 'borrow',
    targetType: 'pet',
    targetId: 'p1',
    targetName: '豆豆',
    applicantId: 'u2',
    applicantName: '小红',
    ownerId: 'u1',
    reason: '很喜欢金毛，想借来陪伴几天',
    contact: '13800138000',
    status: 'pending',
    createdAt: new Date('2025-03-15').toISOString(),
  },
];
const notifications: Notification[] = [];

const comments: Comment[] = [
  {
    id: 'c1',
    targetType: 'pet',
    targetId: 'p1',
    userId: 'u2',
    username: '小红',
    content: '豆豆好可爱啊！可以借来玩一天吗？',
    parentId: null,
    likes: ['u1'],
    createdAt: new Date('2025-03-15').toISOString(),
  },
  {
    id: 'c2',
    targetType: 'pet',
    targetId: 'p3',
    userId: 'u1',
    username: '小明',
    content: '柯基太萌了，小短腿跑起来好搞笑',
    parentId: null,
    likes: [],
    createdAt: new Date('2025-03-16').toISOString(),
  },
];

notifications.push({
  id: 'n1',
  userId: 'u1',
  type: 'application_received',
  applicationId: 'a1',
  message: '小红对豆豆发来了借养申请',
  read: false,
  createdAt: new Date('2025-03-15').toISOString(),
});

const sanitizeUser = (user: User) => {
  const { password: _, ...rest } = user;
  return rest;
};

app.post('/api/users/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }
  const existing = users.find(u => u.username === username);
  if (existing) {
    res.status(409).json({ error: '用户名已存在' });
    return;
  }
  const user: User = {
    id: generateId(),
    username,
    password,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  res.status(201).json({ user: sanitizeUser(user), token: user.id });
});

app.post('/api/users/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  res.json({ user: sanitizeUser(user), token: user.id });
});

app.get('/api/users', (_req, res) => {
  res.json(users.map(sanitizeUser));
});

app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }
  res.json(sanitizeUser(user));
});

app.get('/api/pets', (req, res) => {
  const { ownerId } = req.query;
  let result = pets;
  if (ownerId) {
    result = pets.filter(p => p.ownerId === ownerId);
  }
  res.json(result);
});

app.get('/api/pets/:id', (req, res) => {
  const pet = pets.find(p => p.id === req.params.id);
  if (!pet) {
    res.status(404).json({ error: '宠物不存在' });
    return;
  }
  res.json(pet);
});

app.post('/api/pets', (req, res) => {
  const pet: Pet = {
    id: generateId(),
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  pets.push(pet);
  res.status(201).json(pet);
});

app.get('/api/items', (req, res) => {
  const { ownerId } = req.query;
  let result = items;
  if (ownerId) {
    result = items.filter(i => i.ownerId === ownerId);
  }
  res.json(result);
});

app.get('/api/items/:id', (req, res) => {
  const item = items.find(i => i.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: '物品不存在' });
    return;
  }
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const item: Item = {
    id: generateId(),
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  res.status(201).json(item);
});

app.post('/api/applications', (req, res) => {
  const application: Application = {
    id: generateId(),
    ...req.body,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  applications.push(application);

  const notification: Notification = {
    id: generateId(),
    userId: application.ownerId,
    type: 'application_received',
    applicationId: application.id,
    message: `${application.applicantName}对${application.targetName}发来了${application.type === 'borrow' ? '借养' : '领养'}申请`,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.push(notification);

  res.status(201).json(application);
});

app.put('/api/applications/:id', (req, res) => {
  const application = applications.find(a => a.id === req.params.id);
  if (!application) {
    res.status(404).json({ error: '申请不存在' });
    return;
  }
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400).json({ error: '无效的状态' });
    return;
  }
  application.status = status;

  const type = status === 'approved' ? 'application_approved' : 'application_rejected';
  const label = status === 'approved' ? '已通过' : '已拒绝';
  const notification: Notification = {
    id: generateId(),
    userId: application.applicantId,
    type,
    applicationId: application.id,
    message: `你对${application.targetName}的${application.type === 'borrow' ? '借养' : '领养'}申请${label}`,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.push(notification);

  res.json(application);
});

app.get('/api/applications', (req, res) => {
  const { ownerId, applicantId } = req.query;
  let result = applications;
  if (ownerId) {
    result = result.filter(a => a.ownerId === ownerId);
  }
  if (applicantId) {
    result = result.filter(a => a.applicantId === applicantId);
  }
  res.json(result);
});

app.get('/api/notifications', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    res.status(400).json({ error: 'userId参数必填' });
    return;
  }
  const result = notifications.filter(n => n.userId === userId);
  res.json(result);
});

app.put('/api/notifications/:id/read', (req, res) => {
  const notification = notifications.find(n => n.id === req.params.id);
  if (!notification) {
    res.status(404).json({ error: '通知不存在' });
    return;
  }
  notification.read = true;
  res.json(notification);
});

app.get('/api/comments', (req, res) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    res.status(400).json({ error: 'targetType和targetId参数必填' });
    return;
  }
  const result = comments.filter(
    c => c.targetType === targetType && c.targetId === targetId
  );
  res.json(result);
});

app.post('/api/comments', (req, res) => {
  const comment: Comment = {
    id: generateId(),
    ...req.body,
    likes: [],
    createdAt: new Date().toISOString(),
  };
  comments.push(comment);
  res.status(201).json(comment);
});

app.put('/api/comments/:id/like', (req, res) => {
  const comment = comments.find(c => c.id === req.params.id);
  if (!comment) {
    res.status(404).json({ error: '评论不存在' });
    return;
  }
  const { userId } = req.body;
  const index = comment.likes.indexOf(userId);
  if (index === -1) {
    comment.likes.push(userId);
  } else {
    comment.likes.splice(index, 1);
  }
  res.json(comment);
});

app.listen(3001, () => {
  console.log('Server is running on http://localhost:3001');
});
