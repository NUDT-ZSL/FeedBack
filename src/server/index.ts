import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT) || 3001;
const DB_PATH = process.env.DB_PATH || './database.sqlite';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SALT_ROUNDS = 10;

interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
  };
}

export function initDatabase(dbPath: string = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(dbPath);

  db.exec(`
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
      time_seconds REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (maze_id) REFERENCES mazes(id)
    );
  `);

  return db;
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

export function createApp(db: DatabaseSync): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.post('/api/register', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    try {
      const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existingUser) {
        return res.status(400).json({ error: '用户名已存在' });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const result = db
        .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, passwordHash);

      const userId = Number(result.lastInsertRowid);
      const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({ token, user: { id: userId, username } });
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
      const user = db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(username) as { id: number; username: string; password_hash: string } | undefined;

      if (!user) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
        expiresIn: '7d',
      });

      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      res.status(500).json({ error: '登录失败' });
    }
  });

  app.get('/api/mazes', (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = 12;
    const offset = (page - 1) * pageSize;

    try {
      const mazes = db
        .prepare(
          `SELECT m.*, u.username as author_name
           FROM mazes m
           LEFT JOIN users u ON m.user_id = u.id
           ORDER BY m.created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(pageSize, offset);

      const { total } = db.prepare('SELECT COUNT(*) as total FROM mazes').get() as {
        total: number;
      };

      res.json({
        mazes,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      res.status(500).json({ error: '获取迷宫列表失败' });
    }
  });

  app.post('/api/mazes', authenticateToken, (req: AuthRequest, res: Response) => {
    const { name, style, grid, markers, thumbnail } = req.body;

    if (!name || !grid) {
      return res.status(400).json({ error: '迷宫名称和网格数据不能为空' });
    }

    const mazeId = uuidv4();

    try {
      db.prepare(
        'INSERT INTO mazes (id, user_id, name, style, grid, markers, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        mazeId,
        req.user!.id,
        name,
        style || JSON.stringify({}),
        JSON.stringify(grid),
        markers ? JSON.stringify(markers) : JSON.stringify([]),
        thumbnail || ''
      );

      const maze = db.prepare('SELECT * FROM mazes WHERE id = ?').get(mazeId);
      res.status(201).json(maze);
    } catch (error) {
      res.status(500).json({ error: '创建迷宫失败' });
    }
  });

  app.get('/api/mazes/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const maze = db
        .prepare(
          `SELECT m.*, u.username as author_name
           FROM mazes m
           LEFT JOIN users u ON m.user_id = u.id
           WHERE m.id = ?`
        )
        .get(id);

      if (!maze) {
        return res.status(404).json({ error: '迷宫不存在' });
      }

      res.json(maze);
    } catch (error) {
      res.status(500).json({ error: '获取迷宫详情失败' });
    }
  });

  app.put('/api/mazes/:id', authenticateToken, (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { name, style, grid, markers, thumbnail } = req.body;

    try {
      const maze = db.prepare('SELECT * FROM mazes WHERE id = ?').get(id) as
        | {
            user_id: number;
            name: string;
            style: string;
            grid: string;
            markers: string;
            thumbnail: string;
          }
        | undefined;

      if (!maze) {
        return res.status(404).json({ error: '迷宫不存在' });
      }

      if (maze.user_id !== req.user!.id) {
        return res.status(403).json({ error: '无权限修改此迷宫' });
      }

      db.prepare(
        'UPDATE mazes SET name = ?, style = ?, grid = ?, markers = ?, thumbnail = ? WHERE id = ?'
      ).run(
        name || maze.name,
        style !== undefined ? JSON.stringify(style) : maze.style,
        grid !== undefined ? JSON.stringify(grid) : maze.grid,
        markers !== undefined ? JSON.stringify(markers) : maze.markers,
        thumbnail !== undefined ? thumbnail : maze.thumbnail,
        id
      );

      const updatedMaze = db.prepare('SELECT * FROM mazes WHERE id = ?').get(id);
      res.json(updatedMaze);
    } catch (error) {
      res.status(500).json({ error: '更新迷宫失败' });
    }
  });

  app.get('/api/mazes/:id/attempts', (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const maze = db.prepare('SELECT id FROM mazes WHERE id = ?').get(id);
      if (!maze) {
        return res.status(404).json({ error: '迷宫不存在' });
      }

      const attempts = db
        .prepare(
          `SELECT * FROM attempts
           WHERE maze_id = ?
           ORDER BY time_seconds ASC, created_at ASC, id ASC
           LIMIT 100`
        )
        .all(id);

      res.json(attempts);
    } catch (error) {
      res.status(500).json({ error: '获取排行榜失败' });
    }
  });

  const submitAttempt = (req: Request, res: Response) => {
    const { id } = req.params;
    const { username, time_seconds } = req.body ?? {};

    if (typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    if (
      typeof time_seconds !== 'number' ||
      !Number.isFinite(time_seconds) ||
      time_seconds < 0
    ) {
      return res.status(400).json({ error: '用时必须是非负数字' });
    }

    try {
      const maze = db.prepare('SELECT id FROM mazes WHERE id = ?').get(id);
      if (!maze) {
        return res.status(404).json({ error: '迷宫不存在' });
      }

      const result = db
        .prepare('INSERT INTO attempts (maze_id, username, time_seconds) VALUES (?, ?, ?)')
        .run(id, username.trim(), time_seconds);

      const attempt = db
        .prepare('SELECT * FROM attempts WHERE id = ?')
        .get(Number(result.lastInsertRowid));
      res.status(201).json(attempt);
    } catch (error) {
      res.status(500).json({ error: '记录成绩失败' });
    }
  };

  app.post('/api/mazes/:id/attempts', submitAttempt);
  app.post('/api/mazes/:id/attempt', submitAttempt);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: '请求体不是合法的 JSON' });
    }
    next(err);
  });

  return app;
}

export function startServer(port: number = PORT, dbPath: string = DB_PATH) {
  const db = initDatabase(dbPath);
  const app = createApp(db);
  const server = app.listen(port, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Server running on port ${actualPort}`);
  });
  return server;
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  startServer();
}
