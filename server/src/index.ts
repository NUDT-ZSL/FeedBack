/**
 * Express 服务器入口
 * 提供 REST API 与 WebSocket 协同编辑服务
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db, generateId, now, User, Directory, Document } from './db';
import { setupWebSocketServer } from './wsHandler';

// ==================== 常量配置 ====================

const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'auto4-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';
const BCRYPT_SALT_ROUNDS = 10;

// ==================== 中间件：鉴权 ====================

/**
 * 从请求头中解析 JWT，返回用户信息（用于可选鉴权接口）
 */
function parseToken(req: express.Request): { userId: string; username: string } | null {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    return jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
  } catch {
    return null;
  }
}

/**
 * 必须鉴权中间件：未登录则返回 401
 */
function authRequired(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const user = parseToken(req);
  if (!user) {
    res.status(401).json({ error: '未授权，请先登录' });
    return;
  }
  (req as unknown as { user: { userId: string; username: string } }).user = user;
  next();
}

/**
 * 从请求对象中获取已解析的用户信息（需配合 authRequired 使用）
 */
function getCurrentUser(req: express.Request): { userId: string; username: string } {
  return (req as unknown as { user: { userId: string; username: string } }).user;
}

// ==================== Express 初始化 ====================

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 创建 HTTP Server（同时供 Express 与 WebSocket 使用）
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocketServer(wss);

// ==================== 认证相关 API ====================

/**
 * POST /register - 用户注册
 * Body: { username: string, password: string }
 */
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }
    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ error: '用户名长度需在 3-20 个字符之间' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码长度不能少于 6 位' });
      return;
    }

    await db.read();

    // 检查用户名是否已存在
    if (db.data!.users.some((u) => u.username === username)) {
      res.status(409).json({ error: '用户名已被使用' });
      return;
    }

    // 密码加密后入库
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user: User = {
      id: generateId(),
      username,
      password: hashedPassword,
      createdAt: now(),
    };
    db.data!.users.push(user);
    await db.write();

    // 签发 Token
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.status(201).json({
      message: '注册成功',
      token,
      user: { id: user.id, username: user.username, createdAt: user.createdAt },
    });
  } catch (err) {
    res.status(500).json({ error: '注册失败', detail: String(err) });
  }
});

/**
 * POST /login - 用户登录
 * Body: { username: string, password: string }
 */
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    await db.read();
    const user = db.data!.users.find((u) => u.username === username);

    if (!user) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    // 签发 Token
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.json({
      message: '登录成功',
      token,
      user: { id: user.id, username: user.username, createdAt: user.createdAt },
    });
  } catch (err) {
    res.status(500).json({ error: '登录失败', detail: String(err) });
  }
});

// ==================== 目录管理 API ====================

/**
 * GET /directories - 获取当前用户的目录列表
 * Query: parentId? 可选，筛选指定父目录下的子目录
 */
app.get('/directories', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const parentId = req.query.parentId as string | undefined;

    await db.read();
    let directories = db.data!.directories.filter((d) => d.userId === userId);

    if (parentId !== undefined) {
      directories = directories.filter((d) => d.parentId === (parentId || null));
    }

    res.json(directories);
  } catch (err) {
    res.status(500).json({ error: '获取目录失败', detail: String(err) });
  }
});

/**
 * POST /directories - 创建目录
 * Body: { name: string, parentId?: string | null }
 */
app.post('/directories', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { name, parentId } = req.body as { name?: string; parentId?: string | null };

    if (!name || !name.trim()) {
      res.status(400).json({ error: '目录名称不能为空' });
      return;
    }

    // 如果指定了 parentId，检查其是否存在且属于当前用户
    if (parentId) {
      await db.read();
      const parentDir = db.data!.directories.find(
        (d) => d.id === parentId && d.userId === userId,
      );
      if (!parentDir) {
        res.status(404).json({ error: '指定的父目录不存在' });
        return;
      }
    }

    await db.read();
    const directory: Directory = {
      id: generateId(),
      name: name.trim(),
      userId,
      parentId: parentId || null,
      createdAt: now(),
    };
    db.data!.directories.push(directory);
    await db.write();

    res.status(201).json(directory);
  } catch (err) {
    res.status(500).json({ error: '创建目录失败', detail: String(err) });
  }
});

/**
 * PUT /directories/:id - 更新目录（重命名、移动）
 * Body: { name?: string, parentId?: string | null }
 */
app.put('/directories/:id', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;
    const { name, parentId } = req.body as { name?: string; parentId?: string | null };

    await db.read();
    const dir = db.data!.directories.find((d) => d.id === id && d.userId === userId);

    if (!dir) {
      res.status(404).json({ error: '目录不存在' });
      return;
    }

    if (name !== undefined) {
      if (!name.trim()) {
        res.status(400).json({ error: '目录名称不能为空' });
        return;
      }
      dir.name = name.trim();
    }

    if (parentId !== undefined) {
      // 不能将目录移动到自己的子目录下（防止循环）
      if (parentId !== null) {
        let currentParentId: string | null = parentId;
        while (currentParentId) {
          if (currentParentId === id) {
            res.status(400).json({ error: '不能将目录移动到其自身的子目录下' });
            return;
          }
          const parent = db.data!.directories.find((d) => d.id === currentParentId);
          currentParentId = parent ? parent.parentId : null;
        }

        const newParent = db.data!.directories.find(
          (d) => d.id === parentId && d.userId === userId,
        );
        if (!newParent) {
          res.status(404).json({ error: '指定的父目录不存在' });
          return;
        }
      }
      dir.parentId = parentId || null;
    }

    await db.write();
    res.json(dir);
  } catch (err) {
    res.status(500).json({ error: '更新目录失败', detail: String(err) });
  }
});

/**
 * DELETE /directories/:id - 删除目录
 * 注意：会级联删除所有子目录和该目录下的文档
 */
app.delete('/directories/:id', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;

    await db.read();
    const dir = db.data!.directories.find((d) => d.id === id && d.userId === userId);

    if (!dir) {
      res.status(404).json({ error: '目录不存在' });
      return;
    }

    // 递归收集需要删除的所有子目录 ID
    const directoryIdsToDelete = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of db.data!.directories) {
        if (d.userId === userId && d.parentId && directoryIdsToDelete.has(d.parentId)) {
          if (!directoryIdsToDelete.has(d.id)) {
            directoryIdsToDelete.add(d.id);
            changed = true;
          }
        }
      }
    }

    // 删除目录
    db.data!.directories = db.data!.directories.filter(
      (d) => !directoryIdsToDelete.has(d.id),
    );

    // 删除这些目录下的所有文档
    db.data!.documents = db.data!.documents.filter(
      (doc) => doc.userId !== userId || !doc.directoryId || !directoryIdsToDelete.has(doc.directoryId),
    );

    await db.write();

    res.json({
      message: '删除成功',
      deletedDirectories: directoryIdsToDelete.size,
    });
  } catch (err) {
    res.status(500).json({ error: '删除目录失败', detail: String(err) });
  }
});

// ==================== 文档管理 API ====================

/**
 * GET /documents - 获取当前用户的文档列表
 * Query: directoryId? 可选，筛选指定目录下的文档
 */
app.get('/documents', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const directoryId = req.query.directoryId as string | undefined;

    await db.read();
    let documents = db.data!.documents.filter((d) => d.userId === userId);

    if (directoryId !== undefined) {
      documents = documents.filter((d) => d.directoryId === (directoryId || null));
    }

    // 列表不返回完整 content 和 history，节省流量
    const list = documents.map(({ content, history, ...rest }) => rest);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: '获取文档列表失败', detail: String(err) });
  }
});

/**
 * POST /documents - 创建文档
 * Body: { title: string, directoryId?: string | null, content?: string }
 */
app.post('/documents', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { title, directoryId, content } = req.body as {
      title?: string;
      directoryId?: string | null;
      content?: string;
    };

    if (!title || !title.trim()) {
      res.status(400).json({ error: '文档标题不能为空' });
      return;
    }

    // 如果指定了目录，检查其有效性
    if (directoryId) {
      await db.read();
      const dir = db.data!.directories.find(
        (d) => d.id === directoryId && d.userId === userId,
      );
      if (!dir) {
        res.status(404).json({ error: '指定的目录不存在' });
        return;
      }
    }

    await db.read();
    const timestamp = now();
    const initialContent = content || '';
    const document: Document = {
      id: generateId(),
      title: title.trim(),
      directoryId: directoryId || null,
      content: initialContent,
      version: 1,
      userId,
      history: [
        {
          version: 1,
          content: initialContent,
          timestamp,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.data!.documents.push(document);
    await db.write();

    res.status(201).json(document);
  } catch (err) {
    res.status(500).json({ error: '创建文档失败', detail: String(err) });
  }
});

/**
 * GET /documents/:id - 获取单个文档详情
 */
app.get('/documents/:id', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;

    await db.read();
    const doc = db.data!.documents.find((d) => d.id === id && d.userId === userId);

    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: '获取文档失败', detail: String(err) });
  }
});

/**
 * PUT /documents/:id - 更新文档（标题、移动目录、全量覆盖内容）
 * Body: { title?: string, directoryId?: string | null, content?: string }
 */
app.put('/documents/:id', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;
    const { title, directoryId, content } = req.body as {
      title?: string;
      directoryId?: string | null;
      content?: string;
    };

    await db.read();
    const doc = db.data!.documents.find((d) => d.id === id && d.userId === userId);

    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    if (title !== undefined) {
      if (!title.trim()) {
        res.status(400).json({ error: '文档标题不能为空' });
        return;
      }
      doc.title = title.trim();
    }

    if (directoryId !== undefined) {
      if (directoryId !== null) {
        const dir = db.data!.directories.find(
          (d) => d.id === directoryId && d.userId === userId,
        );
        if (!dir) {
          res.status(404).json({ error: '指定的目录不存在' });
          return;
        }
      }
      doc.directoryId = directoryId || null;
    }

    // 如果传了 content，则整体覆盖并生成新版本
    if (content !== undefined) {
      const newVersion = doc.version + 1;
      doc.content = content;
      doc.version = newVersion;
      doc.updatedAt = now();
      doc.history.push({
        version: newVersion,
        content,
        timestamp: doc.updatedAt,
      });
    } else {
      doc.updatedAt = now();
    }

    await db.write();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: '更新文档失败', detail: String(err) });
  }
});

/**
 * DELETE /documents/:id - 删除文档
 */
app.delete('/documents/:id', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;

    await db.read();
    const index = db.data!.documents.findIndex(
      (d) => d.id === id && d.userId === userId,
    );

    if (index === -1) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    const [deletedDoc] = db.data!.documents.splice(index, 1);
    await db.write();

    res.json({ message: '删除成功', deleted: deletedDoc.id });
  } catch (err) {
    res.status(500).json({ error: '删除文档失败', detail: String(err) });
  }
});

/**
 * GET /documents/:id/history - 获取文档的历史版本列表（不包含完整 content 避免过大）
 */
app.get('/documents/:id/history', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;

    await db.read();
    const doc = db.data!.documents.find((d) => d.id === id && d.userId === userId);

    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    // 列表返回精简信息（不含 content 原文）
    const summary = doc.history.map((h) => ({
      version: h.version,
      timestamp: h.timestamp,
      length: h.content.length,
    }));

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: '获取历史记录失败', detail: String(err) });
  }
});

/**
 * GET /documents/:id/history/:version - 获取指定版本的完整内容
 */
app.get('/documents/:id/history/:version', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      res.status(400).json({ error: '无效的版本号' });
      return;
    }

    await db.read();
    const doc = db.data!.documents.find((d) => d.id === id && d.userId === userId);

    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    const entry = doc.history.find((h) => h.version === versionNum);
    if (!entry) {
      res.status(404).json({ error: '指定的历史版本不存在' });
      return;
    }

    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: '获取历史版本失败', detail: String(err) });
  }
});

/**
 * POST /documents/:id/rollback - 回滚文档到指定历史版本
 * Body: { version: number }
 */
app.post('/documents/:id/rollback', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const { id } = req.params;
    const { version } = req.body as { version?: number };

    if (version === undefined || typeof version !== 'number') {
      res.status(400).json({ error: '必须指定要回滚的版本号' });
      return;
    }

    await db.read();
    const doc = db.data!.documents.find((d) => d.id === id && d.userId === userId);

    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }

    const targetEntry = doc.history.find((h) => h.version === version);
    if (!targetEntry) {
      res.status(404).json({ error: '指定的历史版本不存在' });
      return;
    }

    // 生成新版本（而不是覆盖当前内容，保留回滚痕迹）
    const newVersion = doc.version + 1;
    doc.content = targetEntry.content;
    doc.version = newVersion;
    doc.updatedAt = now();
    doc.history.push({
      version: newVersion,
      content: targetEntry.content,
      timestamp: doc.updatedAt,
    });

    await db.write();

    res.json({
      message: `已回滚到版本 ${version}`,
      document: doc,
    });
  } catch (err) {
    res.status(500).json({ error: '回滚失败', detail: String(err) });
  }
});

// ==================== 搜索 API ====================

/**
 * GET /search - 搜索当前用户的文档（按标题或内容）
 * Query: q=关键词
 */
app.get('/search', authRequired, async (req, res) => {
  try {
    const { userId } = getCurrentUser(req);
    const query = (req.query.q as string || '').trim().toLowerCase();

    if (!query) {
      res.status(400).json({ error: '搜索关键词不能为空' });
      return;
    }

    await db.read();
    const results = db.data!.documents
      .filter((d) => d.userId === userId)
      .map((doc) => {
        const titleMatched = doc.title.toLowerCase().includes(query);
        const contentMatched = doc.content.toLowerCase().includes(query);
        if (!titleMatched && !contentMatched) return null;

        // 计算匹配度分数（标题匹配权重更高）
        let score = 0;
        if (titleMatched) score += 10;
        if (contentMatched) score += 1;

        // 生成内容摘要（匹配位置前后各 40 字符）
        let snippet = '';
        const idx = doc.content.toLowerCase().indexOf(query);
        if (idx !== -1) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(doc.content.length, idx + query.length + 40);
          snippet = (start > 0 ? '...' : '') + doc.content.slice(start, end) + (end < doc.content.length ? '...' : '');
        }

        return {
          id: doc.id,
          title: doc.title,
          directoryId: doc.directoryId,
          score,
          titleMatched,
          contentMatched,
          snippet,
          updatedAt: doc.updatedAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score);

    res.json({
      query,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: '搜索失败', detail: String(err) });
  }
});

// ==================== 健康检查 ====================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: now() });
});

// ==================== 启动服务器 ====================

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 服务器已启动`);
  console.log(`📡 REST API:   http://localhost:${PORT}`);
  console.log(`🔌 WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`💚 健康检查:   http://localhost:${PORT}/health`);
  console.log(`=========================================`);
});
