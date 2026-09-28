import { Router } from 'express';
import { Achievement } from '../../src/types';
import { achievementsStore, getDefaultAchievements } from '../data/store';

const router = Router();

router.get('/:playerName', (req, res) => {
  const { playerName } = req.params;
  let achievements = achievementsStore.get(playerName);
  if (!achievements) {
    achievements = getDefaultAchievements();
    achievementsStore.set(playerName, achievements);
  }
  res.json(achievements);
});

router.post('/:playerName', (req, res) => {
  const { playerName } = req.params;
  const { achievements }: { achievements: Achievement[] } = req.body;
  if (!achievements || !Array.isArray(achievements)) {
    res.status(400).json({ error: 'Missing achievements array' });
    return;
  }
  achievementsStore.set(playerName, achievements);
  res.json({ success: true });
});

export default router;
