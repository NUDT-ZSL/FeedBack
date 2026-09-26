import express from 'express';
import cors from 'cors';
import type { MoodRecord, MoodStats, MoodType } from './types';
import { createMood, getTodayStats, getRangeStats } from './controllers/mood';
import { getThresholds, setThreshold } from './controllers/threshold';
import { getAlerts, checkAlerts } from './controllers/alert';

const MOOD_TYPES: MoodType[] = ['happy', 'calm', 'anxious', 'tired', 'angry'];

export function calculateStats(records: MoodRecord[], date: string): MoodStats {
  const distribution: Record<MoodType, number> = {
    happy: 0,
    calm: 0,
    anxious: 0,
    tired: 0,
    angry: 0,
  };

  records.forEach(record => {
    distribution[record.mood]++;
  });

  const total = records.length;
  const percentages: Record<MoodType, number> = {
    happy: 0,
    calm: 0,
    anxious: 0,
    tired: 0,
    angry: 0,
  };

  if (total > 0) {
    MOOD_TYPES.forEach(mood => {
      percentages[mood] = Math.round((distribution[mood] / total) * 100);
    });
  }

  return {
    date,
    total,
    distribution,
    percentages,
  };
}

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post('/api/mood', createMood);
app.get('/api/mood/today', getTodayStats);
app.get('/api/mood/range', getRangeStats);

app.get('/api/threshold', getThresholds);
app.post('/api/threshold', setThreshold);

app.get('/api/alerts', getAlerts);
app.post('/api/alerts/check', checkAlerts);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
