import express from 'express';
import { createServer } from 'http';
import { v4 as uuid } from 'uuid';
import { initWs, broadcast } from './ws.js';
import type { Episode, Comment, Poll, PollOption } from './types.js';

const app = express();
const server = createServer(app);
app.use(express.json());
app.use(express.static('public'));

initWs(server);

const EPISODE_ID = 'ep-001';

const chapters = [
  { id: 'ch-1', title: '开场与话题引入', startTime: 0, color: '#e94560' },
  { id: 'ch-2', title: '核心观点讨论', startTime: 35, color: '#0f3460' },
  { id: 'ch-3', title: '嘉宾对话环节', startTime: 75, color: '#533483' },
  { id: 'ch-4', title: '听众互动问答', startTime: 115, color: '#e9a560' },
  { id: 'ch-5', title: '总结与下期预告', startTime: 150, color: '#48c9b0' },
];

const episode: Episode = {
  id: EPISODE_ID,
  title: '深度对话：科技与人文的交汇',
  description: '本期节目我们邀请到了知名科技评论人，一起探讨科技发展如何影响我们的日常生活与文化认同。',
  audioUrl: '/audio/episode-001.wav',
  duration: 180,
  chapters,
  pollId: 'poll-001',
};

const comments: Comment[] = [
  { id: uuid(), author: '星辰大海', avatarColor: '#e94560', content: '这个话题太有意思了！👏', timestamp: Date.now() - 300000, episodeId: EPISODE_ID },
  { id: uuid(), author: '夜行者', avatarColor: '#0f3460', content: '嘉宾的观点很独特 🎙️', timestamp: Date.now() - 240000, episodeId: EPISODE_ID },
  { id: uuid(), author: '追风少年', avatarColor: '#533483', content: '等这期等了好久！', timestamp: Date.now() - 180000, episodeId: EPISODE_ID },
];

const pollOptions: PollOption[] = [
  { id: 'opt-1', label: '科技让生活更美好', votes: 42 },
  { id: 'opt-2', label: '科技带来了新的焦虑', votes: 28 },
  { id: 'opt-3', label: '需要平衡科技与人文', votes: 65 },
  { id: 'opt-4', label: '说不清，看具体情况', votes: 15 },
];

const poll: Poll = {
  id: 'poll-001',
  episodeId: EPISODE_ID,
  question: '你认为科技对生活的影响是？',
  options: pollOptions,
};

app.get('/api/episode/:id', (req, res) => {
  if (req.params.id === EPISODE_ID) {
    res.json(episode);
  } else {
    res.status(404).json({ error: 'Episode not found' });
  }
});

app.get('/api/comments', (req, res) => {
  const eid = req.query.episodeId as string;
  const result = eid ? comments.filter((c) => c.episodeId === eid) : comments;
  res.json(result);
});

app.post('/api/comments', (req, res) => {
  const { author, content, episodeId, avatarColor } = req.body;
  if (!author || !content || !episodeId) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }
  const colors = ['#e94560', '#0f3460', '#533483', '#e9a560', '#48c9b0', '#6c5ce7', '#fd79a8'];
  const comment: Comment = {
    id: uuid(),
    author,
    avatarColor: avatarColor || colors[Math.floor(Math.random() * colors.length)],
    content,
    timestamp: Date.now(),
    episodeId,
  };
  comments.push(comment);
  broadcast(`episode-${episodeId}`, { type: 'comment', payload: comment });
  res.status(201).json(comment);
});

app.post('/api/episode/:id/event', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/poll', (req, res) => {
  const eid = req.query.episodeId as string;
  if (eid && poll.episodeId === eid) {
    res.json(poll);
  } else if (!eid) {
    res.json(poll);
  } else {
    res.status(404).json({ error: 'Poll not found' });
  }
});

app.post('/api/poll/vote', (req, res) => {
  const { pollId, optionId } = req.body;
  if (!pollId || !optionId) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }
  const opt = poll.options.find((o) => o.id === optionId);
  if (!opt) {
    res.status(404).json({ error: 'Option not found' });
    return;
  }
  opt.votes += 1;
  broadcast(`poll-${poll.id}`, { type: 'poll_update', payload: poll });
  res.json(poll);
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
