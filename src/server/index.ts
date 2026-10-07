import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());

interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
  };
}

let db: Database<sqlite3.Database, sqlite3.Statement>;

async function initDatabase() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS mazes (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      name TEXT,
      style TEXT,
      grid TEXT,
      markers TEXT,
      thumbnail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      maze_id TEXT,
      username TEXT,
      time_seconds INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (maze_id) REFERENCES mazes(id)
    );
  `);
}

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user as { id: number; username: string };
    next();
  });
}

app.post('/api/register', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      username,
      passwordHash
    );

    const token = jwt.sign(
      { id: result.lastID, username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: result.lastID, username } });
  } catch (error) {
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  try {
    const user = await db.get(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      username
    );

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/mazes', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = 12;
  const offset = (page - 1) * pageSize;

  try {
    const mazes = await db.all(`
      SELECT m.*, u.username as author_name
      FROM mazes m
      LEFT JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, pageSize, offset);

    const { total } = await db.get('SELECT COUNT(*) as total FROM mazes') as { total: number };

    res.json({
      mazes,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    res.status(500).json({ error: '获取迷宫列表失败' });
  }
});

app.post('/api/mazes', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { name, style, grid, markers, thumbnail } = req.body;

  if (!name || !grid) {
    return res.status(400).json({ error: '迷宫名称和网格数据不能为空' });
  }

  const mazeId = uuidv4();

  try {
    await db.run(
      'INSERT INTO mazes (id, user_id, name, style, grid, markers, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      mazeId,
      req.user!.id,
      name,
      style || JSON.stringify({}),
      JSON.stringify(grid),
      markers ? JSON.stringify(markers) : JSON.stringify([]),
      thumbnail || ''
    );

    const maze = await db.get('SELECT * FROM mazes WHERE id = ?', mazeId);
    res.status(201).json(maze);
  } catch (error) {
    res.status(500).json({ error: '创建迷宫失败' });
  }
});

app.get('/api/mazes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const maze = await db.get(`
      SELECT m.*, u.username as author_name
      FROM mazes m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `, id);

    if (!maze) {
      return res.status(404).json({ error: '迷宫不存在' });
    }

    res.json(maze);
  } catch (error) {
    res.status(500).json({ error: '获取迷宫详情失败' });
  }
});

app.put('/api/mazes/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, style, grid, markers, thumbnail } = req.body;

  try {
    const maze = await db.get('SELECT * FROM mazes WHERE id = ?', id);

    if (!maze) {
      return res.status(404).json({ error: '迷宫不存在' });
    }

    if (maze.user_id !== req.user!.id) {
      return res.status(403).json({ error: '无权限修改此迷宫' });
    }

    await db.run(
      'UPDATE mazes SET name = ?, style = ?, grid = ?, markers = ?, thumbnail = ? WHERE id = ?',
      name || maze.name,
      style !== undefined ? JSON.stringify(style) : maze.style,
      grid !== undefined ? JSON.stringify(grid) : maze.grid,
      markers !== undefined ? JSON.stringify(markers) : maze.markers,
      thumbnail !== undefined ? thumbnail : maze.thumbnail,
      id
    );

    const updatedMaze = await db.get('SELECT * FROM mazes WHERE id = ?', id);
    res.json(updatedMaze);
  } catch (error) {
    res.status(500).json({ error: '更新迷宫失败' });
  }
});

app.get('/api/mazes/:id/attempts', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const maze = await db.get('SELECT id FROM mazes WHERE id = ?', id);
    if (!maze) {
      return res.status(404).json({ error: '迷宫不存在' });
    }

    const attempts = await db.all(`
      SELECT * FROM attempts
      WHERE maze_id = ?
      ORDER BY time_seconds ASC, created_at ASC
      LIMIT 100
    `, id);

    res.json(attempts);
  } catch (error) {
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

app.post('/api/mazes/:id/attempt', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, time_seconds } = req.body;

  if (!username || time_seconds === undefined) {
    return res.status(400).json({ error: '用户名和用时不能为空' });
  }

  try {
    const maze = await db.get('SELECT id FROM mazes WHERE id = ?', id);
    if (!maze) {
      return res.status(404).json({ error: '迷宫不存在' });
    }

    const result = await db.run(
      'INSERT INTO attempts (maze_id, username, time_seconds) VALUES (?, ?, ?)',
      id,
      username,
      time_seconds
    );

    const attempt = await db.get('SELECT * FROM attempts WHERE id = ?', result.lastID);
    res.status(201).json(attempt);
  } catch (error) {
    res.status(500).json({ error: '记录成绩失败' });
  }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
