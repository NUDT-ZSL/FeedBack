import express from 'express';
import cors from 'cors';
import bandsRouter from './routes/bands.js';
import scheduleRouter from './routes/schedule.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'music festival manager service running' });
  });

  app.use('/api/bands', bandsRouter);
  app.use('/api/schedule', scheduleRouter);

  return app;
}
