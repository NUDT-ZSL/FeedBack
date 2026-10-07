import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

const db = new Database(path.join(__dirname, '../tea_collection.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    origin TEXT NOT NULL,
    year INTEGER NOT NULL,
    photo_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasting_notes (
    id TEXT PRIMARY KEY,
    tea_id TEXT NOT NULL,
    date TEXT NOT NULL,
    water_temp INTEGER NOT NULL,
    tea_amount INTEGER NOT NULL,
    brew_time INTEGER NOT NULL,
    aroma TEXT,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tea_id) REFERENCES teas(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_teas_user_id ON teas(user_id);
  CREATE INDEX IF NOT EXISTS idx_teas_category ON teas(category);
  CREATE INDEX IF NOT EXISTS idx_teas_year ON teas(year);
  CREATE INDEX IF NOT EXISTS idx_tasting_notes_tea_id ON tasting_notes(tea_id);
  CREATE INDEX IF NOT EXISTS idx_tasting_notes_score ON tasting_notes(score);
`);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /png|jpg|jpeg/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.test(ext) && allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PNG/JPG 格式的图片'));
    }
  }
});

const hashPassword = (password: string): string => {
  return crypto.scryptSync(password, 'tea-salt', 64).toString('hex');
};

const verifyPassword = (password: string, hash: string): boolean => {
  const derivedKey = crypto.scryptSync(password, 'tea-salt', 64).toString('hex');
  return derivedKey === hash;
};

interface User {
  id: string;
  username: string;
  password_hash: string;
}

interface Tea {
  id: string;
  user_id: string;
  name: string;
  category: string;
  origin: string;
  year: number;
  photo_path: string;
  created_at: string;
}

interface TastingNote {
  id: string;
  tea_id: string;
  date: string;
  water_temp: number;
  tea_amount: number;
  brew_time: number;
  aroma: string;
  score: number;
  description: string;
  created_at: string;
}

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as User | undefined;
    if (existingUser) {
      return res.status(400).json({ success: false, error: '用户名已存在' });
    }

    const id = uuidv4();
    const passwordHash = hashPassword(password);

    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, username, passwordHash);

    res.json({ success: true, user: { id, username } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

app.get('/api/teas', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const category = req.query.category as string;
    const minScore = req.query.minScore as string;
    const maxScore = req.query.maxScore as string;
    const minYear = req.query.minYear as string;
    const maxYear = req.query.maxYear as string;
    const origin = req.query.origin as string;

    let sql = `
      SELECT DISTINCT t.*, 
             (SELECT AVG(score) FROM tasting_notes tn WHERE tn.tea_id = t.id) as avg_score
      FROM teas t
      LEFT JOIN tasting_notes tn ON t.tea_id = tn.id
      WHERE t.user_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (category) {
      sql += ' AND t.category = ?';
      params.push(category);
    }
    if (minYear) {
      sql += ' AND t.year >= ?';
      params.push(parseInt(minYear));
    }
    if (maxYear) {
      sql += ' AND t.year <= ?';
      params.push(parseInt(maxYear));
    }
    if (origin) {
      sql += ' AND t.origin LIKE ?';
      params.push(`%${origin}%`);
    }
    if (minScore || maxScore) {
      sql += ' AND t.id IN (SELECT tea_id FROM tasting_notes GROUP BY tea_id';
      const having: string[] = [];
      if (minScore) {
        having.push('AVG(score) >= ?');
        params.push(parseInt(minScore));
      }
      if (maxScore) {
        having.push('AVG(score) <= ?');
        params.push(parseInt(maxScore));
      }
      sql += ` HAVING ${having.join(' AND ')})`;
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const teas = db.prepare(sql).all(...params) as Tea[];

    const countSql = 'SELECT COUNT(*) as total FROM teas t WHERE t.user_id = ?';
    const countParams: (string | number)[] = [userId];
    const result = db.prepare(countSql).get(...countParams) as { total: number };

    res.json({ success: true, teas, total: result.total });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/teas/:id', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { id } = req.params;

    const tea = db.prepare('SELECT * FROM teas WHERE id = ? AND user_id = ?').get(id, userId) as Tea | undefined;
    if (!tea) {
      return res.status(404).json({ success: false, error: '茶品不存在' });
    }

    const tastingNotes = db.prepare('SELECT * FROM tasting_notes WHERE tea_id = ? ORDER BY date DESC, created_at DESC').all(id) as TastingNote[];

    res.json({ success: true, tea: { ...tea, tasting_notes: tastingNotes } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/teas', upload.single('photo'), (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { name, category, origin, year } = req.body;
    const photoPath = req.file ? `/uploads/${req.file.filename}` : '';

    if (!name || !category || !origin || !year) {
      return res.status(400).json({ success: false, error: '请填写完整信息' });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO teas (id, user_id, name, category, origin, year, photo_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, name, category, origin, parseInt(year), photoPath);

    const tea = db.prepare('SELECT * FROM teas WHERE id = ?').get(id) as Tea;
    res.json({ success: true, tea });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.put('/api/teas/:id', upload.single('photo'), (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { id } = req.params;
    const { name, category, origin, year } = req.body;

    const existingTea = db.prepare('SELECT * FROM teas WHERE id = ? AND user_id = ?').get(id, userId) as Tea | undefined;
    if (!existingTea) {
      return res.status(404).json({ success: false, error: '茶品不存在' });
    }

    let photoPath = existingTea.photo_path;
    if (req.file) {
      photoPath = `/uploads/${req.file.filename}`;
    }

    db.prepare('UPDATE teas SET name = ?, category = ?, origin = ?, year = ?, photo_path = ? WHERE id = ?')
      .run(name, category, origin, parseInt(year), photoPath, id);

    const tea = db.prepare('SELECT * FROM teas WHERE id = ?').get(id) as Tea;
    res.json({ success: true, tea });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.delete('/api/teas/:id', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { id } = req.params;

    const existingTea = db.prepare('SELECT * FROM teas WHERE id = ? AND user_id = ?').get(id, userId) as Tea | undefined;
    if (!existingTea) {
      return res.status(404).json({ success: false, error: '茶品不存在' });
    }

    db.prepare('DELETE FROM teas WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/teas/:teaId/notes', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { teaId } = req.params;
    const { date, water_temp, tea_amount, brew_time, aroma, score, description } = req.body;

    const existingTea = db.prepare('SELECT * FROM teas WHERE id = ? AND user_id = ?').get(teaId, userId) as Tea | undefined;
    if (!existingTea) {
      return res.status(404).json({ success: false, error: '茶品不存在' });
    }

    if (!date || !water_temp || !tea_amount || !brew_time || !score) {
      return res.status(400).json({ success: false, error: '请填写完整信息' });
    }

    const id = uuidv4();
    db.prepare(`INSERT INTO tasting_notes 
      (id, tea_id, date, water_temp, tea_amount, brew_time, aroma, score, description) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, teaId, date, parseInt(water_temp), parseInt(tea_amount), parseInt(brew_time), aroma || '', parseInt(score), description || '');

    const note = db.prepare('SELECT * FROM tasting_notes WHERE id = ?').get(id) as TastingNote;
    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.put('/api/notes/:id', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { id } = req.params;
    const { date, water_temp, tea_amount, brew_time, aroma, score, description } = req.body;

    const existingNote = db.prepare(`SELECT tn.* FROM tasting_notes tn 
      JOIN teas t ON tn.tea_id = t.id 
      WHERE tn.id = ? AND t.user_id = ?`).get(id, userId) as TastingNote | undefined;
    if (!existingNote) {
      return res.status(404).json({ success: false, error: '品鉴记录不存在' });
    }

    db.prepare(`UPDATE tasting_notes 
      SET date = ?, water_temp = ?, tea_amount = ?, brew_time = ?, aroma = ?, score = ?, description = ? 
      WHERE id = ?`)
      .run(date, parseInt(water_temp), parseInt(tea_amount), parseInt(brew_time), aroma || '', parseInt(score), description || '', id);

    const note = db.prepare('SELECT * FROM tasting_notes WHERE id = ?').get(id) as TastingNote;
    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.delete('/api/notes/:id', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const { id } = req.params;

    const existingNote = db.prepare(`SELECT tn.* FROM tasting_notes tn 
      JOIN teas t ON tn.tea_id = t.id 
      WHERE tn.id = ? AND t.user_id = ?`).get(id, userId) as TastingNote | undefined;
    if (!existingNote) {
      return res.status(404).json({ success: false, error: '品鉴记录不存在' });
    }

    db.prepare('DELETE FROM tasting_notes WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const teas = db.prepare('SELECT * FROM teas WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Tea[];
    const allNotes = db.prepare(`SELECT tn.* FROM tasting_notes tn 
      JOIN teas t ON tn.tea_id = t.id 
      WHERE t.user_id = ? ORDER BY tn.date DESC`).all(userId) as TastingNote[];

    const exportData = {
      export_date: new Date().toISOString().split('T')[0],
      teas: teas.map(tea => ({
        ...tea,
        tasting_notes: allNotes.filter(note => note.tea_id === tea.id)
      }))
    };

    const fileName = `我的茶品收藏_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
