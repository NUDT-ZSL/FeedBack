import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { Comment } from '../src/types';

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

interface InMemoryStore {
  comments: Comment[];
  undoStack: Comment[][];
  redoStack: Comment[][];
}

const store: InMemoryStore = {
  comments: [],
  undoStack: [],
  redoStack: [],
};

const MAX_HISTORY = 50;

function saveHistory() {
  store.undoStack.push(JSON.parse(JSON.stringify(store.comments)));
  if (store.undoStack.length > MAX_HISTORY) {
    store.undoStack.shift();
  }
  store.redoStack = [];
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/comments', (req, res) => {
  const { componentId } = req.query;
  let comments = store.comments;
  if (componentId) {
    comments = comments.filter((c) => c.componentId === componentId);
  }
  comments = comments.sort((a, b) => b.timestamp - a.timestamp);
  res.json(comments);
});

app.post('/api/comments', (req, res) => {
  const { componentId, userId, userName, userAvatar, content, mentions } = req.body;

  if (!componentId || !userId || !content) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  saveHistory();

  const comment: Comment = {
    id: uuidv4(),
    componentId,
    userId,
    userName,
    userAvatar,
    content,
    mentions: mentions || [],
    timestamp: Date.now(),
  };

  store.comments.push(comment);
  res.status(201).json(comment);
});

app.delete('/api/comments/:id', (req, res) => {
  const { id } = req.params;
  const idx = store.comments.findIndex((c) => c.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: '评论不存在' });
  }
  saveHistory();
  const deleted = store.comments.splice(idx, 1)[0];
  res.json(deleted);
});

app.post('/api/comments/undo', (_req, res) => {
  if (store.undoStack.length === 0) {
    return res.status(400).json({ error: '无法撤销' });
  }
  store.redoStack.push(JSON.parse(JSON.stringify(store.comments)));
  store.comments = store.undoStack.pop()!;
  res.json(store.comments);
});

app.post('/api/comments/redo', (_req, res) => {
  if (store.redoStack.length === 0) {
    return res.status(400).json({ error: '无法重做' });
  }
  store.undoStack.push(JSON.parse(JSON.stringify(store.comments)));
  store.comments = store.redoStack.pop()!;
  res.json(store.comments);
});

app.listen(PORT, () => {
  console.log(`[server] API 服务运行在 http://localhost:${PORT}`);
});
