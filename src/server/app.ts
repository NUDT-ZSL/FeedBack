import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { User, Book, Exchange, Message } from './types';
import { createExchangeService, DomainError, ExchangeStatus } from './services/exchangeService';

const app = express();
const PORT = 3002;
const JWT_SECRET = 'your-secret-key';

app.use(cors());
app.use(express.json());

const users: User[] = [];
const books: Book[] = [];
const exchanges: Exchange[] = [];
const messages: Message[] = [];

// 交换与通知的领域逻辑统一收口到 exchangeService，路由只做参数适配与错误映射
const exchangeService = createExchangeService({ users, books, exchanges, messages });

interface AuthRequest extends Request {
  userId?: string;
}

const verifyToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: '无效的认证令牌' });
  }
};

const handleDomainError = (error: unknown, res: Response): boolean => {
  if (error instanceof DomainError) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
};

const userConnections: Map<string, any> = new Map();

const sendNotification = (userId: string, data: Message) => {
  const ws = userConnections.get(userId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
};

const seedData = () => {
  if (users.length === 0) {
    const demoUsers: User[] = [
      {
        id: '1',
        username: '小明',
        email: 'demo@example.com',
        passwordHash: bcrypt.hashSync('123456', 10),
        avatar: '',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        username: '小红',
        email: 'demo2@example.com',
        passwordHash: bcrypt.hashSync('123456', 10),
        avatar: '',
        createdAt: new Date().toISOString(),
      },
    ];
    users.push(...demoUsers);

    const demoBooks: Book[] = [
      {
        id: '101',
        ownerId: '2',
        title: '活着',
        author: '余华',
        category: '文学',
        coverImage: 'https://picsum.photos/seed/book1/400/600',
        condition: 'good',
        description: '讲述了农村人福贵悲惨的人生遭遇，展现了生命的韧性。',
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        isAvailable: true,
      },
      {
        id: '102',
        ownerId: '2',
        title: 'JavaScript高级程序设计',
        author: 'Nicholas C. Zakas',
        category: '科技',
        coverImage: 'https://picsum.photos/seed/book2/400/600',
        condition: 'fair',
        description: '前端开发必读经典，深入理解JavaScript语言特性。',
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        isAvailable: true,
      },
      {
        id: '103',
        ownerId: '1',
        title: '人类简史',
        author: '尤瓦尔·赫拉利',
        category: '历史',
        coverImage: 'https://picsum.photos/seed/book3/400/600',
        condition: 'new',
        description: '从认知革命、农业革命到科学革命，讲述人类的演化史。',
        createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
        isAvailable: true,
      },
      {
        id: '104',
        ownerId: '2',
        title: '家常菜大全',
        author: '美食生活',
        category: '生活',
        coverImage: 'https://picsum.photos/seed/book4/400/600',
        condition: 'poor',
        description: '收录了100道经典家常菜做法，图文并茂。',
        createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
        isAvailable: true,
      },
    ];
    books.push(...demoBooks);
  }
};
seedData();
app.post('/api/register', async (req: Request, res: Response) => {
  const { username, email, password, avatar } = req.body;
  const existingUser = users.find((u) => u.email === email);
  if (existingUser) {
    return res.status(400).json({ error: '邮箱已被注册' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user: User = {
    id: uuidv4(),
    username,
    email,
    passwordHash,
    avatar: avatar || '',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  const { passwordHash: _, ...userWithoutPassword } = user;
  const token = jwt.sign(
    { userId: user.id, username: user.username, email: user.email, avatar: user.avatar, createdAt: user.createdAt },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ user: userWithoutPassword, token });
});

app.post('/api/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(400).json({ error: '用户不存在' });
  }
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(400).json({ error: '密码错误' });
  }
  const token = jwt.sign(
    { userId: user.id, username: user.username, email: user.email, avatar: user.avatar, createdAt: user.createdAt },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  const { passwordHash: _, ...userWithoutPassword } = user;
  res.json({ token, user: userWithoutPassword });
});

app.get('/api/books', (req: Request, res: Response) => {
  const { search, category } = req.query;
  let filteredBooks = [...books];

  if (search && typeof search === 'string') {
    const lowerSearch = search.toLowerCase();
    filteredBooks = filteredBooks.filter(
      (b) => b.title.toLowerCase().includes(lowerSearch) || b.author.toLowerCase().includes(lowerSearch)
    );
  }

  if (category && typeof category === 'string' && category !== '全部') {
    filteredBooks = filteredBooks.filter((b) => b.category === category);
  }

  res.json(filteredBooks);
});

app.post('/api/books', verifyToken, (req: AuthRequest, res: Response) => {
  const { title, author, category, coverImage, condition, description } = req.body;
  const book: Book = {
    id: uuidv4(),
    ownerId: req.userId!,
    title,
    author,
    category,
    coverImage: coverImage || '',
    condition,
    description: description || '',
    createdAt: new Date().toISOString(),
    isAvailable: true,
  };
  books.push(book);
  res.json(book);
});

app.put('/api/books/:id', verifyToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const bookIndex = books.findIndex((b) => b.id === id);
  if (bookIndex === -1) {
    return res.status(404).json({ error: '书籍不存在' });
  }
  if (books[bookIndex].ownerId !== req.userId) {
    return res.status(403).json({ error: '无权限修改' });
  }
  books[bookIndex] = { ...books[bookIndex], ...req.body };
  res.json(books[bookIndex]);
});

app.delete('/api/books/:id', verifyToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const bookIndex = books.findIndex((b) => b.id === id);
  if (bookIndex === -1) {
    return res.status(404).json({ error: '书籍不存在' });
  }
  if (books[bookIndex].ownerId !== req.userId) {
    return res.status(403).json({ error: '无权限删除' });
  }
  books.splice(bookIndex, 1);
  res.json({ message: '删除成功' });
});

app.get('/api/users/:userId/books', (req: Request, res: Response) => {
  const { userId } = req.params;
  const userBooks = books.filter((b) => b.ownerId === userId);
  res.json(userBooks);
});
app.get('/api/exchanges', verifyToken, (req: AuthRequest, res: Response) => {
  res.json(exchangeService.getExchangesForUser(req.userId!));
});

app.post('/api/exchanges', verifyToken, (req: AuthRequest, res: Response) => {
  const { bookId, message: exchangeMessage } = req.body;
  try {
    const { exchange, notification } = exchangeService.createExchange({
      bookId,
      requesterId: req.userId!,
      message: exchangeMessage,
    });
    sendNotification(notification.receiverId, notification);
    res.json(exchange);
  } catch (error) {
    if (!handleDomainError(error, res)) {
      throw error;
    }
  }
});

app.put('/api/exchanges/:id', verifyToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = exchangeService.updateExchangeStatus({
      exchangeId: id,
      status: status as ExchangeStatus,
      actorId: req.userId!,
    });
    // 幂等重放（重复提交相同状态）不会产生新通知，直接返回当前记录
    if (result.notification) {
      sendNotification(result.notification.receiverId, result.notification);
    }
    res.json(result.exchange);
  } catch (error) {
    if (!handleDomainError(error, res)) {
      throw error;
    }
  }
});

app.get('/api/messages', verifyToken, (req: AuthRequest, res: Response) => {
  res.json(exchangeService.getMessagesForUser(req.userId!));
});

app.put('/api/messages/read-all', verifyToken, (req: AuthRequest, res: Response) => {
  exchangeService.markAllMessagesRead(req.userId!);
  res.json({ message: '所有消息已标记为已读' });
});

app.put('/api/messages/:id/read', verifyToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const message = exchangeService.markMessageRead(req.userId!, id);
    res.json(message);
  } catch (error) {
    if (!handleDomainError(error, res)) {
      throw error;
    }
  }
});

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws/messages' });

wss.on('connection', (ws, request) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    userConnections.set(userId, ws);

    console.log(`User ${userId} connected to WebSocket`);

    ws.on('close', () => {
      console.log(`User ${userId} disconnected from WebSocket`);
      userConnections.delete(userId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      userConnections.delete(userId);
    });
  } catch (error) {
    console.error('WebSocket authentication failed:', error);
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}/ws/messages`);
});

export { app, server, users, books, exchanges, messages, exchangeService };
