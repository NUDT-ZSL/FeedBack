import express from 'express';
import cors from 'cors';
import levelsRouter from './routes/levels';
import scoresRouter from './routes/scores';
import leaderboardRouter from './routes/leaderboard';
import achievementsRouter from './routes/achievements';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/levels', levelsRouter);
app.use('/api/scores', scoresRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/achievements', achievementsRouter);

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
