import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import http from 'http';
import { Activity, Option } from '../shared/types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());

const activities: Activity[] = [];

const broadcast = (message: string) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  ws.on('close', () => {
    console.log('WebSocket disconnected');
  });
});

app.get('/api/server-time', (_req, res) => {
  res.json({ serverTime: Date.now() });
});

app.post('/api/activities', (req, res) => {
  try {
    const { name, description, location, time, options } = req.body;
    
    const activityOptions: Option[] = options.map((opt: Omit<Option, 'id' | 'votes'>) => ({
      id: uuidv4(),
      name: opt.name,
      imageUrl: opt.imageUrl,
      description: opt.description,
      votes: 0
    }));
    
    const activity: Activity = {
      id: uuidv4(),
      name,
      description,
      location,
      time,
      options: activityOptions,
      createdAt: Date.now(),
      ended: false,
      votedUsers: {}
    };
    
    activities.push(activity);
    
    const message = JSON.stringify({
      type: 'activity_created',
      activityId: activity.id,
      data: activity,
      serverTime: Date.now()
    });
    broadcast(message);
    
    res.json({ activity, shareLink: `/vote/${activity.id}`, adminLink: `/admin/${activity.id}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

app.get('/api/activities/:id', (req, res) => {
  const activity = activities.find(a => a.id === req.params.id);
  if (!activity) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  res.json(activity);
});

app.post('/api/activities/:id/vote', (req, res) => {
  try {
    const activity = activities.find(a => a.id === req.params.id);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    
    if (activity.ended) {
      return res.status(400).json({ error: 'Voting has ended' });
    }
    
    const { optionId, userId } = req.body;
    
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }
    
    if (!optionId || typeof optionId !== 'string') {
      return res.status(400).json({ error: 'Valid optionId is required' });
    }
    
    const userVotes = activity.votedUsers[userId] || [];
    if (userVotes.length >= 3) {
      return res.status(400).json({ error: 'Maximum 3 votes per user' });
    }
    
    if (userVotes.includes(optionId)) {
      return res.status(400).json({ error: 'Already voted for this option' });
    }
    
    const option = activity.options.find(o => o.id === optionId);
    if (!option) {
      return res.status(404).json({ error: 'Option not found' });
    }
    
    option.votes++;
    activity.votedUsers[userId] = [...userVotes, optionId];
    
    const message = JSON.stringify({
      type: 'vote',
      activityId: activity.id,
      voterId: userId,
      data: activity,
      serverTime: Date.now()
    });
    broadcast(message);
    
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to vote' });
  }
});

app.post('/api/activities/:id/end', (req, res) => {
  try {
    const activity = activities.find(a => a.id === req.params.id);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    
    activity.ended = true;
    activity.endedAt = Date.now();
    
    const sortedOptions = [...activity.options].sort((a, b) => b.votes - a.votes);
    const totalVotes = activity.options.reduce((sum, opt) => sum + opt.votes, 0);
    
    const message = JSON.stringify({
      type: 'activity_ended',
      activityId: activity.id,
      data: activity,
      serverTime: Date.now(),
      finalRanking: sortedOptions.map((opt, index) => ({
        rank: index + 1,
        name: opt.name,
        description: opt.description,
        imageUrl: opt.imageUrl,
        votes: opt.votes,
        percentage: totalVotes > 0 ? ((opt.votes / totalVotes) * 100).toFixed(1) : '0.0'
      }))
    });
    broadcast(message);
    
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to end voting' });
  }
});

const PORT = 3005;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
