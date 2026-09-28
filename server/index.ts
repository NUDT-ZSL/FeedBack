import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  status: 'todo' | 'in-progress' | 'done';
  createdAt: string;
  completedAt?: string;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(express.json());

let tasks: Task[] = [];
let idCounter = 1;

app.get('/api/tasks', (_req, res) => {
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const { title, description, assignee, dueDate } = req.body;
  if (!title || !title.trim()) {
    res.status(400).json({ error: '标题不能为空' });
    return;
  }
  const task: Task = {
    id: String(idCounter++),
    title: title.trim(),
    description: description || '',
    assignee: assignee || '',
    dueDate: dueDate || '',
    status: 'todo',
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  io.emit('task:created', task);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) {
    res.status(404).json({ error: '任务未找到' });
    return;
  }
  const prev = tasks[index];
  const updated: Task = {
    ...prev,
    ...req.body,
    id: prev.id,
    createdAt: prev.createdAt,
  };
  if (req.body.status === 'done' && prev.status !== 'done') {
    updated.completedAt = new Date().toISOString();
  }
  if (req.body.status && req.body.status !== 'done') {
    updated.completedAt = undefined;
  }
  tasks[index] = updated;
  io.emit('task:updated', updated);
  res.json(updated);
});

app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const prev = tasks.find((t) => t.id === id);
  if (!prev) {
    res.status(404).json({ error: '任务未找到' });
    return;
  }
  tasks = tasks.filter((t) => t.id !== id);
  io.emit('task:deleted', { id });
  res.status(204).send();
});

io.on('connection', (socket) => {
  console.log('客户端已连接:', socket.id);
  socket.emit('tasks:init', tasks);
  socket.on('disconnect', () => {
    console.log('客户端已断开:', socket.id);
  });
});

const PORT = 4001;
httpServer.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
