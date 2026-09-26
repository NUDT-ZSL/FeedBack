import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());

const projects = new Map();

function generateProjectCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createDefaultProject(id) {
  return {
    id,
    name: '未命名项目',
    bpm: 120,
    tracks: [
      {
        id: 'track-1',
        name: '钢琴',
        instrument: 'piano',
        volume: 0.7,
        pan: 0,
        muted: false,
        solo: false
      },
      {
        id: 'track-2',
        name: '吉他',
        instrument: 'guitar',
        volume: 0.6,
        pan: 0,
        muted: false,
        solo: false
      },
      {
        id: 'track-3',
        name: '贝斯',
        instrument: 'bass',
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false
      }
    ],
    notes: [],
    users: []
  };
}

app.post('/api/projects', (req, res) => {
  let code;
  do {
    code = generateProjectCode();
  } while (projects.has(code));

  const project = createDefaultProject(code);
  projects.set(code, project);

  res.json({ projectId: code });
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  projects.set(req.params.id, { ...project, ...req.body });
  res.json({ success: true });
});

function broadcastToProject(projectId, message, excludeWs) {
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === 1 && client.projectId === projectId) {
      client.send(JSON.stringify(message));
    }
  });
}

function getProjectUsers(projectId) {
  const users = [];
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId && client.user) {
      users.push(client.user);
    }
  });
  return users;
}

const userColors = ['#e94560', '#0f3460', '#16c79a', '#f39c12', '#9b59b6', '#3498db', '#e74c3c', '#2ecc71'];

wss.on('connection', (ws) => {
  ws.userId = uuidv4();
  ws.user = null;
  ws.projectId = null;

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    const { type, payload } = message;

    if (type === 'JOIN_PROJECT') {
      const { projectId, userName } = payload;
      const project = projects.get(projectId);

      if (!project) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Project not found' } }));
        return;
      }

      ws.projectId = projectId;
      const colorIndex = getProjectUsers(projectId).length % userColors.length;
      ws.user = {
        id: ws.userId,
        name: userName || '匿名用户',
        color: userColors[colorIndex]
      };

      ws.send(JSON.stringify({
        type: 'PROJECT_STATE',
        payload: {
          ...project,
          users: getProjectUsers(projectId)
        }
      }));

      broadcastToProject(projectId, {
        type: 'USER_JOINED',
        payload: { user: ws.user }
      }, ws);

      broadcastToProject(projectId, {
        type: 'USERS_UPDATE',
        payload: { users: getProjectUsers(projectId) }
      });
    }

    if (type === 'NOTE_ADDED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        project.notes.push(payload.note);
        broadcastToProject(ws.projectId, { type: 'NOTE_ADDED', payload }, ws);
      }
    }

    if (type === 'NOTE_UPDATED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        const index = project.notes.findIndex(n => n.id === payload.note.id);
        if (index !== -1) {
          project.notes[index] = { ...project.notes[index], ...payload.note };
        }
        broadcastToProject(ws.projectId, { type: 'NOTE_UPDATED', payload }, ws);
      }
    }

    if (type === 'NOTE_DELETED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        project.notes = project.notes.filter(n => n.id !== payload.noteId);
        broadcastToProject(ws.projectId, { type: 'NOTE_DELETED', payload }, ws);
      }
    }

    if (type === 'NOTES_BATCH_UPDATED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        payload.notes.forEach(updatedNote => {
          const index = project.notes.findIndex(n => n.id === updatedNote.id);
          if (index !== -1) {
            project.notes[index] = { ...project.notes[index], ...updatedNote };
          }
        });
        broadcastToProject(ws.projectId, { type: 'NOTES_BATCH_UPDATED', payload }, ws);
      }
    }

    if (type === 'TRACK_UPDATED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        const index = project.tracks.findIndex(t => t.id === payload.track.id);
        if (index !== -1) {
          project.tracks[index] = { ...project.tracks[index], ...payload.track };
        }
        broadcastToProject(ws.projectId, { type: 'TRACK_UPDATED', payload }, ws);
      }
    }

    if (type === 'BPM_UPDATED' && ws.projectId) {
      const project = projects.get(ws.projectId);
      if (project) {
        project.bpm = payload.bpm;
        broadcastToProject(ws.projectId, { type: 'BPM_UPDATED', payload }, ws);
      }
    }

    if (type === 'CURSOR_MOVED' && ws.projectId && ws.user) {
      broadcastToProject(ws.projectId, {
        type: 'CURSOR_MOVED',
        payload: {
          userId: ws.userId,
          position: payload.position
        }
      }, ws);
    }
  });

  ws.on('close', () => {
    if (ws.projectId && ws.user) {
      const projectId = ws.projectId;
      broadcastToProject(projectId, {
        type: 'USER_LEFT',
        payload: { userId: ws.userId }
      });

      setTimeout(() => {
        broadcastToProject(projectId, {
          type: 'USERS_UPDATE',
          payload: { users: getProjectUsers(projectId) }
        });
      }, 100);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
