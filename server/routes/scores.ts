import { Router } from 'express';
import { LeaderboardEntry } from '../../src/types';
import { scoresStore } from '../data/store';

const router = Router();

router.post('/', (req, res) => {
  const { levelId, score, playerName, passed } = req.body;
  if (levelId == null || score == null || !playerName || passed == null) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const key = String(levelId);
  let entries = scoresStore.get(key);
  if (!entries) {
    entries = [];
    scoresStore.set(key, entries);
  }
  const existing = entries.find(e => e.playerName === playerName);
  if (existing) {
    if (score > existing.score) {
      existing.score = score;
    }
  } else {
    entries.push({ playerName, score, levelId });
  }
  res.json({ success: true });
});

router.get('/:levelId', (req, res) => {
  const key = String(req.params.levelId);
  const entries = scoresStore.get(key) || [];
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const top10: LeaderboardEntry[] = sorted.slice(0, 10).map((e, i) => ({
    rank: i + 1,
    playerName: e.playerName,
    score: e.score,
    levelId: e.levelId,
  }));
  res.json(top10);
});

export default router;
