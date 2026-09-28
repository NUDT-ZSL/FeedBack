import { Router } from 'express';
import { LeaderboardEntry } from '../../src/types';
import { scoresStore } from '../data/store';

const router = Router();

router.get('/', (_req, res) => {
  const playerTotals = new Map<string, { totalScore: number; bestLevelId: number; bestScore: number }>();
  scoresStore.forEach((entries) => {
    for (const entry of entries) {
      const existing = playerTotals.get(entry.playerName);
      if (existing) {
        existing.totalScore += entry.score;
        if (entry.score > existing.bestScore) {
          existing.bestScore = entry.score;
          existing.bestLevelId = entry.levelId;
        }
      } else {
        playerTotals.set(entry.playerName, {
          totalScore: entry.score,
          bestLevelId: entry.levelId,
          bestScore: entry.score,
        });
      }
    }
  });
  const aggregated = Array.from(playerTotals.entries()).map(
    ([playerName, data]) => ({
      playerName,
      totalScore: data.totalScore,
      levelId: data.bestLevelId,
    })
  );
  aggregated.sort((a, b) => b.totalScore - a.totalScore);
  const top20: LeaderboardEntry[] = aggregated.slice(0, 20).map((e, i) => ({
    rank: i + 1,
    playerName: e.playerName,
    score: e.totalScore,
    levelId: e.levelId,
  }));
  res.json(top20);
});

export default router;
